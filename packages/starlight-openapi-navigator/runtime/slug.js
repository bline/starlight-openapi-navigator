export function toSlug(value, fallback = 'item') {
  const base = typeof value === 'string' && value.trim().length ? value.trim() : fallback;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}
