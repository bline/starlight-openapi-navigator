export const DEFAULT_BASE_SLUG = 'api';

const RAW_BASE_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.BASE_URL === 'string' &&
    import.meta.env.BASE_URL) ||
  '/';

const NORMALIZED_BASE_URL = RAW_BASE_URL.endsWith('/')
  ? RAW_BASE_URL
  : `${RAW_BASE_URL}/`;

function normalizeSegment(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function normalizeSegments(input) {
  const segments = Array.isArray(input) ? input : [input];
  return segments
    .map((segment) => normalizeSegment(segment))
    .filter(Boolean)
    .join('/');
}

export function getBasePath() {
  return NORMALIZED_BASE_URL;
}

export function withBase(path) {
  const joined = normalizeSegments(path);
  if (!joined) return NORMALIZED_BASE_URL;
  return `${NORMALIZED_BASE_URL}${joined}`;
}

export function withBaseTrailingSlash(path) {
  const resolved = withBase(path);
  return resolved.endsWith('/') ? resolved : `${resolved}/`;
}

export function buildSpecHref(baseSlug, ...segments) {
  const normalizedBaseSlug = normalizeSegment(baseSlug) || DEFAULT_BASE_SLUG;
  return withBase([normalizedBaseSlug, ...segments]);
}

export function buildSpecPath(baseSlug, ...segments) {
  const normalizedBaseSlug = normalizeSegment(baseSlug) || DEFAULT_BASE_SLUG;
  return withBaseTrailingSlash([normalizedBaseSlug, ...segments]);
}
