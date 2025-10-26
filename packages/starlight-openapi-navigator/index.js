import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadAndNormalizeSpec } from './parser/index.js';
import {
  generateOverviewPage,
  generateOperationPages,
  generateSchemaIndexPage,
  generateSchemaDetailPages,
} from './pages/index.js';
import {
  normalizeEndpointUI,
  resolveEndpointUIMode,
} from './runtime/endpoint-ui.js';

const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_COMPONENTS_DIR = path.join(PACKAGE_ROOT, 'components');
const PACKAGE_RUNTIME_DIR = path.join(PACKAGE_ROOT, 'runtime');

function sanitizeInstanceId(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'spec';
}

function normalizeIntegrationEntries(rawOptions) {
  const entries = Array.isArray(rawOptions) ? rawOptions : [rawOptions ?? {}];
  const seen = new Set();

  return entries.map((options, index) => {
    const candidate = (() => {
      if (options && typeof options.instanceId === 'string' && options.instanceId.trim()) {
        return options.instanceId;
      }
      if (options && typeof options.id === 'string' && options.id.trim()) {
        return options.id;
      }
      if (options && typeof options.name === 'string' && options.name.trim()) {
        return options.name;
      }
      if (entries.length === 1) return 'default';
      return `spec-${index + 1}`;
    })();

    let instanceId = sanitizeInstanceId(candidate);
    let suffix = 2;
    while (!instanceId || seen.has(instanceId)) {
      instanceId = sanitizeInstanceId(`${candidate}-${suffix}`);
      suffix += 1;
    }
    seen.add(instanceId);

    return {
      options,
      instanceId,
    };
  });
}

async function copyTemplateDir(srcDir, destDir, replacements = []) {
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTemplateDir(srcPath, destPath, replacements);
      continue;
    }
    if (!entry.isFile()) continue;
    let content = await fs.readFile(srcPath, 'utf8');
    if (Array.isArray(replacements) && replacements.length) {
      replacements.forEach(([searchValue, replaceValue]) => {
        if (!searchValue) return;
        content = content.split(searchValue).join(replaceValue);
      });
    }
    await fs.writeFile(destPath, content, 'utf8');
  }
}

/**
 * @typedef {object} StarlightOpenApiNavigatorOptions
 * @property {string} [specPath] Path to the OpenAPI specification. Defaults to `public/openapi.yaml`.
 * @property {boolean} [watchSpec] Whether to watch the spec file in dev and regenerate docs automatically. Defaults to `true`.
 * @property {string} [baseSlug] Base docs slug for generated pages. Defaults to `api`.
 * @property {string} [outputDir] Relative path (from project root) to emit generated Astro pages. Defaults to `src/pages/<baseSlug>`.
 * @property {'auto'|'menu'|'search'} [endpointUI] Controls the endpoint browsing UI. Defaults to `auto`.
 * @property {object|boolean} [tryIt] Controls the generated "Try it" playground. Set to `false` to disable the separate page and CTA.
 * @property {boolean} [tryIt.enabled] Whether to generate the separate dynamic playground page and CTA. Defaults to `true`.
 * @property {object} [navigation] Sidebar auto-population options.
 * @property {boolean} [navigation.enabled] When true, injects generated tag/operation links into the Starlight sidebar.
 * @property {string} [navigation.groupLabel] Label for the generated sidebar group. Defaults to "API Explorer".
 * @property {string} [navigation.replaceGroupLabel] Existing sidebar group label to replace. Defaults to `navigation.groupLabel`.
 * @property {'spec'|'alpha'} [navigation.tagSort] Order tags by spec order or alphabetically. Defaults to `spec`.
 * @property {'spec'|'alpha'} [navigation.operationSort] Order operations by spec order or alphabetically. Defaults to `spec`.
 * @property {'summary'|'path'} [navigation.operationLabel] Controls the primary operation label text. Defaults to `summary`.
 * @property {'summary'|'path'} [navigation.operationTitle] Controls the hover title text. Defaults to the opposite of `operationLabel`.
 * @property {object|false} [navigation.overviewItem] Override or disable the Overview sidebar entry.
 * @property {object|false} [navigation.schemasItem] Override or disable the Schemas sidebar entry.
 */

/**
 * Local integration scaffold for the upcoming Starlight OpenAPI Navigator plugin.
 *
 * @param {StarlightOpenApiNavigatorOptions} [options]
 * @returns {import('astro').AstroIntegration}
 */
export function createOpenApiIntegration(options = {}) {
  const entries = normalizeIntegrationEntries(options);
  if (entries.length !== 1) {
    throw new Error('createOpenApiIntegration expects a single OpenAPI configuration.');
  }
  const entry = entries[0];
  const resolvedOptions = resolveOptions(entry.options, {
    instanceId: entry.instanceId,
  });
  return createIntegration(resolvedOptions);
}

export function starlightOpenApiNavigator(rawOptions = {}) {
  const entries = normalizeIntegrationEntries(rawOptions);
  const resolvedEntries = entries.map((entry) =>
    resolveOptions(entry.options, {
      instanceId: entry.instanceId,
    })
  );
  const integrations = resolvedEntries.map((resolved) => createIntegration(resolved));

  return {
    name: 'starlight-openapi-navigator',
    hooks: {
      'config:setup': async ({ addIntegration, updateConfig, config, logger }) => {
        integrations.forEach((integration) => addIntegration(integration));

        let sidebar = cloneSidebar(config?.sidebar);
        let sidebarChanged = false;

        for (const resolved of resolvedEntries) {
          if (!resolved.navigation.enabled) continue;

          try {
            const rawSpec = await loadAndNormalizeSpec(resolved.specSource);
            const normalized = customizeSpec(rawSpec, resolved);
            const resolvedEndpointUI = resolveEndpointUIMode(
              resolved.endpointUI,
              normalized?.stats?.operations ?? 0
            );
            const navigationGroup = buildNavigationGroup(
              normalized,
              resolved.navigation,
              resolved.baseSlug,
              resolvedEndpointUI
            );
            if (!navigationGroup) continue;

            sidebar = mergeSidebarWithGroup(sidebar, navigationGroup, resolved.navigation);
            sidebarChanged = true;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger?.warn?.(
              `starlight-openapi-navigator[${resolved.instanceId}]: unable to generate sidebar navigation for ${resolved.specLabel} — ${message}`
            );
          }
        }

        if (sidebarChanged) {
          updateConfig({ sidebar });
        }
      },
    },
  };
}

export default starlightOpenApiNavigator;

async function runWithLimit(tasks, limit = 16) {
  const queue = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  const max = Math.max(1, Number(limit) || 1);
  const running = new Set();
  const results = [];

  while (queue.length || running.size) {
    while (queue.length && running.size < max) {
      const task = queue.shift();
      const promise = Promise.resolve()
        .then(() => task())
        .finally(() => running.delete(promise));
      running.add(promise);
      results.push(promise);
    }
    if (running.size) {
      await Promise.race(running);
    }
  }

  return Promise.all(results);
}

