import spec, { loadOperation, getOperationPreferredTag } from 'virtual:starlight-openapi-navigator/spec-data';

const API_KEY_STORAGE_KEY = 'starlight-openapi-navigator-api-key';

export async function mountTryIt({ rootId, tagSlug, operationSlug, preferredTag } = {}) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = `<p class="tryit-loading">Loading operation details…</p>`;

  try {
    if (!operationSlug || !tagSlug) {
      const params = new URLSearchParams(window.location.search);
      operationSlug = operationSlug || params.get('operation') || '';
      tagSlug = tagSlug || params.get('tag') || '';
      if (!preferredTag) {
        preferredTag = getOperationPreferredTag(operationSlug) || '';
      }
    }

    const operation = await resolveOperation(operationSlug, tagSlug, preferredTag);
    if (!operation) {
      root.innerHTML = `<p class="tryit-error">Unable to load this operation.</p>`;
      return;
    }

    const context = {
      operation,
      servers: buildServerOptions(operation),
      parameters: buildParameterGroups(operation),
      bodyOptions: buildBodyOptions(operation),
      securitySchemes: buildSecuritySchemes(operation),
    };

    renderTryIt(root, context);
    attachInteractions(root, context);
  } catch (error) {
    console.error('starlight-openapi-navigator: failed to bootstrap Try It', error);
    root.innerHTML = `<p class="tryit-error">Something went wrong loading the playground. Check the console for details.</p>`;
  }
}

async function resolveOperation(operationSlug, tagSlug, preferredTag) {
  if (!operationSlug) return null;
  let operation = await loadOperation(operationSlug, tagSlug);
  if (operation) return operation;
  if (preferredTag && preferredTag !== tagSlug) {
    operation = await loadOperation(operationSlug, preferredTag);
    if (operation) return operation;
  }
  const fallbackTag = getOperationPreferredTag(operationSlug);
  if (fallbackTag && fallbackTag !== tagSlug && fallbackTag !== preferredTag) {
    operation = await loadOperation(operationSlug, fallbackTag);
    if (operation) return operation;
  }
  return null;
}

