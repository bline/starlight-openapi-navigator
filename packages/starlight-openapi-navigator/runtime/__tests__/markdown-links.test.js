import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdownLinks } from '../text.js';

test('returns empty string for undefined input', () => {
  assert.equal(renderMarkdownLinks(undefined), '');
});

test('preserves plain text when no links are present', () => {
  assert.equal(renderMarkdownLinks('Plain description text.'), 'Plain description text.');
});

test('converts markdown links to anchor tags with safety attributes', () => {
  const result = renderMarkdownLinks('See [Example](https://example.com) for details.');
  assert.equal(
    result,
    'See <a href="https://example.com" target="_blank" rel="noopener noreferrer">Example</a> for details.'
  );
});

test('removes raw HTML before processing links', () => {
  const result = renderMarkdownLinks('<em>Bold</em> [docs](https://example.com/docs)');
  assert.equal(
    result,
    'Bold <a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">docs</a>'
  );
});

test('rejects javascript URLs and leaves markdown untouched', () => {
  const result = renderMarkdownLinks('Danger [link](javascript:alert(1))');
  assert.equal(result, 'Danger [link](javascript:alert(1))');
});

test('supports relative and mailto links', () => {
  const result = renderMarkdownLinks('See [guide](/docs) or [email](mailto:support@example.com)');
  assert.equal(
    result,
    'See <a href="/docs" target="_blank" rel="noopener noreferrer">guide</a> or <a href="mailto:support@example.com" target="_blank" rel="noopener noreferrer">email</a>'
  );
});

test('handles parentheses inside link destinations', () => {
  const result = renderMarkdownLinks('Open [docs](https://example.com/foo_(bar)) now');
  assert.equal(
    result,
    'Open <a href="https://example.com/foo_(bar)" target="_blank" rel="noopener noreferrer">docs</a> now'
  );
});

test('processes multiple links in a single string', () => {
  const result = renderMarkdownLinks('[One](https://one.test) and [Two](https://two.test)');
  assert.equal(
    result,
    '<a href="https://one.test" target="_blank" rel="noopener noreferrer">One</a> and <a href="https://two.test" target="_blank" rel="noopener noreferrer">Two</a>'
  );
});