function resolveOptions(options = {}, extras = {}) {
  const instanceId = sanitizeInstanceId(extras.instanceId ?? 'default');
  const baseSlugInput = typeof options.baseSlug === 'string' && options.baseSlug.trim().length
    ? options.baseSlug
    : instanceId;
  const baseSlug = normalizeBaseSlug(baseSlugInput);
  const defaultOutputDir = options.outputDir ?? path.join('src', 'pages', ...slugToSegments(baseSlug));
  const navigation = normalizeNavigationOptions(options.navigation, baseSlug);
  const specPath = options.specPath ?? 'public/openapi.yaml';
  const specSource = resolveSpecSource(specPath);
  const endpointUI = normalizeEndpointUI(options.endpointUI);
  const tryIt = normalizeTryItOptions(options.tryIt);

  const resolved = {
    specPath,
    specSource,
    specLabel: formatSpecLabel(specSource),
    watchSpec: options.watchSpec ?? true,
    baseSlug,
    outputDir: defaultOutputDir,
    tags: {
      include: Array.isArray(options.tags?.include) ? [...options.tags.include] : null,
      exclude: Array.isArray(options.tags?.exclude) ? [...options.tags.exclude] : null,
      order: Array.isArray(options.tags?.order) ? [...options.tags.order] : [],
      overrides: options.tags?.overrides ? { ...options.tags.overrides } : {},
    },
    codeSamples: {
      includeLanguages: Array.isArray(options.codeSamples?.includeLanguages)
        ? [...options.codeSamples.includeLanguages]
        : null,
      rename: options.codeSamples?.rename ? { ...options.codeSamples.rename } : {},
    },
    endpointUI,
    navigation,
    tryIt,
  };

  if (specSource.type === 'file') {
    resolved.specFilePath = specSource.path;
  }

  resolved.generatedDocsDir = path.isAbsolute(resolved.outputDir)
    ? resolved.outputDir
    : path.join(process.cwd(), resolved.outputDir);
  resolved.legacyDocsDir = path.join(process.cwd(), 'src', 'content', 'docs', 'api-pages');

  resolved.instanceId = instanceId;
  resolved.specAlias = `virtual:starlight-openapi-navigator/spec-data/${instanceId}`;
  resolved.configAlias = `virtual:starlight-openapi-navigator/config/${instanceId}`;

  return resolved;
}