function buildServerOptions(operation) {
  const opServers = Array.isArray(operation?.servers) ? operation.servers : [];
  const specServers = Array.isArray(spec?.servers) ? spec.servers : [];
  const combined = [...opServers, ...specServers];
  const seen = new Set();
  return combined
    .filter((server) => server && typeof server.url === 'string' && server.url.trim().length)
    .filter((server) => {
      const normalized = normalizeServerUrl(server.url);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map((server, index) => ({
      value: server.url,
      label: server.description ? `${server.url} — ${server.description}` : server.url,
      selected: index === 0,
    }));
}

function buildParameterGroups(operation) {
  const parameters = Array.isArray(operation?.parameters) ? operation.parameters : [];
  return {
    path: parameters.filter((param) => param?.in === 'path'),
    query: parameters.filter((param) => param?.in === 'query'),
    header: parameters.filter((param) => param?.in === 'header'),
  };
}

function buildBodyOptions(operation) {
  const content = operation?.requestBody?.content;
  if (!content || typeof content !== 'object') return [];
  const entries = Object.entries(content).filter(([type]) => typeof type === 'string' && type.length);
  const examplesByType = new Map();
  (operation.requestBodyExamples || []).forEach((group) => {
    const example = group?.examples?.find((entry) => entry?.value !== undefined)?.value;
    if (example !== undefined) examplesByType.set(group.contentType, stringifyExample(example));
  });
  return entries.map(([contentType, media], index) => ({
    contentType,
    required: Boolean(operation?.requestBody?.required),
    example: examplesByType.get(contentType) || stringifyExample(media?.example),
    selected: index === 0,
  }));
}

function buildSecuritySchemes(operation) {
  const requirementSets = Array.isArray(operation?.security) && operation.security.length
    ? operation.security
    : Array.isArray(spec?.document?.security) && spec.document.security.length
      ? spec.document.security
      : [];
  const schemes = spec?.document?.components?.securitySchemes || {};
  const entries = [];
  const seen = new Set();
  requirementSets.forEach((set) => {
    if (!set || typeof set !== 'object') return;
    Object.keys(set).forEach((key) => {
      if (!key || seen.has(key)) return;
      const scheme = schemes[key];
      if (!scheme) return;
      entries.push({
        key,
        type: scheme.type,
        name: scheme.name,
        in: scheme.in,
        scheme: scheme.scheme,
        description: scheme.description,
      });
      seen.add(key);
    });
  });
  return entries;
}

function renderTryIt(root, context) {
  const { operation, servers, parameters, bodyOptions, securitySchemes } = context;
  const method = (operation.method || '').toUpperCase();
  const path = operation.path || '';
  const serverSelect = servers
    .map((server) => `<option value="${escapeHtml(server.value)}"${server.selected ? ' selected' : ''}>${escapeHtml(server.label)}</option>`) 
    .join('');

  const renderParams = (collection, type) => {
    if (!collection.length) {
      return `<p class="tryit-hint">No ${type} parameters.</p>`;
    }
    return collection
      .map((param) => {
        const inputId = `${operation.slug}-${type}-${param.name}`;
        const example = stringifyExample(param.example ?? param.schema?.example ?? param.schema?.default);
        return `
          <div class="tryit-field">
            <label class="tryit-label" for="${escapeHtml(inputId)}">
              ${escapeHtml(param.name || '')}${param.required ? '<span class="tryit-required">*</span>' : ''}
            </label>
            <input
              id="${escapeHtml(inputId)}"
              class="tryit-input"
              type="text"
              name="${escapeHtml(param.name || '')}"
              data-param-location="${type}"
              placeholder="${escapeHtml(example)}"
              ${param.required ? 'required' : ''}
            />
            ${param.description ? `<p class="tryit-hint">${escapeHtml(param.description)}</p>` : ''}
          </div>
        `;
      })
      .join('');
  };

  const bodySection = () => {
    if (!bodyOptions.length) {
      return '<p class="tryit-hint">This operation does not accept a request body.</p>';
    }
    const selector = bodyOptions.length > 1
      ? `<div class="tryit-field">
          <label class="tryit-label" for="${operation.slug}-body-content-type">Content type</label>
          <select id="${operation.slug}-body-content-type" class="tryit-input" data-body-select>
            ${bodyOptions.map((option) => `<option value="${escapeHtml(option.contentType)}"${option.selected ? ' selected' : ''}>${escapeHtml(option.contentType)}</option>`).join('')}
          </select>
        </div>`
      : '';

    const editors = bodyOptions
      .map((option, index) => {
        const textareaId = `${operation.slug}-body-${index}`;
        return `
          <div class="tryit-body-option" data-body-option="${escapeHtml(option.contentType)}"${option.selected ? '' : ' hidden'}>
            <label class="tryit-label" for="${escapeHtml(textareaId)}">${escapeHtml(option.contentType)} payload${option.required ? ' (required)' : ''}</label>
            <textarea
              id="${escapeHtml(textareaId)}"
              class="tryit-input tryit-input--textarea"
              data-body-input
              placeholder="${escapeHtml(option.example || '')}"
            ></textarea>
          </div>
        `;
      })
      .join('');

    return `${selector}${editors}`;
  };

  const securityInfo = securitySchemes.length
    ? `<div class="tryit-security">
         <p class="tryit-hint">This request may require the following schemes:</p>
         <ul>
           ${securitySchemes.map((scheme) => `<li>${escapeHtml((scheme.name || scheme.key) ?? '')} (${escapeHtml(scheme.type || '')})</li>`).join('')}
         </ul>
       </div>`
    : '';

  root.innerHTML = `
    <div class="tryit" data-tryit-root>
      <header class="tryit-header">
        <span class="tryit-method">${escapeHtml(method)}</span>
        <code class="tryit-path">${escapeHtml(path)}</code>
      </header>
      <p class="tryit-lead">
        Save your API key once and reuse it across endpoints. Configure the request and send it without leaving the docs.
      </p>
      <div class="tryit-field tryit-field--compact">
        <label class="tryit-label" for="tryit-api-key">API key</label>
        <div class="tryit-input-group">
          <input id="tryit-api-key" class="tryit-input" type="password" placeholder="sk_live_..." autocomplete="off" spellcheck="false" data-api-key-input />
          <button type="button" class="tryit-button tryit-button--secondary" data-api-key-clear>Clear</button>
        </div>
        <p class="tryit-hint">Stored locally in your browser. Removing it clears access for this device.</p>
      </div>
      <form class="tryit-form" data-tryit-form>
        <div class="tryit-field">
          <label class="tryit-label" for="tryit-server">Server</label>
          <select id="tryit-server" class="tryit-input" data-server-select>
            ${serverSelect}
          </select>
        </div>

        <fieldset class="tryit-fieldset">
          <legend>Path parameters</legend>
          ${renderParams(parameters.path, 'path')}
        </fieldset>
        <fieldset class="tryit-fieldset">
          <legend>Query parameters</legend>
          ${renderParams(parameters.query, 'query')}
        </fieldset>
        <fieldset class="tryit-fieldset">
          <legend>Header parameters</legend>
          ${renderParams(parameters.header, 'header')}
        </fieldset>
        <fieldset class="tryit-fieldset">
          <legend>Request body</legend>
          ${bodySection()}
        </fieldset>
        ${securityInfo}
        <div class="tryit-actions">
          <button type="submit" class="tryit-button tryit-button--primary" data-submit>Send request</button>
          <button type="button" class="tryit-button" data-reset>Reset form</button>
        </div>
      </form>
      <section class="tryit-response" data-response>
        <p class="tryit-response-placeholder">Run a request to see the response here.</p>
        <div class="tryit-response-meta">
          <span data-response-status>—</span>
          <span data-response-time></span>
        </div>
        <details class="tryit-response-headers" data-response-headers hidden>
          <summary>Response headers</summary>
          <pre data-response-headers-body></pre>
        </details>
        <pre class="tryit-response-body" data-response-body></pre>
        <div class="tryit-response-error" data-response-error hidden></div>
      </section>
    </div>
  `;
}

function attachInteractions(root, context) {
  const apiKeyInput = root.querySelector('[data-api-key-input]');
  const apiKeyClear = root.querySelector('[data-api-key-clear]');
  const form = root.querySelector('[data-tryit-form]');
  const serverSelect = root.querySelector('[data-server-select]');
  const bodySelect = root.querySelector('[data-body-select]');
  const responseSection = root.querySelector('[data-response]');
  const responseStatus = root.querySelector('[data-response-status]');
  const responseTime = root.querySelector('[data-response-time]');
  const responseBody = root.querySelector('[data-response-body]');
  const responseHeaders = root.querySelector('[data-response-headers]');
  const responseHeadersBody = root.querySelector('[data-response-headers-body]');
  const responseError = root.querySelector('[data-response-error]');
  const responsePlaceholder = root.querySelector('.tryit-response-placeholder');
  const resetButton = root.querySelector('[data-reset]');

  hydrateApiKey(apiKeyInput);

  if (apiKeyInput instanceof HTMLInputElement) {
    apiKeyInput.addEventListener('input', () => storeApiKey(apiKeyInput.value));
  }
  if (apiKeyClear instanceof HTMLButtonElement) {
    apiKeyClear.addEventListener('click', () => {
      storeApiKey('');
      if (apiKeyInput instanceof HTMLInputElement) apiKeyInput.value = '';
    });
  }

  if (bodySelect instanceof HTMLSelectElement) {
    bodySelect.addEventListener('change', (event) => {
      const value = event.target.value;
      root.querySelectorAll('[data-body-option]').forEach((container) => {
        if (!(container instanceof HTMLElement)) return;
        container.hidden = container.getAttribute('data-body-option') !== value;
      });
    });
  }

  if (resetButton instanceof HTMLButtonElement) {
    resetButton.addEventListener('click', () => {
      form?.reset();
      if (responsePlaceholder) responsePlaceholder.hidden = false;
      if (responseStatus) responseStatus.textContent = '—';
      if (responseTime) responseTime.textContent = '';
      if (responseBody) responseBody.textContent = '';
      if (responseHeaders) responseHeaders.hidden = true;
      if (responseError) responseError.hidden = true;
    });
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;

    const submitButton = form.querySelector('[data-submit]');
    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = 'Sending…';
    }

    if (responsePlaceholder) responsePlaceholder.hidden = true;
    if (responseStatus) responseStatus.textContent = 'Sending…';
    if (responseTime) responseTime.textContent = '';
    if (responseBody) responseBody.textContent = '';
    if (responseHeaders) responseHeaders.hidden = true;
    if (responseError) {
      responseError.textContent = '';
      responseError.hidden = true;
    }

    try {
      const request = buildRequest({
        form,
        serverSelect,
        context,
        apiKey: apiKeyInput instanceof HTMLInputElement ? apiKeyInput.value.trim() : '',
      });
      const started = performance.now();
      const res = await fetch(request.url, request.init);
      const elapsed = performance.now() - started;
      const text = await res.text();

      if (responseStatus) {
        responseStatus.textContent = `${res.status} ${res.statusText || ''}`.trim();
        responseStatus.dataset.state = res.ok ? 'success' : 'error';
      }
      if (responseTime) responseTime.textContent = `${Math.round(elapsed)} ms`;
      if (responseBody) responseBody.textContent = prettifyBody(text, res.headers.get('content-type'));
      if (responseHeaders && responseHeadersBody) {
        const headerLines = [];
        res.headers.forEach((value, key) => {
          headerLines.push(`${key}: ${value}`);
        });
        if (headerLines.length) {
          responseHeadersBody.textContent = headerLines.join('\n');
          responseHeaders.hidden = false;
        } else {
          responseHeaders.hidden = true;
        }
      }
    } catch (error) {
      console.error('Try It request failed', error);
      if (responseStatus) responseStatus.textContent = 'Request failed';
      if (responseError) {
        responseError.textContent = describeError(error);
        responseError.hidden = false;
      }
    } finally {
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = 'Send request';
      }
    }
  });
}

