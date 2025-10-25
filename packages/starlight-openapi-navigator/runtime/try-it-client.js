import spec, { loadOperation, getOperationPreferredTag } from 'virtual:starlight-openapi-navigator/spec-data';
import generatedConfig from 'virtual:starlight-openapi-navigator/config';
import { escapeHtml, renderMarkdownLinks } from './text.js';
import { createSchemaFormUtils } from './schema-forms.js';

const API_KEY_STORAGE_KEY = 'starlight-openapi-navigator-api-key';
const AUTO_ROOT_SELECTOR = '[data-tryit-root]';
const AUTO_ROOT_STATE_ATTR = 'data-tryit-mounted';
const DEFAULT_TRY_IT_ROOT_ID = 'tryit-root';
const DEFAULT_TRY_IT_METHOD_ID = 'try-it';

const schemaFormUtils = createSchemaFormUtils(spec);
const { buildRequestBodyFormOptions, formatExampleValue } = schemaFormUtils;

const proxyLookup = buildProxyLookup(
  Array.isArray(generatedConfig?.devProxyTable) ? generatedConfig.devProxyTable : []
);

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
  let servers = opServers.length ? opServers : specServers;

  servers = Array.isArray(servers)
    ? servers
        .filter((server) => server && typeof server.url === 'string' && server.url.trim().length)
        .map((server) => ({ ...server }))
    : [];

  if (import.meta.env.DEV && proxyLookup.size) {
    const augmented = [];
    servers.forEach((server) => {
      const normalized = normalizeServerUrl(server.url);
      const proxyEntry = proxyLookup.get(normalized);
      if (proxyEntry) {
        augmented.push({
          url: proxyEntry.contextPath,
          description: server.description
            ? `${server.description} (proxied)`
            : `Local proxy → ${proxyEntry.target}${proxyEntry.rewritePath ?? ''}`,
          originalUrl: server.url,
          isProxy: true,
        });
      }
      augmented.push(server);
    });
    servers = augmented;
  }

  const seen = new Set();
  const unique = [];
  servers.forEach((server) => {
    const normalized = normalizeServerUrl(server.url);
    if (normalized && !seen.has(normalized)) {
      unique.push(server);
      seen.add(normalized);
    }
  });

  return unique.map((server, index) => ({
    url: server.url || '',
    description: server.description || '',
    originalUrl: server.originalUrl || server.url || '',
    isProxy: Boolean(server.isProxy),
    selected: index === 0,
  }));
}

function buildParameterGroups(operation) {
  const parameters = Array.isArray(operation?.parameters) ? operation.parameters : [];
  const enhanced = parameters
    .filter((param) => param && param.name && param.in)
    .map((param) => ({
      ...param,
      exampleValue: formatExampleValue(getParameterExample(param)),
    }));
  return {
    path: enhanced.filter((param) => param.in === 'path'),
    query: enhanced.filter((param) => param.in === 'query'),
    header: enhanced.filter((param) => param.in === 'header'),
  };
}

function buildBodyOptions(operation) {
  const options = buildRequestBodyFormOptions(operation);
  return options.map((option, index) => ({
    ...option,
    selected: index === 0,
  }));
}