function createIntegration(resolvedOptions) {
  /** @type {import('./parser/index.js').NormalizedOpenApiSpec | null} */
  let normalizedSpec = null;
  let artifactsReady = false;
  let specModulePath = '';
  let codegenDirPath = '';
  let configModulePath = '';
  let regeneratePromise = null;
  let devProxyTable = [];
  let resolvedEndpointUI = resolveEndpointUIMode(resolvedOptions.endpointUI, 0);
  let componentsDirPath = PACKAGE_COMPONENTS_DIR;

  const resetGeneratedDocsDir = async () => {
    if (resolvedOptions.legacyDocsDir !== resolvedOptions.generatedDocsDir) {
      await fs.rm(resolvedOptions.legacyDocsDir, { recursive: true, force: true });
    }
    await fs.rm(resolvedOptions.generatedDocsDir, { recursive: true, force: true });
    await fs.mkdir(resolvedOptions.generatedDocsDir, { recursive: true });
  };

  const writeSpecModule = async (spec) => {
    if (!specModulePath || !codegenDirPath) return;

    const {
      manifest,
      tagsWithDigests,
      allOperationDigests,
      schemaList,
      schemaSlugMap,
      schemaDefinitions,
      chunks,
      operationChunkLookup,
    } = createRuntimeSpecArtifacts(spec);

    const specDir = path.dirname(specModulePath);
    const chunksDir = path.join(specDir, 'chunks');
    await fs.rm(chunksDir, { recursive: true, force: true });
    await fs.mkdir(chunksDir, { recursive: true });

    const chunkSourceEntries = [];
    const chunkFsSourceEntries = [];
    const chunkIdsByTag = {};
    const chunkIdToTag = {};
    const chunkFileWrites = chunks.map((chunk) => {
      const chunkFilePath = path.join(chunksDir, chunk.fileName);
      const chunkImportPath = `./chunks/${chunk.fileName}`;
      chunkSourceEntries.push(`${JSON.stringify(chunk.id)}: ${JSON.stringify(chunkImportPath)}`);
      chunkFsSourceEntries.push(`${JSON.stringify(chunk.id)}: ${JSON.stringify(chunkFilePath)}`);
      if (!chunkIdsByTag[chunk.tagSlug]) {
        chunkIdsByTag[chunk.tagSlug] = [];
      }
      chunkIdsByTag[chunk.tagSlug].push(chunk.id);
      chunkIdToTag[chunk.id] = chunk.tagSlug;
      return () => {
        const payload = JSON.stringify(chunk.operations);
        return fs.writeFile(chunkFilePath, payload, 'utf8');
      };
    });
    await runWithLimit(chunkFileWrites, 16);

    const jsonFsSourceEntries = [];
    const writeJson = async (filename, data, fallback) => {
      const filePath = path.join(specDir, filename);
      const payload = JSON.stringify(data ?? fallback);
      jsonFsSourceEntries.push(`${JSON.stringify(`./${filename}`)}: ${JSON.stringify(filePath)}`);
      await fs.writeFile(filePath, payload, 'utf8');
    };

    await Promise.all([
      writeJson('manifest.json', manifest, {}),
      writeJson('tags.json', tagsWithDigests, []),
      writeJson('operations-index.json', allOperationDigests, []),
      writeJson('schemas-list.json', schemaList, []),
      writeJson('schema-slug-map.json', schemaSlugMap, {}),
    ]);

    const schemaDefinitionsDir = path.join(specDir, 'schema-definitions');
    await fs.rm(schemaDefinitionsDir, { recursive: true, force: true });
    await fs.mkdir(schemaDefinitionsDir, { recursive: true });
    const schemaDefinitionEntries = [];
    const schemaDefinitionFsSourceEntries = [];
    const schemaDefinitionWrites = schemaDefinitions
      .map((entry) => {
        if (!entry || typeof entry.slug !== 'string' || !entry.slug.length) return null;
        const fileName = buildSchemaDefinitionFileName(entry.slug, entry.name);
        const filePath = path.join(schemaDefinitionsDir, fileName);
        const importPath = `./schema-definitions/${fileName}`;
        schemaDefinitionEntries.push(`${JSON.stringify(entry.slug)}: ${JSON.stringify(importPath)}`);
        schemaDefinitionFsSourceEntries.push(`${JSON.stringify(entry.slug)}: ${JSON.stringify(filePath)}`);
        return () => fs.writeFile(filePath, JSON.stringify(entry.schema), 'utf8');
      })
      .filter(Boolean);
    await runWithLimit(schemaDefinitionWrites, 8);

    const modulePreludeParts = [
      `const chunkSources = {`,
      chunkSourceEntries.length ? chunkSourceEntries.map((entry) => `  ${entry},`).join('\n') : '',
      `};`,
      `const chunkFsSources = {`,
      chunkFsSourceEntries.length ? chunkFsSourceEntries.map((entry) => `  ${entry},`).join('\n') : '',
      `};`,
      `const schemaDefinitionSources = {`,
      schemaDefinitionEntries.length
        ? schemaDefinitionEntries.map((entry) => `  ${entry},`).join('\n')
        : '',
      `};`,
      `const schemaDefinitionFsSources = {`,
      schemaDefinitionFsSourceEntries.length
        ? schemaDefinitionFsSourceEntries.map((entry) => `  ${entry},`).join('\n')
        : '',
      `};`,
      `const jsonFsSources = {`,
      jsonFsSourceEntries.length
        ? jsonFsSourceEntries.map((entry) => `  ${entry},`).join('\n')
        : '',
      `};`,
    ];
    const modulePostludeParts = [
      `const chunkCache = new Map();`,
      `const chunkPromises = new Map();`,
      `const isServerBuild = typeof window === 'undefined';`,
      `function evictOperationFromChunk(chunkId, operationsMap, operationSlug) {`,
      `  if (!isServerBuild || !operationsMap || !operationSlug) return;`,
      `  if (operationsMap && Object.prototype.hasOwnProperty.call(operationsMap, operationSlug)) {`,
      `    delete operationsMap[operationSlug];`,
      `  }`,
      `  if (operationsMap && Object.keys(operationsMap).length === 0) {`,
      `    chunkCache.delete(chunkId);`,
      `  }`,
      `}`,
      `let tagsCache = null;`,
      `let tagsPromise = null;`,
      `let operationIndexCache = null;`,
      `let operationIndexPromise = null;`,
      `let schemasCache = null;`,
      `let schemasPromise = null;`,
      `let schemaMapCache = null;`,
      `let schemaMapPromise = null;`,
      `let manifestCache = null;`,
      `let manifestPromise = null;`,
      `const schemaDefinitionCache = new Map();`,
      `const schemaDefinitionPromises = new Map();`,
      `let fsModule = null;`,
      `async function ensureFsModule() {`,
      `  if (!fsModule) {`,
      `    fsModule = await import('node:fs/promises');`,
      `  }`,
      `  return fsModule;`,
      `}`,
      `async function loadJsonFromFs(fsPath, label) {`,
      `  if (!fsPath) return null;`,
      `  try {`,
      `    const fs = await ensureFsModule();`,
      `    const raw = await fs.readFile(fsPath, 'utf8');`,
      `    return JSON.parse(raw);`,
      `  } catch (error) {`,
      `    console.error('starlight-openapi-navigator: failed to read json asset', label || fsPath, error);`,
      `    return null;`,
      `  }`,
      `}`,
      `async function loadChunk(chunkId) {`,
      `  if (!chunkId) return null;`,
      `  if (!isServerBuild && chunkCache.has(chunkId)) return chunkCache.get(chunkId);`,
      `  if (!isServerBuild && chunkPromises.has(chunkId)) {`,
      `    return chunkPromises.get(chunkId);`,
      `  }`,
      `  const sourcePath = chunkSources[chunkId];`,
      `  if (!sourcePath) return null;`,
      `  const fsPath = chunkFsSources[chunkId];`,
      `  if (isServerBuild) {`,
      `    const data = await loadJsonFromFs(fsPath, sourcePath);`,
      `    if (data !== null && data !== undefined) {`,
      `      return data;`,
      `    }`,
      `    return loadJsonModule(sourcePath);`,
      `  }`,
      `  const promise = loadJsonModule(sourcePath);`,
      `  chunkPromises.set(chunkId, promise);`,
      `  const resolved = await promise;`,
      `  chunkCache.set(chunkId, resolved);`,
      `  chunkPromises.delete(chunkId);`,
      `  return resolved;`,
      `}`,
      `async function loadJsonModule(path) {`,
      `  if (isServerBuild) {`,
      `    const normalized = typeof path === 'string' && path.startsWith('./')`,
      `      ? path`,
      `      : typeof path === 'string' && path.length`,
      `        ? './' + path`,
      `        : './';`,
      `    const fsPath = jsonFsSources[normalized] || jsonFsSources[path];`,
      `    const fsResult = await loadJsonFromFs(fsPath, normalized);`,
      `    if (fsResult !== null && fsResult !== undefined) {`,
      `      return fsResult;`,
      `    }`,
      `    try {`,
      `      const fileUrl = new URL(path, import.meta.url);`,
      `      const fs = await ensureFsModule();`,
      `      const raw = await fs.readFile(fileUrl, 'utf8');`,
      `      return JSON.parse(raw);`,
      `    } catch (error) {`,
      `      console.error('starlight-openapi-navigator: failed to read json file', path, error);`,
      `      return null;`,
      `    }`,
      `  }`,
      `  const mod = await import(path);`,
      `  return mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;`,
      `}`,
      `export async function loadTags() {`,
      `  if (tagsCache) return tagsCache;`,
      `  if (!tagsPromise) {`,
      `    tagsPromise = loadJsonModule('./tags.json');`,
      `  }`,
      `  tagsCache = await tagsPromise;`,
      `  return tagsCache;`,
      `}`,
      `export function clearTagsCache() {`,
      `  tagsCache = null;`,
      `  tagsPromise = null;`,
      `}`,
      `export async function loadOperationIndex() {`,
      `  if (operationIndexCache) return operationIndexCache;`,
      `  if (!operationIndexPromise) {`,
      `    operationIndexPromise = loadJsonModule('./operations-index.json');`,
      `  }`,
      `  operationIndexCache = await operationIndexPromise;`,
      `  return operationIndexCache;`,
      `}`,
      `export async function loadSchemas() {`,
      `  if (schemasCache) return schemasCache;`,
      `  if (!schemasPromise) {`,
        `    schemasPromise = loadJsonModule('./schemas-list.json');`,
      `  }`,
      `  const resolved = await schemasPromise;`,
      `  schemasCache = Array.isArray(resolved) ? resolved : [];`,
      `  return schemasCache;`,
      `}`,
      `export async function loadSchemaSlugMap() {`,
      `  if (schemaMapCache) return schemaMapCache;`,
      `  if (!schemaMapPromise) {`,
        `    schemaMapPromise = (async () => {`,
          `      const raw = await loadJsonModule('./schema-slug-map.json');`,
          `      if (!raw || typeof raw !== 'object') return new Map();`,
          `      return new Map(Object.entries(raw));`,
        `    })();`,
      `  }`,
      `  schemaMapCache = await schemaMapPromise;`,
      `  return schemaMapCache;`,
      `}`,
      `export async function loadManifest() {`,
      `  if (manifestCache) return manifestCache;`,
      `  if (!manifestPromise) {`,
      `    manifestPromise = (async () => {`,
      `      const data = await loadJsonModule('./manifest.json');`,
      `      if (!data || typeof data !== 'object') return {};`,
      `      return data;`,
      `    })();`,
      `  }`,
      `  manifestCache = await manifestPromise;`,
      `  return manifestCache;`,
      `}`,
      `export async function loadSchemaDefinition(schemaSlug) {`,
      `  if (!schemaSlug) return null;`,
      `  if (!isServerBuild && schemaDefinitionCache.has(schemaSlug)) {`,
      `    return schemaDefinitionCache.get(schemaSlug);`,
      `  }`,
      `  if (!isServerBuild && schemaDefinitionPromises.has(schemaSlug)) {`,
      `    return schemaDefinitionPromises.get(schemaSlug);`,
      `  }`,
      `  const sourcePath = schemaDefinitionSources[schemaSlug];`,
      `  if (!sourcePath) return null;`,
      `  if (isServerBuild) {`,
      `    const fsPath = schemaDefinitionFsSources[schemaSlug];`,
      `    const data = await loadJsonFromFs(fsPath, sourcePath);`,
      `    if (data !== null && data !== undefined) {`,
      `      return data;`,
      `    }`,
      `    return loadJsonModule(sourcePath);`,
      `  }`,
      `  const promise = loadJsonModule(sourcePath);`,
      `  schemaDefinitionPromises.set(schemaSlug, promise);`,
      `  const resolved = await promise;`,
      `  schemaDefinitionCache.set(schemaSlug, resolved);`,
      `  schemaDefinitionPromises.delete(schemaSlug);`,
      `  return resolved;`,
      `}`,
      `export async function loadTagOperations(tagSlug) {`,
      `  const chunkIds = tagChunkMap[tagSlug];`,
      `  if (!chunkIds || (Array.isArray(chunkIds) && chunkIds.length === 0)) {`,
      `    return null;`,
      `  }`,
      `  const ids = Array.isArray(chunkIds) ? chunkIds : [chunkIds];`,
      `  let hasData = false;`,
      `  const combined = {};`,
      `  for (const id of ids) {`,
      `    const ops = await loadChunk(id);`,
      `    if (!ops) continue;`,
      `    hasData = true;`,
      `    Object.assign(combined, ops);`,
      `  }`,
      `  return hasData ? combined : null;`,
      `}`,
      `export async function loadOperation(operationSlug, tagSlug) {`,
      `  if (!operationSlug) return null;`,
      `  if (tagSlug) {`,
      `    const chunkIds = tagChunkMap[tagSlug];`,
      `    if (chunkIds && (!Array.isArray(chunkIds) || chunkIds.length > 0)) {`,
      `      const ids = Array.isArray(chunkIds) ? chunkIds : [chunkIds];`,
      `      for (const id of ids) {`,
      `        const tagOperations = await loadChunk(id);`,
      `        if (tagOperations && tagOperations[operationSlug]) {`,
      `          const operation = tagOperations[operationSlug];`,
      `          evictOperationFromChunk(id, tagOperations, operationSlug);`,
      `          return operation;`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
      `  const chunkId = operationChunkLookup[operationSlug];`,
      `  if (!chunkId) return null;`,
      `  const operations = await loadChunk(chunkId);`,
      `  if (!operations) return null;`,
      `  const operation = operations[operationSlug] ?? null;`,
      `  if (operation) {`,
      `    evictOperationFromChunk(chunkId, operations, operationSlug);`,
      `  }`,
      `  return operation;`,
      `}`,
      `export function getOperationPreferredTag(operationSlug) {`,
      `  const chunkId = operationChunkLookup[operationSlug];`,
      `  if (!chunkId) return null;`,
      `  return chunkIdToTag[chunkId] ?? null;`,
      `}`,
      `const manifest = await loadManifest();`,
      `export const spec = manifest;`,
      `export const manifestData = manifest;`,
      `export default manifest;`,
      '',
    ];

    const modulePrelude = `${modulePreludeParts.join('\n')}\n`;
    const modulePostlude = `${modulePostludeParts.join('\n')}\n`;

    await fs.writeFile(specModulePath, modulePrelude, 'utf8');
    await fs.appendFile(
      specModulePath,
      `const tagChunkMap = ${JSON.stringify(chunkIdsByTag)};\n`,
      'utf8'
    );
    await fs.appendFile(
      specModulePath,
      `const operationChunkLookup = ${JSON.stringify(operationChunkLookup)};\n`,
      'utf8'
    );
    await fs.appendFile(
      specModulePath,
      `const chunkIdToTag = ${JSON.stringify(chunkIdToTag)};\n`,
      'utf8'
    );
    await fs.appendFile(specModulePath, modulePostlude, 'utf8');
  };

  const writeConfigModule = async () => {
    if (!configModulePath) return;
    const safeProxyTable = JSON.stringify(devProxyTable).replace(/</g, '\\u003C');
    const safeTryIt = JSON.stringify(resolvedOptions.tryIt ?? { enabled: true }).replace(
      /</g,
      '\\u003C'
    );
    const moduleSource = `export const baseSlug = ${JSON.stringify(
      resolvedOptions.baseSlug
    )};\nexport const outputDir = ${JSON.stringify(
      resolvedOptions.outputDir
    )};\nexport const endpointUI = ${JSON.stringify(
      resolvedOptions.endpointUI
    )};\nexport const resolvedEndpointUI = ${JSON.stringify(
      resolvedEndpointUI
    )};\nexport const devProxyTable = ${safeProxyTable};\nexport const tryIt = ${safeTryIt};\nexport default { baseSlug, outputDir, endpointUI, resolvedEndpointUI, devProxyTable, tryIt };\n`;
    await fs.writeFile(configModulePath, moduleSource, 'utf8');
  };

  const regenerateArtifacts = async (logger) => {
    if (regeneratePromise) return regeneratePromise;
    artifactsReady = false;
    regeneratePromise = (async () => {
      await resetGeneratedDocsDir();
      const rawSpec = await loadAndNormalizeSpec(resolvedOptions.specSource);
      normalizedSpec = customizeSpec(rawSpec, resolvedOptions);
      resolvedEndpointUI = resolveEndpointUIMode(
        resolvedOptions.endpointUI,
        normalizedSpec?.stats?.operations ?? 0
      );
      devProxyTable = buildDevProxyTable(normalizedSpec);
      await writeConfigModule();
      await writeSpecModule(normalizedSpec);
      await generateOverviewPage(normalizedSpec, {
        logger,
        outputDir: resolvedOptions.generatedDocsDir,
        baseSlug: resolvedOptions.baseSlug,
        endpointUI: resolvedEndpointUI,
        componentsDir: componentsDirPath,
      });
      await generateOperationPages(normalizedSpec, {
        logger,
        outputDir: resolvedOptions.generatedDocsDir,
        baseSlug: resolvedOptions.baseSlug,
        tryItEnabled: resolvedOptions.tryIt.enabled !== false,
        componentsDir: componentsDirPath,
      });
      await generateSchemaIndexPage(normalizedSpec, {
        logger,
        outputDir: resolvedOptions.generatedDocsDir,
        baseSlug: resolvedOptions.baseSlug,
        componentsDir: componentsDirPath,
      });
      await generateSchemaDetailPages(normalizedSpec, {
        logger,
        outputDir: resolvedOptions.generatedDocsDir,
        baseSlug: resolvedOptions.baseSlug,
        componentsDir: componentsDirPath,
      });
      const operationCount = normalizedSpec?.stats?.operations ?? 0;
      logger.info(
        `starlight-openapi-navigator[${resolvedOptions.instanceId}]: generated ${operationCount} operation page(s) from ${resolvedOptions.specLabel}.`
      );
      normalizedSpec = null;
      artifactsReady = true;
    })()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`starlight-openapi-navigator[${resolvedOptions.instanceId}]: failed regeneration — ${message}`);
        throw error;
      })
      .finally(() => {
        regeneratePromise = null;
      });

    return regeneratePromise;
  };

  return {
    name: 'starlight-openapi-navigator-integration',
    hooks: {
      'astro:config:setup': async ({
        logger,
        createCodegenDir,
        updateConfig,
        addWatchFile,
        command,
      }) => {
        logger.debug(
          `starlight-openapi-navigator[${resolvedOptions.instanceId}]: using spec at ${resolvedOptions.specLabel}`
        );

        if (resolvedOptions.specSource.type === 'file' && resolvedOptions.specFilePath) {
          addWatchFile(resolvedOptions.specFilePath);
        }

        const codegenDirUrl = createCodegenDir();
        const baseCodegenDirPath = fileURLToPath(codegenDirUrl);
        const instanceDirPath = path.join(baseCodegenDirPath, resolvedOptions.instanceId);
        await fs.rm(instanceDirPath, { recursive: true, force: true });
        await fs.mkdir(instanceDirPath, { recursive: true });

        codegenDirPath = instanceDirPath;
        specModulePath = path.join(
          codegenDirPath,
          'starlight-openapi-navigator-spec.mjs'
        );
        configModulePath = path.join(
          codegenDirPath,
          'starlight-openapi-navigator-config.mjs'
        );

        const instanceComponentsDir = path.join(codegenDirPath, 'components');
        const instanceRuntimeDir = path.join(codegenDirPath, 'runtime');
        const replacements = [
          ['virtual:starlight-openapi-navigator/spec-data', resolvedOptions.specAlias],
          ['virtual:starlight-openapi-navigator/config', resolvedOptions.configAlias],
        ];
        await copyTemplateDir(PACKAGE_COMPONENTS_DIR, instanceComponentsDir, replacements);
        await copyTemplateDir(PACKAGE_RUNTIME_DIR, instanceRuntimeDir, replacements);
        componentsDirPath = instanceComponentsDir;

        await regenerateArtifacts(logger);

        const aliasEntries = {
          [resolvedOptions.specAlias]: pathToFileURL(specModulePath).href,
          [resolvedOptions.configAlias]: pathToFileURL(configModulePath).href,
        };

        updateConfig({
          vite: {
            resolve: {
              alias: aliasEntries,
            },
          },
        });

        if (command === 'dev' && devProxyTable.length) {
          const proxyConfig = buildViteProxyConfig(devProxyTable);
          if (Object.keys(proxyConfig).length) {
            updateConfig({
              vite: {
                server: {
                  proxy: proxyConfig,
                },
              },
            });
          }
        }
      },
      'astro:server:setup': async ({ server, logger }) => {
        if (
          !resolvedOptions.watchSpec ||
          resolvedOptions.specSource.type !== 'file' ||
          !resolvedOptions.specFilePath
        ) {
          return;
        }
        const watcherHandler = (changedPath) => {
          if (path.resolve(changedPath) === resolvedOptions.specFilePath) {
            logger.debug(
              `starlight-openapi-navigator[${resolvedOptions.instanceId}]: detected change in ${resolvedOptions.specFilePath}, regenerating…`
            );
            regenerateArtifacts(logger);
          }
        };

        server.watcher.on('change', watcherHandler);
        server.watcher.on('add', watcherHandler);
      },
      'astro:server:start': async ({ logger }) => {
        if (!artifactsReady) {
          await regenerateArtifacts(logger);
        }
      },
      'astro:build:start': async ({ logger }) => {
        await regenerateArtifacts(logger);
      },
    },
  };
}

