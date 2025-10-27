import { DEFAULT_BASE_SLUG, buildSpecPath } from './config.js';

/**
 * Build a flattened index of operations for client-side navigation helpers.
 *
 * @param {import('../parser/index.js').NormalizedOpenApiSpec | null | undefined} spec
 * @param {string | null | undefined} baseSlug
 * @returns {Array<{
 *   id: string;
 *   href: string;
 *   tagSlug: string;
 *   tagName: string;
 *   method: string;
 *   path: string;
 *   summary: string;
 *   deprecated: boolean;
 * }>}
 */
export function buildOperationIndex(source, baseSlug) {
  if (!source) return [];
  const resolvedSlug =
    typeof baseSlug === 'string' && baseSlug.length ? baseSlug : DEFAULT_BASE_SLUG;
  /** @type {ReturnType<typeof buildOperationIndex>} */
  let entries = [];

  if (Array.isArray(source)) {
    entries = source
      .filter(
        (operation) =>
          operation &&
          typeof operation.slug === 'string' &&
          typeof operation.tagSlug === 'string' &&
          operation.tagSlug.length &&
          operation.slug.length &&
          operation.path &&
          operation.method
      )
      .map((operation) => {
        const method = String(operation.method || '').toUpperCase();
        const path = String(operation.path || '');
        const summary = typeof operation.summary === 'string' ? operation.summary : '';
        const tagName =
          typeof operation.tagName === 'string' && operation.tagName.length
            ? operation.tagName
            : operation.tagSlug;
        const href = buildSpecPath(resolvedSlug, operation.tagSlug, operation.slug);
        return {
          id: `${operation.tagSlug}/${operation.slug}`,
          href,
          tagSlug: operation.tagSlug,
          tagName,
          method,
          path,
          summary,
          deprecated: Boolean(operation.deprecated),
        };
      });
  } else if (typeof source === 'object') {
    const tags = Array.isArray(source.tags) ? source.tags : [];
    tags.forEach((tag) => {
      if (!tag || typeof tag.slug !== 'string') return;
      const operations = Array.isArray(tag.operations) ? tag.operations : [];
      const tagName =
        (tag.metadata && typeof tag.metadata.displayName === 'string'
          ? tag.metadata.displayName
          : tag.name) || tag.slug;

      operations.forEach((operation) => {
        if (!operation || typeof operation.slug !== 'string') return;
        if (!operation.path || !operation.method) return;

        const method = String(operation.method || '').toUpperCase();
        const path = String(operation.path || '');
        const summary = typeof operation.summary === 'string' ? operation.summary : '';
        const href = buildSpecPath(resolvedSlug, tag.slug, operation.slug);
        entries.push({
          id: `${tag.slug}/${operation.slug}`,
          href,
          tagSlug: tag.slug,
          tagName,
          method,
          path,
          summary,
          deprecated: Boolean(operation.deprecated),
        });
      });
    });
  }

  entries.sort((a, b) => {
    if (a.tagName !== b.tagName) {
      return a.tagName.localeCompare(b.tagName);
    }
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    return a.method.localeCompare(b.method);
  });

  return entries;
}
