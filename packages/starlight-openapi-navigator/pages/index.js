import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BASE_SLUG } from '../runtime/config.js';

/**
 * @typedef {import('astro').AstroIntegrationLogger} AstroIntegrationLogger
 * @typedef {import('../parser/index.js').NormalizedOpenApiSpec} NormalizedOpenApiSpec
 */

/**
 * Context object made available to page generation helpers.
 *
 * @typedef PageGenerationContext
 * @property {AstroIntegrationLogger} logger
 * @property {string} outputDir Directory where the base slug lives (e.g. `src/pages/api`).
 * @property {string} baseSlug
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMPONENTS_DIR = path.join(PACKAGE_ROOT, 'components');

const OVERVIEW_COMPONENT = 'OpenApiOverview.astro';
const OPERATION_COMPONENT = 'OpenApiOperationPage.astro';
const SCHEMAS_COMPONENT = 'OpenApiSchemaExplorer.astro';

const OVERVIEW_FILENAME = 'index.astro';
const PAGE_FILENAME = 'index.astro';
const SCHEMAS_DIRNAME = 'schemas';

/**
 * Emit the overview page for the hybrid API docs layout.
 *
 * @param {NormalizedOpenApiSpec} spec
 * @param {PageGenerationContext} ctx
 */
export async function generateOverviewPage(spec, ctx) {
  const { outputDir, baseSlug } = ctx;
  await fs.mkdir(outputDir, { recursive: true });

  const filePath = path.join(outputDir, OVERVIEW_FILENAME);
  const resolvedSlug = baseSlug || DEFAULT_BASE_SLUG;

  const title = spec.info?.title ? `${spec.info.title} Overview` : 'API Overview';
  const description = spec.info?.description
    ? truncate(stripMarkdown(spec.info.description), 280)
    : 'Browse API endpoints, request details, and sample integrations.';

  const frontmatter = {
    title,
    description,
    slug: resolvedSlug,
    sidebar: {
      label: 'API Overview',
      order: 0,
    },
  };

  const headings = buildOverviewHeadings(spec);

  const source = buildStarlightPageSource({
    componentName: 'OpenApiOverview',
    componentFilename: OVERVIEW_COMPONENT,
    filePath,
    frontmatter,
    headings,
  });

  await fs.writeFile(filePath, source, 'utf8');
}

/**
 * Emit per-tag deep dive pages for the hybrid API docs layout.
 *
 * @param {NormalizedOpenApiSpec} spec
 * @param {PageGenerationContext} ctx
 */
export async function generateOperationPages(spec, ctx) {
  const { outputDir, baseSlug, logger } = ctx;
  const resolvedSlug = baseSlug || DEFAULT_BASE_SLUG;
  await fs.mkdir(outputDir, { recursive: true });

  const writes = [];

  spec.tags.forEach((tag, tagIndex) => {
    if (tag.slug === 'index' || tag.slug === SCHEMAS_DIRNAME) {
      const message = `starlight-openapi-navigator: tag slug "${tag.slug}" collides with a generated route. Rename the tag or configure a different baseSlug.`;
      if (logger && typeof logger.error === 'function') {
        logger.error(message);
      }
      throw new Error(message);
    }

    const operations = Array.isArray(tag.operations) ? tag.operations : [];
    operations.forEach((operation, operationIndex) => {
      if (!operation?.slug) return;
      if (operation.slug === 'index' || operation.slug === SCHEMAS_DIRNAME) {
        const message = `starlight-openapi-navigator: operation slug "${operation.slug}" under tag "${tag.slug}" collides with a generated route. Provide a custom operationId or adjust the baseSlug.`;
        if (logger && typeof logger.error === 'function') {
          logger.error(message);
        }
        throw new Error(message);
      }

      const operationDir = path.join(outputDir, tag.slug, operation.slug);
      const filePath = path.join(operationDir, PAGE_FILENAME);
      const method = typeof operation.method === 'string' ? operation.method.toUpperCase() : '';
      const titleBase = `${method} ${operation.path}`.trim();
      const title = titleBase ? `${titleBase} API` : 'API Operation';
      const description = operation.summary
        ? truncate(stripMarkdown(operation.summary), 220)
        : truncate(stripMarkdown(operation.description || ''), 220) ||
          `Reference for the ${method} ${operation.path} endpoint.`;

      const frontmatter = {
        title,
        description,
        slug: `${resolvedSlug}/${tag.slug}/${operation.slug}`,
        sidebar: {
          hidden: true,
          order: tagIndex * 100 + operationIndex,
        },
      };

      const headings = buildOperationHeadings(operation);
      const tagSlugLiteral = JSON.stringify(tag.slug);
      const operationSlugLiteral = JSON.stringify(operation.slug);

      writes.push(
        fs
          .mkdir(operationDir, { recursive: true })
          .then(() => {
            const source = buildStarlightPageSource({
              componentName: 'OpenApiOperationPage',
              componentFilename: OPERATION_COMPONENT,
              filePath,
              frontmatter,
              headings,
              componentProps: [
                `tagSlug={${tagSlugLiteral}}`,
                `operationSlug={${operationSlugLiteral}}`,
              ],
            });

            return fs.writeFile(filePath, source, 'utf8');
          })
      );
    });
  });

  await Promise.all(writes);
}