function resolveSpecSource(rawInput) {
  const value = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (isRemoteSpecPath(value)) {
    return { type: 'url', url: value };
  }
  const input = value || 'public/openapi.yaml';
  const absolutePath = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
  return { type: 'file', path: absolutePath };
}

function isRemoteSpecPath(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed);
}

function formatSpecLabel(specSource) {
  if (!specSource || typeof specSource !== 'object') return 'unknown spec source';
  if (specSource.type === 'url' && typeof specSource.url === 'string') {
    return specSource.url;
  }
  if (specSource.type === 'file' && typeof specSource.path === 'string') {
    const relative = path.relative(process.cwd(), specSource.path);
    if (relative && !relative.startsWith('..')) {
      return relative || specSource.path;
    }
    return specSource.path;
  }
  return 'unknown spec source';
}

function normalizeBaseSlug(input) {
  if (typeof input !== 'string') return 'api';
  const segments = input
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length ? segments.join('/') : 'api';
}

function slugToSegments(slug) {
  return slug.split('/').filter(Boolean);
}

function normalizeNavigationOptions(rawOptions, baseSlug) {
  const options = isPlainObject(rawOptions) ? rawOptions : {};
  const groupLabel = toNonEmptyString(options.groupLabel) || 'API Explorer';
  const replaceLabelRaw = toNonEmptyString(options.replaceGroupLabel);
  const replaceLabel = replaceLabelRaw || groupLabel;
  const insertBefore = toNonEmptyString(options.insertBefore) || null;
  const insertAfter = toNonEmptyString(options.insertAfter) || null;
  const overviewDefaults = {
    label: 'Overview',
    link: joinUrlSegments(baseSlug),
  };
  const schemasDefaults = {
    label: 'Schemas',
    link: joinUrlSegments(baseSlug, 'schemas'),
  };

  const result = {
    enabled: Boolean(options.enabled),
    groupLabel,
    replaceLabel,
    insertPosition: options.insertPosition === 'prepend' ? 'prepend' : 'append',
    insertBefore,
    insertAfter,
    tagSort: options.tagSort === 'alpha' ? 'alpha' : 'spec',
    operationSort: options.operationSort === 'alpha' ? 'alpha' : 'spec',
    operationLabel: options.operationLabel === 'path' ? 'path' : 'summary',
    overviewItem: normalizeNavigationItem(options.overviewItem, overviewDefaults),
    schemasItem:
      options.schemasItem === false
        ? null
        : normalizeNavigationItem(options.schemasItem, schemasDefaults),
  };

  if (options.operationTitle === 'path' || options.operationTitle === 'summary') {
    result.operationTitle = options.operationTitle;
  } else {
    result.operationTitle = result.operationLabel === 'summary' ? 'path' : 'summary';
  }

  return result;
}

