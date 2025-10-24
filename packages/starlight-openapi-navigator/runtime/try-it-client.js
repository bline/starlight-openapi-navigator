import { loadOperation, loadSchemaDefinitions, getOperationPreferredTag } from 'virtual:starlight-openapi-navigator/spec-data';
import generatedConfig from 'virtual:starlight-openapi-navigator/config';

function createRootMessage(root, text) {
  root.innerHTML = '<p>' + text + '</p>';
}

export async function mountTryIt({ rootId, tagSlug, operationSlug, preferredTag, baseSlug }) {
  const root = document.getElementById(rootId);
  if (!root) return;

  createRootMessage(root, 'Loading operation details…');

  try {
    const operation = await resolveOperation(operationSlug, tagSlug, preferredTag);
    if (!operation) {
      createRootMessage(root, 'Unable to load this operation.');
      return;
    }
    const schemas = await loadSchemaDefinitions();
    renderTryIt(root, operation, schemas, baseSlug || generatedConfig?.baseSlug || 'api');
  } catch (error) {
    console.error('try-it bootstrap failed', error);
    createRootMessage(root, 'Something went wrong loading the Try It panel. Check the console for details.');
  }
}

async function resolveOperation(operationSlug, tagSlug, preferredTag) {
  if (!operationSlug) return null;
  const direct = await loadOperation(operationSlug, tagSlug);
  if (direct) return direct;
  if (preferredTag && preferredTag !== tagSlug) {
    const fallback = await loadOperation(operationSlug, preferredTag);
    if (fallback) return fallback;
  }
  const globalTag = getOperationPreferredTag(operationSlug);
  if (globalTag && globalTag !== tagSlug && globalTag !== preferredTag) {
    const finalOp = await loadOperation(operationSlug, globalTag);
    if (finalOp) return finalOp;
  }
  return null;
}

function renderTryIt(root, operation, schemas, baseSlug) {
  root.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'tryit-debug';
  const summary = {
    method: (operation.method || '').toUpperCase(),
    path: operation.path,
    hasRequestBody: Boolean(operation.requestBody),
    parameters: Array.isArray(operation.parameters) ? operation.parameters.length : 0,
    schemas: Object.keys(schemas || {}).length,
  };
  pre.textContent = JSON.stringify(summary, null, 2);
  root.append(pre);
}
