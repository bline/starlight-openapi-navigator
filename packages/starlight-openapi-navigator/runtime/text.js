/**
 * Remove basic HTML tags and collapse whitespace for display-only strings.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stripHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