function normalizeTryItOptions(rawValue) {
  if (rawValue === false) {
    return { enabled: false };
  }
  if (rawValue === true || rawValue === undefined || rawValue === null) {
    return { enabled: true };
  }
  if (isPlainObject(rawValue)) {
    return {
      enabled: rawValue.enabled !== false,
    };
  }
  return { enabled: true };
}

function normalizeNavigationItem(rawItem, defaults) {
  if (rawItem === false) return null;
  const item = { ...defaults };

  if (isPlainObject(rawItem)) {
    const label = toNonEmptyString(rawItem.label);
    if (label) item.label = label;
    const link = toNonEmptyString(rawItem.link);
    if (link) item.link = ensureTrailingSlash(ensureLeadingSlash(link));

    if ('badge' in rawItem) {
      if (isPlainObject(rawItem.badge)) {
        const text = toNonEmptyString(rawItem.badge.text);
        if (text) {
          item.badge = {
            text,
            variant: toNonEmptyString(rawItem.badge.variant) || 'note',
          };
        }
      } else if (rawItem.badge === null) {
        delete item.badge;
      }
    }
  }

  if (!item.label || !item.link) return null;

  item.link = ensureTrailingSlash(ensureLeadingSlash(item.link));
  return item;
}

function customizeSpec(spec, options) {
  /** @type {any} */
  const cloned = {
    info: spec?.info ?? {},
    servers: Array.isArray(spec?.servers) ? spec.servers : [],
    tags: Array.isArray(spec?.tags) ? spec.tags : [],
    operations: Array.isArray(spec?.operations) ? spec.operations : [],
    document: spec?.document ?? {},
  };

  const includeSet = createNormalizedSet(options.tags?.include);
  const excludeSet = createNormalizedSet(options.tags?.exclude);
  const overridesMap = createOverridesMap(options.tags?.overrides);
  const orderMap = createOrderMap(options.tags?.order);
  const includeLanguagesSet = createNormalizedSet(options.codeSamples?.includeLanguages);
  const renameMap = createRenameMap(options.codeSamples?.rename);

  cloned.tags = Array.isArray(cloned.tags)
    ? cloned.tags.filter((tag) => allowTag(tag, includeSet, excludeSet))
    : [];

  const allowedTagSlugs = new Set(cloned.tags.map((tag) => tag.slug));

  cloned.operations = Array.isArray(cloned.operations)
    ? cloned.operations
        .map((operation) => {
          operation.tags = Array.isArray(operation.tags)
            ? operation.tags.filter((tagRef) => allowedTagSlugs.has(tagRef.slug))
            : [];
          operation.codeSampleGroups = filterCodeSampleGroups(
            operation.codeSampleGroups,
            includeLanguagesSet,
            renameMap
          );
          return operation;
        })
        .filter((operation) => operation.tags.length > 0)
    : [];

  const tagMap = new Map();
  cloned.tags = cloned.tags.map((tag) => {
    const copy = { ...tag, operations: [] };
    tagMap.set(tag.slug, copy);
    return copy;
  });

  cloned.operations.forEach((operation) => {
    operation.tags.forEach((tagRef) => {
      const tag = tagMap.get(tagRef.slug);
      if (tag) tag.operations.push(operation);
    });
  });

  cloned.tags = cloned.tags.filter((tag) => tag.operations.length > 0);

  cloned.tags.forEach((tag) => {
    const override = findOverride(overridesMap, tag);
    if (override?.description) {
      tag.description = override.description;
    }
    const displayName = override?.label || tag.name;
    tag.metadata = {
      displayName,
      sidebarLabel: override?.sidebarLabel || displayName,
    };
  });

  cloned.tags.sort((a, b) => {
    const orderA = getTagOrder(orderMap, a);
    const orderB = getTagOrder(orderMap, b);
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });

  cloned.tags.forEach((tag) => {
    const methodCounts = {};
    let deprecatedCount = 0;
    tag.operations.forEach((operation) => {
      methodCounts[operation.method] = (methodCounts[operation.method] || 0) + 1;
      if (operation.deprecated) deprecatedCount += 1;
    });
    tag.stats = {
      operations: tag.operations.length,
      deprecated: deprecatedCount,
      methods: methodCounts,
    };
  });

  cloned.stats = {
    tags: cloned.tags.length,
    operations: cloned.operations.length,
    untaggedOperations: cloned.operations.filter((operation) => operation.tags.length === 0).length,
    deprecatedOperations: cloned.operations.filter((operation) => operation.deprecated).length,
  };

  if (isPlainObject(cloned.document) && Array.isArray(cloned.document.tags)) {
    const tagLookup = new Map();
    cloned.tags.forEach((tag) => {
      tagLookup.set(normalizeTagKey(tag.name), tag);
      tagLookup.set(normalizeTagKey(tag.slug), tag);
    });

    cloned.document.tags = cloned.document.tags
      .filter((docTag) => {
        const key = normalizeTagKey(docTag?.name);
        if (!key) return false;
        return tagLookup.has(key);
      })
      .map((docTag) => {
        const key = normalizeTagKey(docTag?.name);
        const match = tagLookup.get(key);
        if (match) {
          return {
            ...docTag,
            description: match.description,
          };
        }
        return docTag;
      });

    if (orderMap.size) {
      cloned.document.tags.sort((a, b) => {
        const tagA = tagLookup.get(normalizeTagKey(a?.name));
        const tagB = tagLookup.get(normalizeTagKey(b?.name));
        const orderA = tagA ? getTagOrder(orderMap, tagA) : Number.POSITIVE_INFINITY;
        const orderB = tagB ? getTagOrder(orderMap, tagB) : Number.POSITIVE_INFINITY;
        if (orderA !== orderB) return orderA - orderB;
        const nameA = typeof a?.name === 'string' ? a.name : '';
        const nameB = typeof b?.name === 'string' ? b.name : '';
        return nameA.localeCompare(nameB);
      });
    }
  }

  return cloned;
}