function buildSecuritySchemes(operation) {
  const specSecuritySchemes = spec?.document?.components?.securitySchemes || {};
  const requirementSets = Array.isArray(operation?.security) && operation.security.length
    ? operation.security
    : Array.isArray(spec?.document?.security) && spec.document.security.length
      ? spec.document.security
      : [];

  const entries = [];
  const seen = new Set();

  requirementSets.forEach((set) => {
    if (!set || typeof set !== 'object') return;
    Object.entries(set).forEach(([key, value]) => {
      if (!key || seen.has(key)) return;
      const scheme = specSecuritySchemes[key];
      if (!scheme) return;
      entries.push({
        key,
        type: scheme.type,
        name: scheme.name,
        in: scheme.in,
        scheme: scheme.scheme,
        bearerFormat: scheme.bearerFormat,
        description: scheme.description,
        scopes: Array.isArray(value) ? value : [],
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
  const slug = operation.slug || 'operation';
  const apiKeyFieldId = `tryit-api-key-${slug}`;
  const methodClass = method.toLowerCase();

  if (root instanceof HTMLElement) {
    root.style.textAlign = 'left';
    root.style.display = 'block';
  }

  const serverOptions = servers.length
    ? servers
        .map((server, index) => {
          const label = server.isProxy && server.originalUrl
            ? `${server.originalUrl} (proxy)`
            : server.url;
          const description = server.description ? ` — ${server.description}` : '';
          return `<option value="${escapeHtml(server.url)}"${index === 0 ? ' selected' : ''}>${escapeHtml(label + description)}</option>`;
        })
        .join('')
    : '<option value="">Use current origin</option>';

  const renderParams = (collection, type) => {
    if (!collection.length) {
      return `<p class="api-tryit__hint">No ${type} parameters.</p>`;
    }
  return collection
    .map((param) => {
      const inputId = `${slug}-${type}-${param.name}`;
      const example = param.exampleValue || '';
      const requiredBadge = param.required ? '<span class="api-tryit__required">*</span>' : '';
      const descriptionHtml = renderMarkdownLinks(param.description);
      return `
          <div class="api-tryit__field">
            <label class="api-tryit__label" for="${escapeHtml(inputId)}">
              ${escapeHtml(param.name || '')}${requiredBadge}
            </label>
            <input
              id="${escapeHtml(inputId)}"
              class="api-tryit__input"
              type="text"
              name="${escapeHtml(param.name || '')}"
              data-param-location="${type}"
              data-param-name="${escapeHtml(param.name || '')}"
              value="${param.required && example ? escapeHtml(example) : ''}"
              placeholder="${escapeHtml(example)}"
              ${param.required ? 'required' : ''}
            />
            ${descriptionHtml ? `<p class="api-tryit__hint">${descriptionHtml}</p>` : ''}
          </div>
        `;
    })
    .join('');
};

  const renderBodyModeToggle = (option, index) => {
    if (!option.supportsForm) return '';
    return `
      <div class="api-tryit__body-mode">
        <span class="api-tryit__body-mode-label">Edit as</span>
        <label class="api-tryit__body-mode-choice">
          <input type="radio" name="body-mode-${escapeHtml(`${slug}-${index}`)}" value="form" data-body-mode-input checked />
          Form
        </label>
        <label class="api-tryit__body-mode-choice">
          <input type="radio" name="body-mode-${escapeHtml(`${slug}-${index}`)}" value="raw" data-body-mode-input />
          Raw JSON
        </label>
      </div>
    `;
  };

  const renderSchemaWarnings = (option, mode) => {
    if (!Array.isArray(option.schemaWarnings) || !option.schemaWarnings.length) return '';
    const isFormMode = mode === 'form';
    const title = isFormMode
      ? 'Form limitations:'
      : 'Raw input required:';
    const description = isFormMode
      ? 'Switch to Raw JSON mode to edit unsupported fields.'
      : 'This body schema uses constructs that are not yet supported by the generated form.';
    const items = option.schemaWarnings
      .map((warning) => {
        if (warning.path) {
          return `<li><strong>${escapeHtml(warning.path)}:</strong> ${escapeHtml(warning.message)}</li>`;
        }
        return `<li>${escapeHtml(warning.message)}</li>`;
      })
      .join('');
    return `
      <div class="api-tryit__schema-warning" role="note">
        <strong>${escapeHtml(title)}</strong>
        <ul>${items}</ul>
        <p>${escapeHtml(description)}</p>
      </div>
    `;
  };

  const renderBodyOption = (option, index) => {
    const optionId = `${slug}-body-${index}`;
    const defaultMode = option.supportsForm ? 'form' : 'raw';
    const requiredLabel = option.required ? 'Required' : 'Optional';
    const schemaInfo = option.schemaType ? option.schemaType : 'Body';
    const schemaFormHtml = option.supportsForm
      ? `<div class="api-tryit__schema" data-schema-form>
          ${renderSchemaForm(option.formFields, optionId, option.exampleValue)}
        </div>`
      : '';
    const warningsHtml = renderSchemaWarnings(option, option.supportsForm ? 'form' : 'raw');
    const rawTextareaHint = option.supportsForm
      ? 'Generated from the form inputs above. Switch to Raw JSON mode to edit directly.'
      : 'Provide a request payload that matches the documented schema.';
    return `
      <div
        class="api-tryit__body-option"
        data-body-option
        data-content-type="${escapeHtml(option.contentType)}"
        data-body-mode="${defaultMode}"
        ${index === 0 ? '' : ' hidden'}
        ${option.supportsForm ? ' data-has-schema="true"' : ''}
        data-required="${option.required ? 'true' : 'false'}"
      >
        <div class="api-tryit__body-heading">
          <span class="api-tryit__body-tag">${escapeHtml(option.contentType)}</span>
          <span class="api-tryit__body-meta">${escapeHtml(requiredLabel)} · ${escapeHtml(schemaInfo || '')}</span>
        </div>
        ${option.supportsForm ? renderBodyModeToggle(option, index) : ''}
        ${warningsHtml}
        ${schemaFormHtml}
        <div class="api-tryit__raw" data-schema-raw${option.supportsForm ? ' hidden' : ''}>
          <label class="api-tryit__label" for="${escapeHtml(optionId)}">
            Raw JSON payload
          </label>
          <textarea
            id="${escapeHtml(optionId)}"
            class="api-tryit__input api-tryit__input--textarea"
            data-tryit-body
            rows="${option.supportsForm ? '12' : '8'}"
            data-default-example="${escapeHtml(option.example || '')}"
            placeholder="${option.schemaType === 'object' ? "{\n\n}\n" : ''}"
          >${escapeHtml(option.example || '')}</textarea>
          <p class="api-tryit__hint">${escapeHtml(rawTextareaHint)}</p>
        </div>
      </div>
    `;
  };

  const bodySection = () => {
    if (!bodyOptions.length) {
      return '<p class="api-tryit__hint">This operation does not accept a request body.</p>';
    }
    const selector = bodyOptions.length > 1
      ? `<div class="api-tryit__group">
          <label class="api-tryit__label" for="${escapeHtml(slug)}-body-content-type">
            Content type
          </label>
          <select
            id="${escapeHtml(slug)}-body-content-type"
            class="api-tryit__input"
            data-tryit-body-content-type
          >
            ${bodyOptions.map((option, index) => `<option value="${escapeHtml(option.contentType)}"${index === 0 ? ' selected' : ''}>${escapeHtml(option.contentType)}</option>`).join('')}
          </select>
        </div>`
      : `<p class="api-tryit__hint">
          Content type: <code>${escapeHtml(bodyOptions[0].contentType)}</code>
        </p>`;

    return `${selector}${bodyOptions.map((option, index) => renderBodyOption(option, index)).join('')}`;
  };

  const securityInfo = securitySchemes.length
    ? `<div class="api-tryit__schema-warning" data-tryit-security>
         <strong>Security schemes:</strong>
         <ul>
           ${securitySchemes.map((scheme) => `<li>${escapeHtml((scheme.name || scheme.key) ?? '')} (${escapeHtml(scheme.type || '')})</li>`).join('')}
         </ul>
       </div>`
    : '';

  root.innerHTML = `
    <div class="api-tryit" data-tryit-root>
      <header class="api-tryit__header">
        <h2 id="${DEFAULT_TRY_IT_METHOD_ID}" class="api-tryit__title">
          <span class="api-tryit__method api-tryit__method--${escapeHtml(methodClass)}">
            ${escapeHtml(method)}
          </span>
          <code class="api-tryit__path">${escapeHtml(path)}</code>
        </h2>
      </header>
      <p class="api-tryit__lead">
        Save your API key once and reuse it across endpoints. Configure the request below and send it directly from the docs.
      </p>
      <label class="api-tryit__label" for="${escapeHtml(apiKeyFieldId)}">API key</label>
      <div class="api-tryit__input-group">
        <input
          id="${escapeHtml(apiKeyFieldId)}"
          class="api-tryit__input"
          type="password"
          placeholder="sk_live_..."
          autocomplete="off"
          spellcheck="false"
          data-api-key-input
        />
        <button type="button" class="api-tryit__clear" data-api-key-clear>Clear</button>
      </div>
      <p class="api-tryit__hint" id="${escapeHtml(apiKeyFieldId)}-hint">
        Stored locally in your browser. Removing it clears access for this device.
      </p>

      <form
        class="api-tryit__form"
        data-tryit-form
        data-method="${escapeHtml(method)}"
        data-path="${escapeHtml(path)}"
        data-operation-slug="${escapeHtml(slug)}"
      >
        <div class="api-tryit__group">
          <label class="api-tryit__label" for="${escapeHtml(slug)}-server">Server</label>
          <select
            id="${escapeHtml(slug)}-server"
            class="api-tryit__input"
            data-tryit-server
          >
            ${serverOptions}
          </select>
        </div>

        <fieldset class="api-tryit__fieldset">
          <legend>Path parameters</legend>
          ${renderParams(parameters.path, 'path')}
        </fieldset>

        <fieldset class="api-tryit__fieldset">
          <legend>Query parameters</legend>
          ${renderParams(parameters.query, 'query')}
        </fieldset>

        <fieldset class="api-tryit__fieldset">
          <legend>Header parameters</legend>
          ${renderParams(parameters.header, 'header')}
        </fieldset>

        <fieldset class="api-tryit__fieldset">
          <legend>Request body</legend>
          ${bodySection()}
        </fieldset>

        ${securityInfo}

        <div class="api-tryit__actions">
          <button type="submit" class="api-tryit__submit" data-tryit-submit>
            Send request
          </button>
          <button type="button" class="api-tryit__reset" data-tryit-reset>
            Reset
          </button>
        </div>
      </form>

      <div class="api-tryit__response" data-tryit-response>
        <p class="api-tryit__response-placeholder" data-tryit-response-placeholder>
          Configure the request and select “Send request” to preview the response.
        </p>
        <div class="api-tryit__response-meta">
          <span data-tryit-response-status>—</span>
          <span data-tryit-response-time></span>
        </div>
        <details class="api-tryit__response-headers" data-tryit-response-headers-container hidden>
          <summary>Response headers</summary>
          <pre data-tryit-response-headers></pre>
        </details>
        <pre class="api-tryit__response-body" data-tryit-response-body></pre>
        <div class="api-tryit__response-error" data-tryit-response-error hidden></div>
      </div>
    </div>
  `;
}

function attachInteractions(root, context) {
  const apiKeyInput = root.querySelector('[data-api-key-input]');
  const apiKeyClear = root.querySelector('[data-api-key-clear]');

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

  const form = root.querySelector('[data-tryit-form]');
  if (form instanceof HTMLFormElement) {
    setupTryItForm({
      root,
      form,
      context,
      apiKeyInput: apiKeyInput instanceof HTMLInputElement ? apiKeyInput : null,
    });
  }
}

function setupTryItForm({ root, form, context, apiKeyInput }) {
  const responseContainer = root.querySelector('[data-tryit-response]');
  const responseStatus = responseContainer?.querySelector('[data-tryit-response-status]');
  const responseTime = responseContainer?.querySelector('[data-tryit-response-time]');
  const responseBody = responseContainer?.querySelector('[data-tryit-response-body]');
  const responseHeadersContainer = responseContainer?.querySelector('[data-tryit-response-headers-container]');
  const responseHeaders = responseHeadersContainer?.querySelector('[data-tryit-response-headers]');
  const responseError = responseContainer?.querySelector('[data-tryit-response-error]');
  const responsePlaceholder = responseContainer?.querySelector('[data-tryit-response-placeholder]');

  const serverSelect = form.querySelector('[data-tryit-server]');
  const contentTypeSelect = form.querySelector('[data-tryit-body-content-type]');
  const bodyOptionContainers = Array.from(form.querySelectorAll('[data-body-option]'));
  const submitButton = form.querySelector('[data-tryit-submit]');
  const resetButton = form.querySelector('[data-tryit-reset]');
  const pathInputs = Array.from(form.querySelectorAll('[data-param-location="path"]'));
  const queryInputs = Array.from(form.querySelectorAll('[data-param-location="query"]'));
  const headerInputs = Array.from(form.querySelectorAll('[data-param-location="header"]'));

  let activeBodyOption = bodyOptionContainers.find((container) => container instanceof HTMLElement && !container.hidden) || null;

  const resetResponse = () => {
    if (responsePlaceholder) responsePlaceholder.hidden = false;
    if (responseStatus) {
      responseStatus.textContent = '—';
      delete responseStatus.dataset.state;
    }
    if (responseTime) responseTime.textContent = '';
    if (responseBody) responseBody.textContent = '';
    if (responseHeadersContainer) responseHeadersContainer.hidden = true;
    if (responseError) {
      responseError.textContent = '';
      responseError.hidden = true;
    }
  };

  const setLoading = (state) => {
    if (!(submitButton instanceof HTMLButtonElement)) return;
    submitButton.disabled = state;
    submitButton.textContent = state ? 'Sending…' : 'Send request';
  };

  resetResponse();

  const showResponse = () => {
    if (responseContainer) responseContainer.hidden = false;
    if (responsePlaceholder) responsePlaceholder.hidden = true;
  };

  const showError = (message) => {
    showResponse();
    if (responseStatus) {
      responseStatus.textContent = 'Request failed';
      responseStatus.dataset.state = 'error';
    }
    if (responseTime) responseTime.textContent = '';
    if (responseBody) responseBody.textContent = '';
    if (responseHeadersContainer) responseHeadersContainer.hidden = true;
    if (responseError) {
      responseError.textContent = message;
      responseError.hidden = false;
    }
  };

  const showSuccess = (status, statusText, elapsed, bodyText, headers) => {
    showResponse();
    if (responseError) responseError.hidden = true;
    if (responseStatus) {
      responseStatus.textContent = `${status} ${statusText || ''}`.trim();
      responseStatus.dataset.state = status >= 200 && status < 300 ? 'success' : 'error';
    }
    if (responseTime) responseTime.textContent = `${Math.round(elapsed)} ms`;
    if (responseBody) {
      if (headers && typeof headers.get === 'function') {
        responseBody.textContent = prettifyBody(bodyText, headers.get('content-type'));
      } else {
        responseBody.textContent = bodyText;
      }
    }
    if (responseHeaders && responseHeadersContainer) {
      const lines = [];
      if (headers && typeof headers.forEach === 'function') {
        headers.forEach((value, key) => {
          lines.push(`${key}: ${value}`);
        });
      }
      if (lines.length) {
        responseHeaders.textContent = lines.join('\n');
        responseHeadersContainer.hidden = false;
      } else {
        responseHeadersContainer.hidden = true;
      }
    }
  };

  const updateBodyMode = (container, mode) => {
    if (!container) return;
    container.setAttribute('data-body-mode', mode);
    const schemaForm = container.querySelector('[data-schema-form]');
    const rawBlock = container.querySelector('[data-schema-raw]');
    if (schemaForm instanceof HTMLElement) {
      schemaForm.hidden = mode !== 'form';
      schemaForm.style.display = mode !== 'form' ? 'none' : '';
    } else if (schemaForm) {
      schemaForm.toggleAttribute('hidden', mode !== 'form');
    }
    if (rawBlock instanceof HTMLElement) {
      rawBlock.hidden = mode !== 'raw';
      rawBlock.style.display = mode !== 'raw' ? 'none' : '';
    } else if (rawBlock) {
      rawBlock.toggleAttribute('hidden', mode !== 'raw');
    }
    container.querySelectorAll('[data-body-mode-input]').forEach((node) => {
      if (node instanceof HTMLInputElement) {
        node.checked = node.value === mode;
      }
    });
  };

  const initialiseBodyOption = (container) => {
    if (!container) return;
    const defaultMode = container.hasAttribute('data-has-schema') ? 'form' : 'raw';
    updateBodyMode(container, defaultMode);
    container.querySelectorAll('[data-body-mode-input]').forEach((node) => {
      if (!(node instanceof HTMLInputElement)) return;
      node.addEventListener('change', () => {
        if (node.checked) {
          updateBodyMode(container, node.value);
        }
      });
    });
  };

  const setActiveBodyOption = (contentType) => {
    let selected = null;
    bodyOptionContainers.forEach((container, index) => {
      if (!(container instanceof HTMLElement)) return;
      const matches = container.getAttribute('data-content-type') === contentType || (!contentType && index === 0);
      container.hidden = !matches;
      if (matches) selected = container;
    });
    if (!selected && bodyOptionContainers.length) {
      selected = bodyOptionContainers[0];
      if (selected instanceof HTMLElement) selected.hidden = false;
    }
    if (selected instanceof HTMLElement) {
      activeBodyOption = selected;
      const mode = selected.getAttribute('data-body-mode') || (selected.hasAttribute('data-has-schema') ? 'form' : 'raw');
      updateBodyMode(selected, mode);
      form.dataset.bodyContentType = selected.getAttribute('data-content-type') || '';
    }
  };

  bodyOptionContainers.forEach((container) => initialiseBodyOption(container));
  setActiveBodyOption(contentTypeSelect instanceof HTMLSelectElement ? contentTypeSelect.value : '');

  if (contentTypeSelect instanceof HTMLSelectElement) {
    contentTypeSelect.addEventListener('change', () => {
      setActiveBodyOption(contentTypeSelect.value);
    });
  }

  const resetBodyOptions = () => {
    bodyOptionContainers.forEach((container) => {
      const defaultMode = container.hasAttribute('data-has-schema') ? 'form' : 'raw';
      updateBodyMode(container, defaultMode);
      const textarea = container.querySelector('[data-tryit-body]');
      if (textarea instanceof HTMLTextAreaElement) {
        const defaultValue = textarea.getAttribute('data-default-example') || '';
        textarea.value = defaultValue;
      }
    });
    if (contentTypeSelect instanceof HTMLSelectElement) {
      const firstValue = contentTypeSelect.options[0]?.value || '';
      contentTypeSelect.value = firstValue;
      setActiveBodyOption(firstValue);
    } else {
      setActiveBodyOption(bodyOptionContainers[0]?.getAttribute('data-content-type') || '');
    }
  };

  if (resetButton instanceof HTMLButtonElement) {
    resetButton.addEventListener('click', () => {
      form.reset();
      resetBodyOptions();
      resetResponse();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const method = (form.dataset.method || context.operation.method || 'GET').toUpperCase();
    const pathTemplate = form.dataset.path || context.operation.path || '';
    const baseUrlRaw = serverSelect instanceof HTMLSelectElement ? serverSelect.value.trim() : '';
    const originFallback = typeof window !== 'undefined' ? window.location.origin : '';

    setLoading(true);
    resetResponse();
    showResponse();
    if (responseStatus) {
      responseStatus.textContent = 'Sending…';
      responseStatus.dataset.state = '';
    }

    let finalPath = pathTemplate;
    const missingPath = [];
    pathInputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const name = input.dataset.paramName || input.name;
      if (!name) return;
      const value = input.value.trim();
      if (!value && input.hasAttribute('required')) {
        missingPath.push(name);
      }
      finalPath = finalPath.replace(`{${name}}`, encodeURIComponent(value));
    });
    if (missingPath.length) {
      setLoading(false);
      showError(`Missing required path parameter${missingPath.length > 1 ? 's' : ''}: ${missingPath.join(', ')}`);
      return;
    }

    let url;
    try {
      url = buildRequestUrl(baseUrlRaw, finalPath, originFallback);
    } catch (error) {
      console.error('Try it buildRequestUrl error', error);
      setLoading(false);
      showError('Unable to construct request URL.');
      return;
    }

    const headers = new Headers();
    headers.set('Accept', 'application/json, */*;q=0.8');

    queryInputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const name = input.dataset.paramName || input.name;
      if (!name) return;
      const value = input.value.trim();
      if (!value) return;
      url.searchParams.set(name, value);
    });

    headerInputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const name = input.dataset.paramName || input.name;
      if (!name) return;
      const value = input.value.trim();
      if (!value) return;
      headers.set(name, value);
    });

    const apiKey = apiKeyInput?.value?.trim?.() || '';
    applySecuritySchemes({
      apiKey,
      headers,
      url,
      security: context.securitySchemes,
    });

    const activeMode = activeBodyOption?.getAttribute('data-body-mode') || 'raw';
    const bodyIsRequired = activeBodyOption?.getAttribute('data-required') === 'true';
    const bodyField = activeBodyOption?.querySelector('[data-tryit-body]');
    let body;

    if (bodyField instanceof HTMLTextAreaElement) {
      if (activeMode === 'form' && activeBodyOption?.hasAttribute('data-has-schema')) {
        const schemaForm = activeBodyOption.querySelector('[data-schema-form]');
        const serialised = serializeSchemaForm(schemaForm);
        if (serialised?.error) {
          setLoading(false);
          showError(serialised.error);
          return;
        }
        if (serialised?.hasContent) {
          bodyField.value = serialised.json;
        } else {
          bodyField.value = bodyIsRequired ? '{}' : '';
        }
      }

      const rawValue = bodyField.value.trim();
      if (rawValue) {
        const contentType =
          form.dataset.bodyContentType ||
          activeBodyOption?.getAttribute('data-content-type') ||
          context.bodyOptions?.[0]?.contentType ||
          '';
        if (contentType) headers.set('Content-Type', contentType);
        body = rawValue;
      } else if (bodyIsRequired || context.bodyOptions?.some((option) => option.required)) {
        setLoading(false);
        showError('Request body is required.');
        return;
      }
    } else if ((bodyIsRequired || context.bodyOptions?.some((option) => option.required)) && method !== 'GET' && method !== 'HEAD') {
      setLoading(false);
      showError('Request body is required.');
      return;
    }

    if (method === 'GET' || method === 'HEAD') {
      body = undefined;
      headers.delete('Content-Type');
    }

    try {
      const started = performance.now();
      const response = await fetch(url.toString(), {
        method,
        headers,
        body,
      });
      const elapsed = performance.now() - started;
      const text = await response.text();
      showSuccess(response.status, response.statusText, elapsed, text, response.headers);
    } catch (error) {
      console.error('Try it request failed', error);
      showError(describeError(error));
    } finally {
      setLoading(false);
    }
  });
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getParameterExample(param) {
  if (!param) return undefined;
  if (param.example !== undefined) return param.example;
  if (param.schema && param.schema.example !== undefined) return param.schema.example;
  if (param.examples && typeof param.examples === 'object') {
    for (const value of Object.values(param.examples)) {
      if (value && typeof value === 'object' && 'value' in value && value.value !== undefined) {
        return value.value;
      }
    }
  }
  if (Array.isArray(param.schema?.enum) && param.schema.enum.length) {
    return param.schema.enum[0];
  }
  if (param.schema && param.schema.default !== undefined) return param.schema.default;
  return undefined;
}

function renderSchemaForm(fields, optionId, initialValue) {
  const rootValue = isPlainObject(initialValue) ? initialValue : {};

  const toPathKey = (path) => (Array.isArray(path) && path.length ? path.join('.') : '');
  const toFieldId = (path) => {
    const key = toPathKey(path);
    if (!key) return optionId;
    return `${optionId}-${key.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
  };
  const formatLabel = (name, fallback = 'Object') => {
    if (!name) return fallback;
    return name
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const normaliseString = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  };
  const valueForPath = (path) => {
    if (!Array.isArray(path) || !path.length) return rootValue;
    return path.reduce((acc, segment) => {
      if (!acc || typeof acc !== 'object') return undefined;
      return acc[segment];
    }, rootValue);
  };

  const primitiveInitialValue = (field) => {
    const dataValue = valueForPath(field.path);
    if (field.type === 'boolean') {
      if (typeof dataValue === 'boolean') return dataValue ? 'true' : 'false';
      if (typeof field.default === 'boolean') return field.default ? 'true' : 'false';
      return field.required ? 'true' : '';
    }
    if (field.type === 'number' || field.type === 'integer') {
      if (typeof dataValue === 'number') return String(dataValue);
      if (typeof field.default === 'number') return String(field.default);
      if (typeof field.example === 'number') return String(field.example);
      return '';
    }
    const raw = dataValue !== undefined ? dataValue : field.default ?? field.example;
    const normalised = normaliseString(raw);
    if (!normalised && Array.isArray(field.enum) && field.required) {
      return normaliseString(field.enum[0]);
    }
    return normalised;
  };

  const arrayInitialValue = (field) => {
    const dataValue = valueForPath(field.path);
    if (Array.isArray(dataValue)) return dataValue;
    if (Array.isArray(field.example)) return field.example;
    if (Array.isArray(field.enum) && field.enum.length) return field.enum;
    return [];
  };

  const renderPrimitive = (field) => {
    const id = toFieldId(field.path);
    const label = formatLabel(field.name || field.path.at(-1) || 'Field');
    const value = primitiveInitialValue(field);
    const pathKey = toPathKey(field.path);
    const descriptionHtml = renderMarkdownLinks(field.description);
    const description = descriptionHtml ? `<p class="api-tryit__hint">${descriptionHtml}</p>` : '';
    const requiredAttr = field.required ? ' required' : '';
    const requiredBadge = field.required ? '<span class="api-tryit__required">*</span>' : '';

    if (field.type === 'boolean') {
      const options = field.required ? ['true', 'false'] : ['', 'true', 'false'];
      const optionsHtml = options
        .map((optionValue) => {
          const isSelected = optionValue === value ? ' selected' : '';
          const labelText = optionValue === '' ? '— Omit —' : optionValue === 'true' ? 'True' : 'False';
          return `<option value="${escapeHtml(optionValue)}"${isSelected}>${escapeHtml(labelText)}</option>`;
        })
        .join('');
      return `
        <div class="api-tryit__field" data-schema-field>
          <label class="api-tryit__label" for="${escapeHtml(id)}">
            ${escapeHtml(label)}${requiredBadge}
          </label>
          <select
            id="${escapeHtml(id)}"
            class="api-tryit__input"
            data-schema-input
            data-schema-path="${escapeHtml(pathKey)}"
            data-schema-type="${escapeHtml(field.type)}"${requiredAttr}
          >${optionsHtml}</select>
          ${description}
        </div>
      `;
    }

    if (Array.isArray(field.enum) && field.enum.length) {
      const options = field.required ? field.enum : [''].concat(field.enum);
      const optionsHtml = options
        .map((optionValue) => {
          const normalised = normaliseString(optionValue);
          const isSelected = normalised === value ? ' selected' : '';
          const display = normalised || '— Select —';
          return `<option value="${escapeHtml(normalised)}"${isSelected}>${escapeHtml(display)}</option>`;
        })
        .join('');
      return `
        <div class="api-tryit__field" data-schema-field>
          <label class="api-tryit__label" for="${escapeHtml(id)}">
            ${escapeHtml(label)}${requiredBadge}
          </label>
          <select
            id="${escapeHtml(id)}"
            class="api-tryit__input"
            data-schema-input
            data-schema-path="${escapeHtml(pathKey)}"
            data-schema-type="${escapeHtml(field.type)}"${requiredAttr}
          >${optionsHtml}</select>
          ${description}
        </div>
      `;
    }

    const inputType = field.type === 'integer' || field.type === 'number' ? 'number' : 'text';
    const stepAttr = field.type === 'integer' ? ' step="1"' : '';
    const placeholder = field.example ? ` placeholder="${escapeHtml(normaliseString(field.example))}"` : '';
    const patternAttr = field.pattern ? ` pattern="${escapeHtml(field.pattern)}"` : '';
    const minAttr = field.minimum !== undefined ? ` min="${escapeHtml(String(field.minimum))}"` : '';
    const maxAttr = field.maximum !== undefined ? ` max="${escapeHtml(String(field.maximum))}"` : '';

    return `
      <div class="api-tryit__field" data-schema-field>
        <label class="api-tryit__label" for="${escapeHtml(id)}">
          ${escapeHtml(label)}${requiredBadge}
        </label>
        <input
          id="${escapeHtml(id)}"
          class="api-tryit__input"
          type="${inputType}"${stepAttr}
          value="${escapeHtml(value)}"${placeholder}
          data-schema-input
          data-schema-path="${escapeHtml(pathKey)}"
          data-schema-type="${escapeHtml(field.type)}"${requiredAttr}${patternAttr}${minAttr}${maxAttr}
        />
        ${description}
      </div>
    `;
  };

  const renderArray = (field) => {
    const id = toFieldId(field.path);
    const label = formatLabel(field.name || field.path.at(-1) || 'Items');
    const values = arrayInitialValue(field).map((item) => normaliseString(item)).join('\n');
    const pathKey = toPathKey(field.path);
    const requiredAttr = field.required ? ' required' : '';
    const requiredBadge = field.required ? '<span class="api-tryit__required">*</span>' : '';
    const descriptionHtml = renderMarkdownLinks(field.description);
    const description = descriptionHtml ||
      escapeHtml('Enter one value per line. The payload will be serialised as an array.');
    const itemType = field.itemType ? ` data-schema-item-type="${escapeHtml(field.itemType)}"` : '';
    const placeholder = field.enum?.length
      ? field.enum.map((item) => normaliseString(item)).join('\n')
      : field.example && Array.isArray(field.example)
        ? field.example.map((item) => normaliseString(item)).join('\n')
        : '';
    const placeholderAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';

    return `
      <div class="api-tryit__field" data-schema-field>
        <label class="api-tryit__label" for="${escapeHtml(id)}">
          ${escapeHtml(label)}${requiredBadge}
        </label>
        <textarea
          id="${escapeHtml(id)}"
          class="api-tryit__input api-tryit__input--textarea"
          rows="3"
          data-schema-input
          data-schema-path="${escapeHtml(pathKey)}"
          data-schema-type="array"${itemType}${requiredAttr}${placeholderAttr}
        >${escapeHtml(values)}</textarea>
        <p class="api-tryit__hint">${description}</p>
      </div>
    `;
  };

  const renderUnsupported = (field) => {
    const label = formatLabel(field.name || 'Field');
    const message = field.message || 'Not supported in form mode. Use Raw JSON instead.';
    return `
      <div class="api-tryit__field api-tryit__field--unsupported">
        <p class="api-tryit__hint api-tryit__hint--warning">
          <strong>${escapeHtml(label)}:</strong> ${escapeHtml(message)}
        </p>
      </div>
    `;
  };

  const renderField = (field) => {
    if (!field) return '';
    if (field.kind === 'object') {
      const legend = formatLabel(field.name || field.path.at(-1) || 'Object');
      const descriptionHtml = renderMarkdownLinks(field.description);
      const description = descriptionHtml ? `<p class="api-tryit__hint">${descriptionHtml}</p>` : '';
      const children = Array.isArray(field.children) && field.children.length
        ? field.children.map(renderField).join('')
        : '<p class="api-tryit__hint">No documented properties for this object.</p>';
      const pathKey = toPathKey(field.path);
      const requiredBadge = field.required ? '<span class="api-tryit__required">*</span>' : '';
      return `
        <fieldset class="api-tryit__fieldset api-tryit__fieldset--schema" data-schema-object data-schema-path="${escapeHtml(pathKey)}">
          <legend>${escapeHtml(legend)}${requiredBadge}</legend>
          ${description}
          ${children}
        </fieldset>
      `;
    }
    if (field.kind === 'primitive') return renderPrimitive(field);
    if (field.kind === 'array') return renderArray(field);
    if (field.kind === 'unsupported') return renderUnsupported(field);
    return '';
  };

  const schemaHtml = Array.isArray(fields) && fields.length ? fields.map(renderField).join('') : '';

  if (!schemaHtml) {
    return '<p class="api-tryit__hint">This schema does not define any properties.</p>';
  }

  return `<div class="api-tryit__schema-fields" data-schema-fields>${schemaHtml}</div>`;
}

function setValueAtPath(target, segments, value) {
  if (!Array.isArray(segments) || !segments.length) return;
  let cursor = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
    } else {
      if (!cursor[segment] || typeof cursor[segment] !== 'object' || Array.isArray(cursor[segment])) {
        cursor[segment] = {};
      }
      cursor = cursor[segment];
    }
  });
}

function serializeSchemaForm(container) {
  if (!container) return { json: '', hasContent: false };
  const inputs = Array.from(container.querySelectorAll('[data-schema-input]'));
  const payload = {};
  let hasContent = false;
  let errorMessage = null;

  inputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return;
    const pathAttr = input.getAttribute('data-schema-path');
    if (!pathAttr) return;
    const type = input.getAttribute('data-schema-type') || 'string';
    const required = input.hasAttribute('required');
    const segments = pathAttr.split('.').filter(Boolean);
    if (!segments.length) return;

    let include = true;
    let value;
    const raw = input.value;

    if (type === 'boolean') {
      if (raw === 'true' || raw === 'false') {
        value = raw === 'true';
      } else {
        include = false;
      }
    } else if (type === 'number' || type === 'integer') {
      const trimmed = raw.trim();
      if (!trimmed) {
        include = false;
      } else {
        const parsed = type === 'integer' ? parseInt(trimmed, 10) : parseFloat(trimmed);
        if (Number.isNaN(parsed)) {
          errorMessage = `Invalid ${type} value for ${pathAttr}`;
          return;
        }
        value = parsed;
      }
    } else if (type === 'array') {
      const trimmed = raw.trim();
      const itemType = input.getAttribute('data-schema-item-type') || 'string';
      if (!trimmed) {
        include = required;
        value = [];
      } else {
        const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
          include = required;
          value = [];
        } else {
          const parsedItems = [];
          for (const line of lines) {
            if (itemType === 'integer' || itemType === 'number') {
              const numeric = itemType === 'integer' ? parseInt(line, 10) : parseFloat(line);
              if (Number.isNaN(numeric)) {
                errorMessage = `Invalid ${itemType} value in ${pathAttr}: ${line}`;
                break;
              }
              parsedItems.push(numeric);
            } else if (itemType === 'boolean') {
              if (line.toLowerCase() === 'true' || line.toLowerCase() === 'false') {
                parsedItems.push(line.toLowerCase() === 'true');
              } else {
                errorMessage = `Invalid boolean value in ${pathAttr}: ${line}`;
                break;
              }
            } else {
              parsedItems.push(line);
            }
          }
          if (errorMessage) return;
          value = parsedItems;
          include = parsedItems.length > 0 || required;
        }
      }
    } else {
      const trimmed = raw.trim();
      if (!trimmed) {
        if (required) {
          value = trimmed;
        } else {
          include = false;
        }
      } else {
        value = trimmed;
      }
    }

    if (errorMessage) return;
    if (!include) return;

    hasContent = true;
    setValueAtPath(payload, segments, value);
  });

  if (errorMessage) {
    return { error: errorMessage };
  }

  return {
    json: JSON.stringify(payload, null, 2),
    hasContent,
  };
}

function joinRequestPath(...segments) {
  const parts = [];
  segments.forEach((segment) => {
    if (typeof segment !== 'string') return;
    segment
      .split('/')
      .map((part) => part.trim())
      .forEach((part) => {
        const cleaned = part.replace(/^\/+|\/+$/g, '');
        if (cleaned) parts.push(cleaned);
      });
  });
  if (!parts.length) return '/';
  return `/${parts.join('/')}`;
}

function isAbsoluteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function buildRequestUrl(base, path, originFallback) {
  const safePath = typeof path === 'string' ? path : '';
  if (isAbsoluteUrl(base)) {
    const parsed = new URL(base);
    const combinedPath = joinRequestPath(parsed.pathname || '/', safePath);
    const url = new URL(parsed.origin);
    url.pathname = combinedPath;
    return url;
  }
  const origin = isAbsoluteUrl(originFallback) ? originFallback : originFallback ? originFallback : '';
  if (!origin) throw new Error('Missing origin');
  const url = new URL(origin);
  const combinedPath = joinRequestPath(base || '/', safePath);
  url.pathname = combinedPath;
  return url;
}

function buildHttpAuthorizationHeader(value, schemeName) {
  if (!value) return '';
  if (!schemeName) return value;
  const normalizedScheme = schemeName.toLowerCase();
  if (normalizedScheme === 'bearer') {
    return /^bearer\s+/i.test(value) ? value : `Bearer ${value}`;
  }
  if (normalizedScheme === 'basic') {
    if (/^basic\s+/i.test(value)) return value;
    try {
      return `Basic ${btoa(value)}`;
    } catch {
      return `Basic ${value}`;
    }
  }
  return `${schemeName} ${value}`;
}

function applySecuritySchemes({ apiKey, headers, url, security }) {
  if (!apiKey || !Array.isArray(security) || !security.length) return;
  const keyValue = apiKey.trim();
  if (!keyValue) return;

  security.forEach((scheme) => {
    if (!scheme || !scheme.type) return;

    if (scheme.type === 'apiKey') {
      const location = scheme.in || 'header';
      const name = scheme.name || 'Authorization';
      if (location === 'header') {
        headers.set(name, keyValue);
      } else if (location === 'query') {
        url.searchParams.set(name, keyValue);
      } else if (location === 'cookie') {
        headers.append('Cookie', `${name}=${encodeURIComponent(keyValue)}`);
      }
    } else if (scheme.type === 'http') {
      const headerValue = buildHttpAuthorizationHeader(keyValue, scheme.scheme || 'Bearer');
      if (headerValue) {
        headers.set('Authorization', headerValue);
      }
    }
  });
}

function buildProxyLookup(table) {
  const map = new Map();
  if (!Array.isArray(table)) return map;
  table.forEach((entry) => {
    if (!entry || typeof entry.originalUrl !== 'string') return;
    const normalizedOriginal = normalizeServerUrl(entry.originalUrl);
    if (normalizedOriginal) {
      map.set(normalizedOriginal, entry);
    }
    if (typeof entry.normalizedUrl === 'string' && entry.normalizedUrl) {
      map.set(entry.normalizedUrl, entry);
    }
  });
  return map;
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

function autoMountTryIt() {
  if (typeof window === 'undefined' || !window.document) return;
  const { document } = window;
  const roots = document.querySelectorAll(AUTO_ROOT_SELECTOR);
  if (!roots.length) return;
  roots.forEach((root) => {
    if (!(root instanceof HTMLElement)) return;
    const currentState = root.getAttribute(AUTO_ROOT_STATE_ATTR);
    if (currentState === 'pending' || currentState === 'mounted') return;

    const rootId = root.id || DEFAULT_TRY_IT_ROOT_ID;
    const props = { rootId };
    const operationSlug = root.dataset.tryitOperation;
    const tagSlug = root.dataset.tryitTag;
    const preferredTag = root.dataset.tryitPreferredTag;
    if (operationSlug) props.operationSlug = operationSlug;
    if (tagSlug) props.tagSlug = tagSlug;
    if (preferredTag) props.preferredTag = preferredTag;

    root.setAttribute(AUTO_ROOT_STATE_ATTR, 'pending');
    mountTryIt(props)
      .then(() => {
        root.setAttribute(AUTO_ROOT_STATE_ATTR, 'mounted');
      })
      .catch((error) => {
        root.removeAttribute(AUTO_ROOT_STATE_ATTR);
        console.error('starlight-openapi-navigator: auto-mount failed', error);
      });
  });
}

if (typeof window !== 'undefined' && window.document) {
  const scheduleAutoMount = () => autoMountTryIt();
  if (window.document.readyState === 'loading') {
    window.document.addEventListener('DOMContentLoaded', scheduleAutoMount, { once: true });
  } else if (typeof queueMicrotask === 'function') {
    queueMicrotask(scheduleAutoMount);
  } else {
    setTimeout(scheduleAutoMount, 0);
  }
  window.addEventListener?.('astro:page-load', autoMountTryIt);
}

function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