function buildRequest({ form, serverSelect, context, apiKey }) {
  const url = new URL((serverSelect instanceof HTMLSelectElement && serverSelect.value) || '', window.location.origin);
  const searchParams = url.searchParams;
  const bodyTextarea = getActiveBodyTextarea(form);
  const pathInputs = form.querySelectorAll('[data-param-location="path"]');
  const queryInputs = form.querySelectorAll('[data-param-location="query"]');
  const headerInputs = form.querySelectorAll('[data-param-location="header"]');

  let path = context.operation.path || '';
  pathInputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const name = input.name;
    if (!name) return;
    const value = input.value || '';
    path = path.replace(new RegExp(`{${name}}`, 'g'), encodeURIComponent(value));
  });
  url.pathname = path.startsWith('/') ? path : `/${path}`;

  queryInputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.name) return;
    if (input.value) searchParams.set(input.name, input.value);
  });

  const headers = new Headers();
  headerInputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.name || !input.value) return;
    headers.set(input.name, input.value);
  });

  if (apiKey) {
    headers.set('Authorization', apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`);
  }

  let body;
  if (bodyTextarea instanceof HTMLTextAreaElement) {
    const raw = bodyTextarea.value.trim();
    const contentType = form.querySelector('[data-body-select]')?.value || bodyTextarea.closest('[data-body-option]')?.getAttribute('data-body-option');
    if (raw) {
      body = raw;
      if (contentType) headers.set('Content-Type', contentType);
    }
  }

  const method = (context.operation.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    body = undefined;
  }

  return {
    url: url.toString(),
    init: {
      method,
      headers,
      body,
    },
  };
}

function getActiveBodyTextarea(form) {
  const active = form.querySelector('[data-body-option]:not([hidden]) textarea');
  return active instanceof HTMLTextAreaElement ? active : null;
}

function prettifyBody(text, contentType) {
  if (!text) return '';
  if (contentType && contentType.toLowerCase().includes('json')) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function hydrateApiKey(input) {
  if (!(input instanceof HTMLInputElement)) return;
  input.value = readApiKey();
}

function readApiKey() {
  try {
    return window.localStorage?.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function storeApiKey(value) {
  try {
    const trimmed = (value || '').trim();
    if (trimmed) {
      window.localStorage?.setItem(API_KEY_STORAGE_KEY, trimmed);
    } else {
      window.localStorage?.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function stringifyExample(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeServerUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+/g, '/');
    return `${parsed.origin}${path === '/' ? '' : path}`;
  } catch {
    return trimmed;
  }
}

function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