function buildNavigationGroup(spec, navigation, baseSlug, endpointUI = 'menu') {
  if (!navigation?.enabled || !Array.isArray(spec?.tags)) return null;

  const tags = navigation.tagSort === 'alpha'
    ? [...spec.tags].sort((a, b) => getTagLabel(a).localeCompare(getTagLabel(b)))
    : [...spec.tags];
  const includeOperations = endpointUI === 'menu';

  const items = [];

  if (navigation.overviewItem) {
    items.push(navigation.overviewItem);
  }

  if (includeOperations) {
    tags.forEach((tag) => {
      const operations = Array.isArray(tag.operations) ? [...tag.operations] : [];
      if (!operations.length) return;

      if (navigation.operationSort === 'alpha') {
        operations.sort((a, b) => {
          const labelA = getOperationLabel(a, navigation.operationLabel);
          const labelB = getOperationLabel(b, navigation.operationLabel);
          return labelA.localeCompare(labelB);
        });
      }

      const operationItems = operations
        .filter((operation) => operation?.slug)
        .map((operation) => {
          const link = joinUrlSegments(baseSlug, tag.slug, operation.slug);
          const label = getOperationLabel(operation, navigation.operationLabel);
          let title = getOperationLabel(operation, navigation.operationTitle, { fallback: false });
          if (!title) {
            title = label;
          }
          /** @type {{ label: string, link: string, badge?: { text: string, variant?: string } }} */
          const item = {
            label,
            link,
          };
          if (title) {
            item.attrs = { title };
          }
          if (operation.deprecated) {
            item.badge = { text: 'Deprecated', variant: 'caution' };
          }
          return item;
        })
        .filter(Boolean);

      if (operationItems.length === 0) return;

      items.push({
        label: getTagLabel(tag),
        items: operationItems,
      });
    });
  }

  if (navigation.schemasItem && Array.isArray(spec.schemas) && spec.schemas.length > 0) {
    const schemasLink = navigation.schemasItem.link || joinUrlSegments(baseSlug, 'schemas');
    items.push({
      ...navigation.schemasItem,
      link: ensureTrailingSlash(schemasLink),
    });
  }

  if (items.length === 0) return null;

  return {
    label: navigation.groupLabel,
    items,
  };
}

function mergeSidebarWithGroup(sidebar, group, navigation) {
  const normalizedSidebar = Array.isArray(sidebar) ? [...sidebar] : [];
  const replaceLabel = navigation?.replaceLabel;
  const groupLabel = navigation?.groupLabel;

  if (replaceLabel) {
    const index = normalizedSidebar.findIndex((entry) => entry?.label === replaceLabel);
    if (index !== -1) {
      normalizedSidebar.splice(index, 1, group);
      return normalizedSidebar;
    }
  }

  for (let idx = normalizedSidebar.length - 1; idx >= 0; idx -= 1) {
    if (normalizedSidebar[idx]?.label === groupLabel) {
      normalizedSidebar.splice(idx, 1);
    }
  }

  if (navigation?.insertBefore) {
    const index = normalizedSidebar.findIndex((entry) => entry?.label === navigation.insertBefore);
    if (index !== -1) {
      normalizedSidebar.splice(index, 0, group);
      return normalizedSidebar;
    }
  }

  if (navigation?.insertAfter) {
    const index = normalizedSidebar.findIndex((entry) => entry?.label === navigation.insertAfter);
    if (index !== -1) {
      normalizedSidebar.splice(index + 1, 0, group);
      return normalizedSidebar;
    }
  }

  if (navigation?.insertPosition === 'prepend') {
    normalizedSidebar.unshift(group);
  } else {
    normalizedSidebar.push(group);
  }

  return normalizedSidebar;
}

