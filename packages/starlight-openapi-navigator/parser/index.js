import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

const DEFAULT_UNTAGGED_NAME = 'Untagged';

/**
 * @typedef {object} NormalizedOperationTagRef
 * @property {string} name
 * @property {string} slug
 * @property {boolean} isFallback
 */

/**
 * @typedef {object} NormalizedCodeSample
 * @property {string} slug
 * @property {string} label
 * @property {string} language
 * @property {string} syntax
 * @property {string} source
 * @property {Record<string, unknown>} extensions
 */

/**
 * @typedef {object} NormalizedCodeSampleGroup
 * @property {string} label
 * @property {NormalizedCodeSample[]} samples
 */

/**
 * @typedef {object} NormalizedOperation
 * @property {string} path
 * @property {string} method
 * @property {string} operationId
 * @property {string} slug
 * @property {string | undefined} summary
 * @property {string | undefined} description
 * @property {boolean} deprecated
 * @property {NormalizedOperationTagRef[]} tags
 * @property {Array<Record<string, unknown>>} parameters
 * @property {Record<string, unknown> | undefined} requestBody
 * @property {Record<string, unknown>} responses
 * @property {Array<Record<string, unknown>> | undefined} security
 * @property {Array<Record<string, unknown>> | undefined} servers
 * @property {NormalizedCodeSampleGroup[]} codeSampleGroups
 * @property {NormalizedRequestExampleGroup[]} requestBodyExamples
 * @property {NormalizedResponseExampleGroup[]} responseExamples
  * @property {Record<string, unknown>} extensions
  * @property {Record<string, unknown>} raw
 */

/**
 * @typedef {object} NormalizedTagStats
 * @property {number} operations
 * @property {number} deprecated
 * @property {Record<string, number>} methods
 */

/**
 * @typedef {object} NormalizedTag
 * @property {string} name
 * @property {string} slug
 * @property {string | undefined} description
 * @property {{ description?: string; url: string } | undefined} externalDocs
 * @property {boolean} isFallback
 * @property {NormalizedOperation[]} operations
 * @property {NormalizedTagStats} stats
 * @property {Record<string, unknown>} extensions
 * @property {{ displayName?: string; sidebarLabel?: string } | undefined} metadata
 */

/**
 * @typedef {object} NormalizedSchema
 * @property {string} name
 * @property {string} slug
 * @property {Record<string, unknown>} schema
 * @property {string | undefined} description
 * @property {Record<string, unknown>} extensions
 */

/**
 * @typedef {object} NormalizedOpenApiSpec
 * @property {string} sourcePath
 * @property {Record<string, unknown>} document
 * @property {Record<string, unknown>} info
 * @property {Array<Record<string, unknown>>} servers
 * @property {Record<string, unknown>} components
 * @property {NormalizedTag[]} tags
 * @property {NormalizedOperation[]} operations
 * @property {{ tags: number; operations: number; untaggedOperations: number; deprecatedOperations: number }} stats
 * @property {NormalizedSchema[]} schemas
 */

/**
 * @typedef {object} NormalizedExample
 * @property {string} slug
 * @property {string} key
 * @property {string} label
 * @property {string} value
 * @property {string | undefined} language
 * @property {boolean} isExternal
 * @property {string | undefined} externalValue
 * @property {string | undefined} description
 */

/**
 * @typedef {object} NormalizedRequestExampleGroup
 * @property {string} contentType
 * @property {string} syntax
 * @property {NormalizedExample[]} examples
 */

/**
 * @typedef {object} NormalizedResponseExampleGroup
 * @property {string} status
 * @property {string} contentType
 * @property {string} syntax
 * @property {NormalizedExample[]} examples
 */

/**
 * Load and normalize an OpenAPI specification for downstream page generation.
 *
 * @param {string | { type: 'url', url: string } | { type: 'file', path: string }} specPath
 * @returns {Promise<NormalizedOpenApiSpec>}
 */