export async function generateSchemaExplorerPage(spec, ctx) {
  if (!Array.isArray(spec.schemas) || spec.schemas.length === 0) return;
  const { outputDir, baseSlug } = ctx;
  const resolvedSlug = baseSlug || DEFAULT_BASE_SLUG;

  const schemaDir = path.join(outputDir, SCHEMAS_DIRNAME);
  await fs.mkdir(schemaDir, { recursive: true });
  const filePath = path.join(schemaDir, PAGE_FILENAME);

  const frontmatter = {
    title: 'API Schemas',
    description: 'Browse component schemas from the OpenAPI document.',
    slug: `${resolvedSlug}/schemas`,
    sidebar: {
      label: 'Schemas',
      order: spec.tags.length + 1,
    },
  };

  const headings = (spec.schemas || []).map((schema) => ({
    depth: 2,
    slug: schema.slug,
    text: schema.name,
  }));

  const source = buildStarlightPageSource({
    componentName: 'OpenApiSchemaExplorer',
    componentFilename: SCHEMAS_COMPONENT,
    filePath,
    frontmatter,
    headings,
  });

  await fs.writeFile(filePath, source, 'utf8');
}

function buildStarlightPageSource({
  componentName,
  componentFilename,
  filePath,
  frontmatter,
  headings,
  componentProps = [],
  extraScriptLines = [],
  pageAttributes = [],
}) {
  const pageDir = path.dirname(filePath);
  const componentImportPath = toPosixPath(
    addLeadingDot(
      path.relative(
        pageDir,
        path.join(COMPONENTS_DIR, componentFilename)
      )
    )
  );

  const imports = [
    "import StarlightPage from '@astrojs/starlight/components/StarlightPage.astro';",
    `import ${componentName} from '${componentImportPath}';`,
  ];

  const scriptLines = [
    ...imports,
    '',
    `const frontmatter = ${serialize(frontmatter)};`,
    `const headings = ${serialize(headings)};`,
    ...extraScriptLines,
  ].filter(Boolean);

  const starlightAttributes = [
    'frontmatter={frontmatter}',
    'headings={headings}',
    ...pageAttributes,
  ].join(' ');

  const componentAttributes = componentProps.length
    ? ' ' + componentProps.join(' ')
    : '';

  const body = `
<StarlightPage ${starlightAttributes}>
  <${componentName}${componentAttributes} />
</StarlightPage>
`.trimStart();

  return ['---', ...scriptLines, '---', '', body, ''].join('\n');
}

function buildOverviewHeadings(spec) {
  const headings = [];
  if (Array.isArray(spec.servers) && spec.servers.length > 0) {
    headings.push({ depth: 2, slug: 'servers', text: 'Servers' });
  }
  const hasSecurity = Boolean(
    (spec.document?.security && spec.document.security.length) ||
      (spec.document?.components?.securitySchemes &&
        Object.keys(spec.document.components.securitySchemes).length)
  );
  if (hasSecurity) {
    headings.push({ depth: 2, slug: 'auth', text: 'Authentication' });
  }
  if (Array.isArray(spec.tags) && spec.tags.length > 0) {
    headings.push({ depth: 2, slug: 'browse', text: 'Browse by tag' });
  }
  if (Array.isArray(spec.schemas) && spec.schemas.length > 0) {
    headings.push({ depth: 2, slug: 'schemas', text: 'Component schemas' });
  }
  return headings;
}

function buildOperationHeadings(operation) {
  if (!operation?.slug) return [];
  const method = typeof operation.method === 'string' ? operation.method.toUpperCase() : '';
  const text = `${method} ${operation.path || ''}`.trim() || 'API Operation';
  /** @type {Array<{ depth: number, slug: string, text: string }>} */
  const headings = [
    {
      depth: 2,
      slug: operation.slug,
      text,
    },
  ];

  const addHeading = (condition, slugSuffix, label) => {
    if (!condition) return;
    headings.push({
      depth: 3,
      slug: `${operation.slug}-${slugSuffix}`,
      text: label,
    });
  };

  addHeading(Array.isArray(operation.parameters) && operation.parameters.length, 'parameters', 'Parameters');
  addHeading(Boolean(operation.requestBody), 'request-body', 'Request body');
  addHeading(operation.responses && Object.keys(operation.responses).length > 0, 'responses', 'Sample responses');
  addHeading(Array.isArray(operation.codeSampleGroups) && operation.codeSampleGroups.length > 0, 'code-samples', 'Code samples');
  addHeading(true, 'try-it', 'Try it live');

  return headings;
}

function serialize(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003C');
}

function addLeadingDot(relativePath) {
  if (relativePath.startsWith('.')) return relativePath;
  return `./${relativePath}`;
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function stripMarkdown(value) {
  if (!value) return '';
  return String(value)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1).trimEnd()}…`;
}