function getTagLabel(tag) {
  return toNonEmptyString(tag?.metadata?.sidebarLabel)
    || toNonEmptyString(tag?.metadata?.displayName)
    || toNonEmptyString(tag?.name)
    || 'Tag';
}

function getOperationLabel(operation, mode, { fallback = true } = {}) {
  const method = toNonEmptyString(operation?.method)?.toUpperCase();
  const summary = toNonEmptyString(operation?.summary);
  const path = toNonEmptyString(operation?.path);
  if (mode === 'path') {
    const value = [method, path].filter(Boolean).join(' ').trim();
    if (value) return value;
    if (!fallback) return '';
    return summary || 'Operation';
  }
  if (summary) return summary;
  const value = [method, path].filter(Boolean).join(' ').trim();
  if (value) return value;
  if (!fallback) return '';
  return 'Operation';
}

function cloneSidebar(sidebar) {
  if (!Array.isArray(sidebar)) return [];
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(sidebar);
  }
  return JSON.parse(JSON.stringify(sidebar));
}

function createNormalizedSet(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const set = new Set();
  for (const value of values) {
    const normalized = normalizeTagKey(value);
    if (normalized) set.add(normalized);
  }
  return set.size ? set : null;
}

function normalizeTagKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function allowTag(tag, includeSet, excludeSet) {
  const nameKey = normalizeTagKey(tag?.name);
  const slugKey = normalizeTagKey(tag?.slug);

  if (includeSet && !includeSet.has(nameKey) && !includeSet.has(slugKey)) {
    return false;
  }

  if (excludeSet && (excludeSet.has(nameKey) || excludeSet.has(slugKey))) {
    return false;
  }

  return true;
}

function createOverridesMap(overrides = {}) {
  const map = new Map();
  if (!overrides || typeof overrides !== 'object') return map;
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = normalizeTagKey(key);
    if (!normalized || !value || typeof value !== 'object') continue;
    map.set(normalized, value);
  }
  return map;
}

function findOverride(map, tag) {
  if (!(map instanceof Map)) return undefined;
  const nameKey = normalizeTagKey(tag?.name);
  const slugKey = normalizeTagKey(tag?.slug);
  return map.get(nameKey) || map.get(slugKey);
}

function createOrderMap(orderList = []) {
  const map = new Map();
  if (!Array.isArray(orderList)) return map;
  orderList.forEach((value, index) => {
    const normalized = normalizeTagKey(value);
    if (normalized !== '') map.set(normalized, index);
  });
  return map;
}