export async function loadAndNormalizeSpec(specPath) {
  const specSource = normalizeSpecSource(specPath);
  const sourceLabel = specSource.type === 'url' ? specSource.url : specSource.path;

  let rawContents;
  if (specSource.type === 'url') {
    try {
      const response = await fetch(specSource.url);
      if (!response.ok) {
        throw new Error(
          `Received ${response.status} ${response.statusText || ''}`.trim()
        );
      }
      rawContents = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `starlight-openapi-navigator: Unable to fetch OpenAPI spec from ${specSource.url}.` +
          `\n→ ${reason}`
      );
    }
  } else {
    try {
      rawContents = await fs.readFile(specSource.path, 'utf8');
    } catch (error) {
      throw new Error(
        `starlight-openapi-navigator: Unable to read OpenAPI spec at ${specSource.path}.` +
          `\n→ ${error?.message || error}`
      );
    }
  }

  let document;
  try {
    document = parse(rawContents);
  } catch (error) {
    throw new Error(
      `starlight-openapi-navigator: Failed to parse OpenAPI spec at ${sourceLabel}.` +
        `\n→ ${error?.message || error}`
    );
  }

  if (!isPlainObject(document)) {
    throw new Error(
      `starlight-openapi-navigator: Expected OpenAPI document at ${sourceLabel} to be an object.`
    );
  }

  const defaultSecurity = Array.isArray(document.security)
    ? document.security
    : undefined;
  const topLevelServers = Array.isArray(document.servers) ? document.servers : undefined;

  const tagOrder = new Map();
  if (Array.isArray(document.tags)) {
    document.tags.forEach((tag, index) => {
      if (tag && typeof tag.name === 'string') {
        tagOrder.set(tag.name, index);
      }
    });
  }

  const tagSlugFactory = createSlugFactory('tag');
  const operationSlugFactory = createSlugFactory('operation');

  /** @type {Map<string, NormalizedTag>} */
  const tagsByName = new Map();
  const operations = [];

  const registerTag = (name, meta = {}) => {
    const tagName = typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_UNTAGGED_NAME;
    if (tagsByName.has(tagName)) {
      const existing = tagsByName.get(tagName);
      if (existing && !existing.description && typeof meta.description === 'string') {
        existing.description = meta.description;
      }
      if (existing && !existing.externalDocs && isPlainObject(meta.externalDocs)) {
        const extDocs = meta.externalDocs;
        if (typeof extDocs.url === 'string') {
          existing.externalDocs = {
            url: extDocs.url,
            description: typeof extDocs.description === 'string' ? extDocs.description : undefined,
          };
        }
      }
      if (existing && !Object.keys(existing.extensions).length) {
        existing.extensions = pickExtensions(meta);
      }
      return existing;
    }

    const slug = tagSlugFactory(tagName, tagName === DEFAULT_UNTAGGED_NAME ? 'untagged' : tagName);
    /** @type {NormalizedTag} */
    const tag = {
      name: tagName,
      slug,
      description: typeof meta.description === 'string' ? meta.description : undefined,
      externalDocs: buildExternalDocs(meta.externalDocs),
      isFallback: tagName === DEFAULT_UNTAGGED_NAME,
      operations: [],
      stats: {
        operations: 0,
        deprecated: 0,
        methods: {},
      },
      extensions: pickExtensions(meta),
      metadata: undefined,
    };

    tagsByName.set(tagName, tag);
    return tag;
  };

  if (Array.isArray(document.tags)) {
    document.tags.forEach((tag) => {
      if (isPlainObject(tag) && typeof tag.name === 'string') {
        registerTag(tag.name, tag);
      }
    });
  }

  const parameterDefinitions = buildParameterDefinitionMap(document.components?.parameters);

  const pathEntries = Object.entries(document.paths || {});
  for (const [pathKey, pathItem] of pathEntries) {
    if (!isPlainObject(pathItem)) continue;
    const pathLevelParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const [maybeMethod, operation] of Object.entries(pathItem)) {
      const method = maybeMethod.toLowerCase();
      if (!HTTP_METHODS.has(method)) continue;
      if (!isPlainObject(operation)) continue;

      const operationId = extractOperationId(operation, method, pathKey);
      const operationSlug = operationSlugFactory(operationId, 'operation');

      const operationTags = Array.isArray(operation.tags) && operation.tags.length
        ? operation.tags
        : [DEFAULT_UNTAGGED_NAME];

      const tagRefs = operationTags.map((tagName) => registerTag(tagName));

      const combinedParameters = mergeParameters(
        parameterDefinitions,
        pathLevelParameters,
        Array.isArray(operation.parameters) ? operation.parameters : []
      );

      /** @type {NormalizedOperation} */
      const normalizedOperation = {
        path: pathKey,
        method,
        operationId,
        slug: operationSlug,
        summary: typeof operation.summary === 'string' ? operation.summary : undefined,
        description: typeof operation.description === 'string' ? operation.description : undefined,
        deprecated: Boolean(operation.deprecated),
        tags: tagRefs.map((tag) => ({
          name: tag.name,
          slug: tag.slug,
          isFallback: tag.isFallback,
        })),
        parameters: combinedParameters,
        requestBody: isPlainObject(operation.requestBody) ? operation.requestBody : undefined,
        responses: isPlainObject(operation.responses) ? operation.responses : {},
        security: resolveSecurity(operation.security, pathItem.security, defaultSecurity),
        servers: resolveServers(operation.servers, pathItem.servers, topLevelServers),
        codeSampleGroups: normalizeCodeSamples(operation['x-codeSamples']),
        requestBodyExamples: [],
        responseExamples: [],
        extensions: pickExtensions(operation),
        raw: operation,
      };

      operations.push(normalizedOperation);
      tagRefs.forEach((tag) => {
        tag.operations.push(normalizedOperation);
      });
      normalizedOperation.requestBodyExamples = normalizeRequestBodyExamples(operation.requestBody);
      normalizedOperation.responseExamples = normalizeResponseExamples(operation.responses);
    }
  }

  const orderedTags = Array.from(tagsByName.values()).sort((a, b) => {
    const orderA = tagOrder.has(a.name) ? tagOrder.get(a.name) : Number.POSITIVE_INFINITY;
    const orderB = tagOrder.has(b.name) ? tagOrder.get(b.name) : Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    if (a.isFallback && !b.isFallback) return 1;
    if (!a.isFallback && b.isFallback) return -1;
    return a.name.localeCompare(b.name);
  });

  orderedTags.forEach((tag) => {
    const methodCounts = Object.create(null);
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

  const stats = {
    tags: orderedTags.length,
    operations: operations.length,
    untaggedOperations: operations.filter((op) => op.tags.every((tag) => tag.isFallback)).length,
    deprecatedOperations: operations.filter((op) => op.deprecated).length,
  };

  const schemas = normalizeSchemas(document.components?.schemas);

  return {
    sourcePath: sourceLabel,
    document,
    info: isPlainObject(document.info) ? document.info : {},
    servers: Array.isArray(document.servers) ? document.servers : [],
    components: isPlainObject(document.components) ? document.components : {},
    tags: orderedTags,
    operations,
    stats,
    schemas,
  };
}

function normalizeSpecSource(input) {
  if (input && typeof input === 'object') {
    if (input.type === 'url' && typeof input.url === 'string') {
      return { type: 'url', url: input.url.trim() };
    }
    if (input.type === 'file' && typeof input.path === 'string') {
      const pathValue = input.path.trim();
      const absolutePath = path.isAbsolute(pathValue)
        ? pathValue
        : path.join(process.cwd(), pathValue);
      return { type: 'file', path: absolutePath };
    }
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (isRemoteSpecPath(trimmed)) {
      return { type: 'url', url: trimmed };
    }
    const target = trimmed || 'public/openapi.yaml';
    const absolutePath = path.isAbsolute(target)
      ? target
      : path.join(process.cwd(), target);
    return { type: 'file', path: absolutePath };
  }

  const fallbackPath = path.join(process.cwd(), 'public', 'openapi.yaml');
  return { type: 'file', path: fallbackPath };
}

function isRemoteSpecPath(value) {
  if (typeof value !== 'string') return false;
  return /^https?:\/\//i.test(value.trim());
}

function extractOperationId(operation, method, pathKey) {
  if (typeof operation.operationId === 'string' && operation.operationId.trim()) {
    return operation.operationId.trim();
  }
  const fallback = `${method}_${pathKey}`
    .replace(/[{}]/g, '')
    .replace(/\//g, '_')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return fallback || `${method}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeParameters(parameterDefinitions, pathParams, operationParams) {
  /** @type {Array<Record<string, unknown>>} */
  const result = [];
  const indexByKey = new Map();

  const push = (param) => {
    const resolved = resolveParameter(parameterDefinitions, param);
    if (!resolved) return;
    const key = `${resolved.name ?? ''}:${resolved.in ?? ''}`;
    if (indexByKey.has(key)) {
      const existingIndex = indexByKey.get(key);
      result[existingIndex] = resolved;
    } else {
      indexByKey.set(key, result.length);
      result.push(resolved);
    }
  };

  pathParams.forEach(push);
  operationParams.forEach(push);

  return result;
}

function resolveParameter(parameterDefinitions, parameter) {
  if (!isPlainObject(parameter)) return undefined;

  let working = { ...parameter };

  if (typeof working.$ref === 'string') {
    const refName = decodeRefName(working.$ref);
    const referenced = parameterDefinitions.get(refName);
    if (!referenced) return undefined;
    working = mergeParameterObjects(referenced, working);
    delete working.$ref;
  }

  if (typeof working.name !== 'string' || !working.name) return undefined;
  if (typeof working.in !== 'string' || !working.in) return undefined;

  return working;
}

function mergeParameterObjects(base, override) {
  const merged = { ...base, ...override };
  if (isPlainObject(base.schema) || isPlainObject(override.schema)) {
    merged.schema = {
      ...(isPlainObject(base.schema) ? base.schema : {}),
      ...(isPlainObject(override.schema) ? override.schema : {}),
    };
  }
  if (isPlainObject(base.examples) || isPlainObject(override.examples)) {
    merged.examples = {
      ...(isPlainObject(base.examples) ? base.examples : {}),
      ...(isPlainObject(override.examples) ? override.examples : {}),
    };
  }
  return merged;
}

function buildParameterDefinitionMap(rawParameters) {
  const map = new Map();
  if (!isPlainObject(rawParameters)) return map;
  Object.entries(rawParameters).forEach(([name, value]) => {
    if (isPlainObject(value)) {
      map.set(name, value);
    }
  });
  return map;
}

function decodeRefName(pointer) {
  const match = typeof pointer === 'string' ? pointer.match(/#\/components\/parameters\/(.+)$/) : null;
  if (!match) return undefined;
  return match[1]?.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveSecurity(operationSecurity, pathSecurity, defaultSecurity) {
  if (Array.isArray(operationSecurity) && operationSecurity.length) return operationSecurity;
  if (Array.isArray(pathSecurity) && pathSecurity.length) return pathSecurity;
  return Array.isArray(defaultSecurity) && defaultSecurity.length ? defaultSecurity : undefined;
}

function resolveServers(operationServers, pathServers, topLevelServers) {
  if (Array.isArray(operationServers) && operationServers.length) return operationServers;
  if (Array.isArray(pathServers) && pathServers.length) return pathServers;
  return Array.isArray(topLevelServers) && topLevelServers.length ? topLevelServers : undefined;
}

function createSlugFactory(defaultSlug = 'item') {
  const seen = new Map();
  return (value, fallback = defaultSlug) => {
    const base = toSlug(value, fallback || defaultSlug);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    return `${base}-${count + 1}`;
  };
}

function toSlug(value, fallback = 'item') {
  const base = typeof value === 'string' && value.trim().length ? value.trim() : fallback;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function buildExternalDocs(externalDocs) {
  if (!isPlainObject(externalDocs)) return undefined;
  if (typeof externalDocs.url !== 'string') return undefined;
  return {
    url: externalDocs.url,
    description:
      typeof externalDocs.description === 'string' ? externalDocs.description : undefined,
  };
}

function pickExtensions(value) {
  if (!isPlainObject(value)) return {};
  /** @type {Record<string, unknown>} */
  const extensions = {};
  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith('x-')) {
      extensions[key] = val;
    }
  }
  return extensions;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const LANGUAGE_SYNTAX_MAP = new Map(
  Object.entries({
    curl: 'bash',
    'c#': 'csharp',
    'csharp': 'csharp',
    dotnet: 'csharp',
    javascript: 'javascript',
    'node.js': 'javascript',
    node: 'javascript',
    python: 'python',
    go: 'go',
    golang: 'go',
    java: 'java',
    shell: 'bash',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    text: 'text',
  })
);

function normalizeCodeSamples(rawSamples) {
  if (!Array.isArray(rawSamples) || !rawSamples.length) return [];

  /** @type {Map<string, NormalizedCodeSampleGroup>} */
  const groupsByLabel = new Map();
  const sampleSlugFactory = createSlugFactory('sample');

  rawSamples.forEach((entry, index) => {
    if (!isPlainObject(entry)) return;
    const label = typeof entry.label === 'string' && entry.label.trim()
      ? entry.label.trim()
      : `Example ${index + 1}`;
    const language = typeof entry.lang === 'string' && entry.lang.trim()
      ? entry.lang.trim()
      : 'Example';
    const source = typeof entry.source === 'string' ? entry.source : '';
    if (!source) return;

    const syntax = deriveSyntax(language);
    const slug = sampleSlugFactory(`${language}-${label}`, language);
    const group = getOrCreateGroup(groupsByLabel, label);
    group.samples.push({
      slug,
      label,
      language,
      syntax,
      source,
      extensions: pickExtensions(entry),
    });
  });

  return Array.from(groupsByLabel.values()).map((group) => {
    group.samples = dedupeSamples(group.samples);
    return group;
  });
}

function getOrCreateGroup(groupsByLabel, label) {
  if (groupsByLabel.has(label)) return groupsByLabel.get(label);
  const group = { label, samples: [] };
  groupsByLabel.set(label, group);
  return group;
}

function dedupeSamples(samples) {
  /** @type {Map<string, NormalizedCodeSample>} */
  const seen = new Map();
  samples.forEach((sample) => {
    const key = `${sample.language.toLowerCase()}::${sample.label}`;
    if (!seen.has(key)) {
      seen.set(key, sample);
    }
  });
  return Array.from(seen.values());
}

function deriveSyntax(language) {
  const key = language.toLowerCase();
  if (LANGUAGE_SYNTAX_MAP.has(key)) return LANGUAGE_SYNTAX_MAP.get(key);
  return toSlug(key) || 'plaintext';
}

const CONTENT_TYPE_SYNTAX_FALLBACKS = new Map(
  Object.entries({
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    javascript: 'javascript',
    'x-www-form-urlencoded': 'url',
    plain: 'text',
  })
);

function deriveSyntaxFromContentType(contentType) {
  if (!contentType) return 'plaintext';
  const lower = contentType.toLowerCase();
  if (CONTENT_TYPE_SYNTAX_FALLBACKS.has(lower)) {
    return CONTENT_TYPE_SYNTAX_FALLBACKS.get(lower);
  }
  for (const [key, value] of CONTENT_TYPE_SYNTAX_FALLBACKS.entries()) {
    if (lower.includes(key)) return value;
  }
  if (lower.startsWith('text/')) return 'text';
  return 'plaintext';
}

function normalizeRequestBodyExamples(requestBody) {
  if (!isPlainObject(requestBody)) return [];
  const content = requestBody.content;
  if (!isPlainObject(content)) return [];
  const slugFactory = createSlugFactory('example');
  /** @type {NormalizedRequestExampleGroup[]} */
  const groups = [];

  for (const [contentType, media] of Object.entries(content)) {
    const syntax = deriveSyntaxFromContentType(contentType);
    const examples = normalizeExamplesFromMedia(media, slugFactory, contentType, syntax);
    if (!examples.length) continue;
    groups.push({
      contentType,
      syntax,
      examples,
    });
  }

  return groups;
}

function normalizeResponseExamples(responses) {
  if (!isPlainObject(responses)) return [];
  const slugFactory = createSlugFactory('example');
  /** @type {NormalizedResponseExampleGroup[]} */
  const groups = [];

  for (const [status, response] of Object.entries(responses)) {
    if (!isPlainObject(response)) continue;
    const content = response.content;
    if (!isPlainObject(content)) continue;
    for (const [contentType, media] of Object.entries(content)) {
      const syntax = deriveSyntaxFromContentType(contentType);
      const examples = normalizeExamplesFromMedia(media, slugFactory, `${status}-${contentType}`, syntax);
      if (!examples.length) continue;
      groups.push({
        status,
        contentType,
        syntax,
        examples,
      });
    }
  }

  return groups;
}

function normalizeExamplesFromMedia(media, slugFactory, baseKey, syntax) {
  if (!isPlainObject(media)) return [];
  /** @type {NormalizedExample[]} */
  const examples = [];

  const addExample = ({ key, label, value, description, externalValue, isExternal, language }) => {
    const slug = slugFactory(`${baseKey}-${label || key || 'example'}`, 'example');
    examples.push({
      slug,
      key: key || label || slug,
      label: label || key || 'Example',
      value,
      language,
      description,
      externalValue,
      isExternal: Boolean(isExternal),
    });
  };

  if (media.example !== undefined) {
    const value = stringifyExampleValue(media.example);
    if (value) {
      addExample({ key: 'default', label: 'Example', value, description: media.description, language: syntax });
    }
  }

  if (isPlainObject(media.examples)) {
    for (const [key, entry] of Object.entries(media.examples)) {
      if (!isPlainObject(entry)) continue;
      if ('$ref' in entry) continue;

      const value = entry.value !== undefined ? stringifyExampleValue(entry.value) : '';
      const externalValue = typeof entry.externalValue === 'string' ? entry.externalValue : undefined;

      if (!value && !externalValue) continue;

      addExample({
        key,
        label: typeof entry.summary === 'string' && entry.summary.trim() ? entry.summary.trim() : key,
        value: value || (externalValue ? `External example available at ${externalValue}` : ''),
        description: typeof entry.description === 'string' ? entry.description : undefined,
        externalValue,
        isExternal: Boolean(externalValue && !value),
        language: syntax,
      });
    }
  }

  // ensure language defaults to syntax when not set
  if (syntax) {
    examples.forEach((example) => {
      if (!example.language) example.language = syntax;
    });
  }

  return examples;
}

function stringifyExampleValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function normalizeSchemas(rawSchemas) {
  if (!isPlainObject(rawSchemas)) return [];
  const schemaSlugFactory = createSlugFactory('schema');
  return Object.entries(rawSchemas).map(([name, schema]) => ({
    name,
    slug: schemaSlugFactory(name, name),
    schema: isPlainObject(schema) ? schema : {},
    description: typeof schema?.description === 'string' ? schema.description : undefined,
    extensions: pickExtensions(schema),
  }));
}
