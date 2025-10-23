/**
 * @typedef {'auto'|'menu'|'search'} EndpointUISetting
 */

/**
 * Normalize an endpoint UI option to the supported string union.
 *
 * @param {string | null | undefined} value
 * @returns {EndpointUISetting}
 */
export function normalizeEndpointUI(value) {
  if (typeof value !== 'string') return 'auto';
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'menu' || trimmed === 'search' || trimmed === 'auto') {
    return /** @type {EndpointUISetting} */ (trimmed);
  }
  return 'auto';
}

/**
 * Resolve the effective UI mode by considering the configured value and known operation count.
 *
 * @param {EndpointUISetting} configured
 * @param {number} operationsCount
 * @returns {'menu'|'search'}
 */
export function resolveEndpointUIMode(configured, operationsCount) {
  const safeCount = Number.isFinite(operationsCount) ? operationsCount : 0;
  if (configured === 'menu') return 'menu';
  if (configured === 'search') return 'search';
  return safeCount <= 20 ? 'menu' : 'search';
}

export const ENDPOINT_UI_MENU = 'menu';
export const ENDPOINT_UI_SEARCH = 'search';