function getTagOrder(orderMap, tag) {
  if (!(orderMap instanceof Map) || orderMap.size === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const nameKey = normalizeTagKey(tag?.name);
  const slugKey = normalizeTagKey(tag?.slug);
  if (orderMap.has(nameKey)) return orderMap.get(nameKey);
  if (orderMap.has(slugKey)) return orderMap.get(slugKey);
  return Number.POSITIVE_INFINITY;
}

function createRenameMap(rename = {}) {
  const map = new Map();
  if (!rename || typeof rename !== 'object') return map;
  for (const [key, value] of Object.entries(rename)) {
    const normalized = normalizeLanguageKey(key);
    if (!normalized || typeof value !== 'string') continue;
    map.set(normalized, value);
  }
  return map;
}

function normalizeLanguageKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function filterCodeSampleGroups(groups, includeSet, renameMap) {
  if (!Array.isArray(groups) || groups.length === 0) return [];
  return groups
    .map((group) => {
      const samples = Array.isArray(group.samples)
        ? group.samples.filter((sample) => {
            if (!sample || typeof sample.language !== 'string') return false;
            const languageKey = normalizeLanguageKey(sample.language);
            if (includeSet && (!languageKey || !includeSet.has(languageKey))) {
              return false;
            }
            if (renameMap instanceof Map && renameMap.has(languageKey)) {
              sample.language = renameMap.get(languageKey);
            }
            return true;
          })
        : [];
      return { ...group, samples };
    })
    .filter((group) => group.samples.length > 0);
}

function toNonEmptyString(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed : '';
}

function ensureLeadingSlash(pathname) {
  if (!pathname) return '/';
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function ensureTrailingSlash(pathname) {
  if (!pathname) return '/';
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function joinUrlSegments(...segments) {
  const parts = [];
  segments.forEach((segment) => {
    if (typeof segment !== 'string') return;
    segment
      .split('/')
      .map((part) => part.replace(/^\s+|\s+$/g, ''))
      .forEach((part) => {
        const cleaned = part.replace(/^\/+|\/+$/g, '');
        if (cleaned) parts.push(cleaned);
      });
  });
  if (parts.length === 0) return '/';
  return ensureTrailingSlash(`/${parts.join('/')}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildDevProxyTable(spec) {
  const entries = [];
  const seen = new Set();

  const enqueue = (url) => {
    const parsed = parseServerUrl(url);
    if (!parsed || seen.has(parsed.normalizedUrl)) return;

    const contextPath = buildContextPath(parsed, entries.length);
    const rewritePath = parsed.pathname || '/';

    entries.push({
      id: entries.length,
      originalUrl: parsed.originalUrl,
      normalizedUrl: parsed.normalizedUrl,
      target: parsed.origin,
      contextPath,
      rewritePath,
    });
    seen.add(parsed.normalizedUrl);
  };

  (spec.servers || []).forEach((server) => enqueue(server?.url));
  (spec.operations || []).forEach((operation) => {
    (operation.servers || []).forEach((server) => enqueue(server?.url));
  });

  return entries;
}

const OPERATIONS_PER_CHUNK = 50;

function createRuntimeSpecArtifacts(spec) {
  if (!isPlainObject(spec)) {
    return {
      manifest: {
        info: {},
        servers: [],
        stats: { operations: 0, tags: 0, deprecatedOperations: 0, untaggedOperations: 0 },
        document: {},
      },
      tagsWithDigests: [],
      allOperationDigests: [],
      schemaList: [],
      schemaSlugMap: {},
      schemaDefinitions: [],
      chunks: [],
      operationChunkLookup: {},
    };
  }

  const tagsWithDigests = [];
  const chunks = [];
  const operationChunkLookup = {};
  const allOperationDigests = [];
  const schemaList = [];
  const schemaDefinitions = [];
  const schemaSlugMap = {};

  const sourceTags = Array.isArray(spec.tags) ? spec.tags : [];
  sourceTags.forEach((tag) => {
    if (!tag || typeof tag.slug !== 'string') return;

    const digestOperations = [];
    const chunkCandidates = [];
    const operations = Array.isArray(tag.operations) ? tag.operations : [];

    operations.forEach((operation) => {
      const digest = createOperationDigest(operation);
      if (digest) {
        digestOperations.push(digest);
        const indexEntry = {
          ...digest,
          tagSlug: tag.slug,
          tagName:
            (tag.metadata && typeof tag.metadata.displayName === 'string'
              ? tag.metadata.displayName
              : tag.name) || tag.slug,
        };
        allOperationDigests.push(indexEntry);
      }
      const stripped = stripOperationForChunk(operation);
      if (stripped && stripped.slug) {
        chunkCandidates.push(stripped);
      }
    });

    tagsWithDigests.push({
      name: tag.name,
      slug: tag.slug,
      description: tag.description,
      externalDocs: tag.externalDocs,
      isFallback: Boolean(tag.isFallback),
      stats: tag.stats,
      metadata: tag.metadata,
      extensions: tag.extensions,
      operations: digestOperations,
    });

    for (let start = 0; start < chunkCandidates.length; start += OPERATIONS_PER_CHUNK) {
      const slice = chunkCandidates.slice(start, start + OPERATIONS_PER_CHUNK);
      if (!slice.length) continue;
      const chunkIndex = Math.floor(start / OPERATIONS_PER_CHUNK);
      const chunkId = createChunkId(tag.slug, chunkIndex);
      const fileName = buildChunkFileName(chunkId);
      const operationsMap = {};
      slice.forEach((entry) => {
        operationsMap[entry.slug] = entry;
        if (!operationChunkLookup[entry.slug]) {
          operationChunkLookup[entry.slug] = chunkId;
        }
      });
      chunks.push({
        id: chunkId,
        tagSlug: tag.slug,
        fileName,
        operations: operationsMap,
      });
    }
  });

  if (Array.isArray(spec.schemas)) {
    spec.schemas.forEach((entry) => {
      if (!entry || typeof entry.name !== 'string') return;
      const slug = typeof entry.slug === 'string' ? entry.slug : undefined;
      if (slug) {
        schemaSlugMap[entry.name] = slug;
      }
      schemaList.push({
        name: entry.name,
        slug: slug,
        description: entry.description,
      });
      if (entry.schema && typeof entry.schema === 'object') {
        const rawSlug =
          typeof slug === 'string' && slug.length
            ? slug
            : typeof entry.name === 'string' && entry.name.length
              ? entry.name.toLowerCase()
              : '';
        const safeSlug = rawSlug
          .replace(/[^a-zA-Z0-9._-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        if (safeSlug) {
          schemaDefinitions.push({
            slug: safeSlug,
            name: entry.name,
            schema: entry.schema,
          });
        }
      }
    });
  }

  const manifest = {
    info: isPlainObject(spec.info) ? spec.info : {},
    servers: Array.isArray(spec.servers) ? spec.servers : [],
    stats: isPlainObject(spec.stats) ? spec.stats : {},
    document: buildRuntimeDocument(spec.document),
  };

  return {
    manifest,
    tagsWithDigests,
    allOperationDigests,
    schemaList,
    schemaSlugMap,
    schemaDefinitions,
    chunks,
    operationChunkLookup,
  };
}

function stripOperationForChunk(operation) {
  if (!isPlainObject(operation)) return null;
  const {
    path,
    method,
    operationId,
    slug,
    summary,
    description,
    deprecated,
    tags,
    parameters,
    requestBody,
    responses,
    security,
    servers,
    codeSampleGroups,
    requestBodyExamples,
    responseExamples,
    extensions,
  } = operation;

  const normalized = {
    path,
    method,
    operationId,
    slug,
    summary,
    description,
    deprecated,
    tags,
    parameters,
    requestBody,
    responses,
    security,
    servers,
    codeSampleGroups,
    requestBodyExamples,
    responseExamples,
  };

  if (extensions && Object.keys(extensions).length) {
    normalized.extensions = extensions;
  }

  return normalized;
}

function stripSchemaForRuntime(schemaEntry) {
  if (!isPlainObject(schemaEntry)) return null;
  const { name, slug, schema, description, extensions } = schemaEntry;
  return {
    name,
    slug,
    schema,
    description,
    extensions,
  };
}

function createOperationDigest(operation) {
  if (!isPlainObject(operation)) return null;
  if (typeof operation.slug !== 'string') return null;
  const method = typeof operation.method === 'string' ? operation.method.toUpperCase() : '';
  const path = typeof operation.path === 'string' ? operation.path : '';
  const summary = typeof operation.summary === 'string' ? operation.summary : '';
  if (!path && !summary) return null;
  return {
    slug: operation.slug,
    method,
    path,
    summary,
    deprecated: Boolean(operation.deprecated),
  };
}

function createChunkId(tagSlug, chunkIndex = 0) {
  const base = typeof tagSlug === 'string' && tagSlug.length ? tagSlug : 'untagged';
  return `tag:${base}:chunk:${chunkIndex}`;
}

function buildChunkFileName(chunkId) {
  const safe = chunkId.replace(/[^a-zA-Z0-9:_-]/g, '-').replace(/:+/g, '-');
  const collapsed = safe.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `operations-${collapsed || 'chunk'}.json`;
}

function buildSchemaDefinitionFileName(slug, name) {
  const base =
    (typeof slug === 'string' && slug.length
      ? slug
      : typeof name === 'string' && name.length
        ? name
        : 'schema-definition');
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `schema-${safe || 'definition'}.json`;
}

function buildRuntimeDocument(document) {
  if (!isPlainObject(document)) return {};

  /** @type {Record<string, unknown>} */
  const result = {};

  if (Array.isArray(document.security)) {
    result.security = document.security;
  }

  if (isPlainObject(document.components) && isPlainObject(document.components.securitySchemes)) {
    result.components = {
      securitySchemes: document.components.securitySchemes,
    };
  }

  return result;
}

function parseServerUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const rawPath = parsed.pathname || '/';
    const cleanPath = rawPath === '/' ? '' : rawPath.replace(/\/+$/g, '');
    const normalizedUrl = `${origin}${cleanPath}`;
    return {
      originalUrl: trimmed,
      origin,
      pathname: cleanPath || '/',
      normalizedUrl,
      host: parsed.host,
      pathSegments: rawPath.split('/').filter(Boolean),
    };
  } catch {
    return null;
  }
}

function buildContextPath(parsed, index) {
  const hostSegment = parsed.host.replace(/[^a-zA-Z0-9]/g, '-');
  const pathSegments = parsed.pathSegments.map((segment) => segment.replace(/[^a-zA-Z0-9]/g, '-'));
  const segments = ['__openapi', hostSegment || `origin-${index}`, ...pathSegments];
  return `/${segments.filter(Boolean).join('/')}`;
}

function buildViteProxyConfig(table) {
  const proxy = {};
  table.forEach((entry) => {
    const pattern = new RegExp(`^${escapeRegex(entry.contextPath)}`);
    const rewriteBase = entry.rewritePath && entry.rewritePath !== '/' ? entry.rewritePath : '';
    proxy[entry.contextPath] = {
      target: entry.target,
      changeOrigin: true,
      secure: entry.target.startsWith('https://'),
      ws: false,
      rewrite: (path) => {
        const stripped = path.replace(pattern, '');
        const segments = [];
        if (rewriteBase) segments.push(rewriteBase.replace(/^\/+|\/+$/g, ''));
        if (stripped) segments.push(stripped.replace(/^\/+/, ''));
        const joined = segments.filter(Boolean).join('/');
        return joined ? `/${joined}` : '/';
      },
    };
  });
  return proxy;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
