/**
 * Escape HTML-reserved characters in a string.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

const ESCAPED_CHAR_PATTERN = /\\([\\[\]()])/g;
const ALLOWED_PROTOCOLS = new Set(['http', 'https', 'mailto']);

function unescapeMarkdownText(value) {
  return value.replace(ESCAPED_CHAR_PATTERN, '$1');
}

function sanitizeLinkHref(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const scheme = trimmed.split(':', 1)[0].toLowerCase();
    if (!ALLOWED_PROTOCOLS.has(scheme)) {
      return null;
    }
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    return null;
  }
  return trimmed;
}

function findClosingBracket(input, startIndex) {
  let escapeNext = false;
  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === ']') {
      return index;
    }
  }
  return -1;
}

function findClosingParen(input, startIndex) {
  let escapeNext = false;
  let depth = 0;
  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Convert `[label](url)` markdown fragments within a string into sanitized anchor tags.
 * Existing HTML is stripped before link detection to avoid script injection.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function renderMarkdownLinks(value) {
  const text = stripHtml(value);
  if (!text) return '';

  let cursor = 0;
  let html = '';

  while (cursor < text.length) {
    const openBracket = text.indexOf('[', cursor);
    if (openBracket === -1) {
      html += escapeHtml(text.slice(cursor));
      break;
    }

    html += escapeHtml(text.slice(cursor, openBracket));

    const labelStart = openBracket + 1;
    const labelEnd = findClosingBracket(text, labelStart);
    if (labelEnd === -1) {
      html += escapeHtml(text.slice(openBracket));
      break;
    }

    const parenStart = labelEnd + 1;
    if (text[parenStart] !== '(') {
      html += escapeHtml(text.slice(openBracket, parenStart));
      cursor = parenStart;
      continue;
    }

    const hrefStart = parenStart + 1;
    const hrefEnd = findClosingParen(text, hrefStart);
    if (hrefEnd === -1) {
      html += escapeHtml(text.slice(openBracket));
      break;
    }

    const rawLabel = text.slice(labelStart, labelEnd);
    const rawHref = text.slice(hrefStart, hrefEnd);
    const cleanedHref = sanitizeLinkHref(unescapeMarkdownText(rawHref));

    if (!cleanedHref) {
      html += escapeHtml(text.slice(openBracket, hrefEnd + 1));
      cursor = hrefEnd + 1;
      continue;
    }

    const labelText = unescapeMarkdownText(rawLabel).trim() || cleanedHref;
    html += `<a href="${escapeHtml(cleanedHref)}" target="_blank" rel="noopener noreferrer">`;
    html += escapeHtml(labelText);
    html += '</a>';

    cursor = hrefEnd + 1;
  }

  return html;
}
