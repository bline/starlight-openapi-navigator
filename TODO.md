# TODO

A week-long push to get **Starlight OpenAPI Navigator** ready for OSS release.

> Legend: **P0** must-ship this week • **P1** nice-to-have if time permits • **P2** backlog
> Status: ☐ not started · ◐ in progress · ☐🔶 blocked · ☑ done

---

## 0) Release Targets

* **P0** ☐ `v0.1.0` (OSS preview, feature-complete enough for real use)
* **P1** ☐ `v0.2.0` (OAuth2 + large-spec perf)

---

## 1) Security & Auth

* **P0** ☐ **Scoped storage for multiple instances**
  **AC:** All persisted values (API key, language, panel state, last server) are namespaced by `storageVersion:baseSlug:(instanceId|specId)`; new helper wraps `localStorage` access.
* **P0** ☐ **Legacy storage migration**
  **AC:** On first run, old global keys are migrated into the new namespace, then removed.
* **P0** ☐ Show/Hide + Clear for API key
  **AC:** Hidden by default; clear wipes namespaced keys only.
* **P1** ☐ “Which schemes applied?” disclosure under “Try it”
  **AC:** Displays header/query auth applied (e.g., `Authorization: Bearer …`), never reveals full secrets.
* **P1** ☐ Redact secrets in request/response transcript
  **AC:** No tokens/keys in logs or error panels.
* **P1** ☐ CSP & sanitization pass
  **AC:** Any HTML-ish content safely escaped; headings/desc safe.

---

## 2) Try-It Console

* **P0** ☐ Dev-proxy badge & tooltip
  **AC:** Shows “Proxied in dev”; tooltip reveals original URL.
* **P0** ☐ Copy as curl/fetch/axios
  **AC:** Copies fully resolved request (method, URL, headers, body).
* **P1** ☐ Pretty JSON + collapsible viewer
  **AC:** Toggle raw/pretty; error status highlighted.
* **P1** ☐ File uploads (`multipart/form-data`)
  **AC:** Supports single/multi-file; boundary handled.
* **P2** ☐ Rate-limit hinting
  **AC:** Surfaces `Retry-After`/vendor headers when present.

---

## 3) Schema Explorer & Forms

* **P0** ☐ JSON fallback for unsupported constructs
  **AC:** For `oneOf/anyOf/not/additionalProperties` & complex arrays, expose inline JSON editor with schema hints.
* **P0** ☐ Deep-linkable component panels
  **AC:** Stable IDs; browser back/forward restore scroll.
* **P1** ☐ Discriminator UI
  **AC:** Model picker when `discriminator` present.
* **P1** ☐ Array item builder polish
  **AC:** Add/remove controls; min/max respected.
* **P2** ☐ Example picker
  **AC:** Tabs for multiple examples.

---

## 4) Navigation, Pages & Search

* **P0** ☐ Reserved-route guardrails (enforced & documented)
  **AC:** No collisions with `index`/`schemas`; friendly build error with fix.
* **P0** ☐ Tag/group customization
  **AC:** Config supports custom tag order, hide/rename tags; endpoints reorderable.
* **P0** ☐ Search indexing verification
  **AC:** Searching “CreateBulkJob” finds endpoint page and “Parameters” heading.
* **P1** ☐ Breadcrumbs
  **AC:** `API > {Tag} > {OperationId}` aligned with site chrome.
* **P2** ☐ Optional grouping by path prefix

---

## 5) **Remote Spec URL Support**

* **P0** ☐ Accept `spec` as **URL** (JSON/YAML) at build & dev time
  **AC:** `spec: 'https://…/openapi.{json|yaml}'` generates overview, endpoints, schemas exactly like local files.
* **P0** ☐ Build-time fetch with caching & limits
  **AC:** ETag/If-None-Match respected; `maxBytes`, `timeoutMs` enforced; helpful error page on failure.
* **P0** ☐ Config surface for remote fetch
  **AC:** `remote: { headers?, maxBytes, timeoutMs, cache, etag, allowInProd, whitelist? }` with sensible defaults.
* **P0** ☐ **Dev-only “Explore any URL”** route
  **AC:** `/api/__explore` lets you paste a URL; server-side fetch + hot-regenerate; route is absent in prod.
* **P1** ☐ Optional **CLI** to explore
  **AC:** `npx starlight-openapi-navigator explore <url>` launches `astro dev` wired to that URL.
* **P1** ☐ Remote-auth for spec fetch
  **AC:** `remote.headers` supports Bearer/Basic; errors redact secrets.
* **P2** ☐ Last-Modified caching fallback
  **AC:** Uses `If-Modified-Since` where ETag unavailable.

---

## 6) Performance (Large Specs)

* **P0** ☐ Lazy render schema explorer panels
  **AC:** Only expanded panel mounts; initial load OK for 1k+ components.
* **P1** ☐ Virtualized lists for huge operations/components
  **AC:** Sidebar & explorer stay fluid at scale.
* **P1** ☐ Per-page code-splitting of heavy UI chunks
  **AC:** Endpoint pages load minimal JS; explorer code not loaded there.
* **P2** ☐ Optional split schemas into A–Z subpages

---

## 7) Config & DX

* **P0** ☐ Unified config object with defaults
  **AC:** `navigator({ baseSlug, spec, instanceId?, storageVersion?, remote?, nav, pages, tryIt, auth })` typed; documented.
* **P0** ☐ Helpful build-time errors with actionable messages
  **AC:** Missing/invalid spec, unknown tag, bad URL/whitelist—all with fixes.
* **P1** ☐ Hot reload on `openapi.yaml` change (local)
  **AC:** Touching spec regenerates pages & nav without server restart.
* **P1** ☐ Init scaffolder (optional)
  **AC:** `npx starlight-openapi-navigator init` writes config + example.

---

## 8) Accessibility & Theming

* **P0** ☐ Correct heading hierarchy & TOC
  **AC:** No level skips; panels use semantic `<h2/h3>`.
* **P0** ☐ Keyboard nav & focus management
  **AC:** Tabs, expanders, Try-it controls fully tabbable; visible focus ring.
* **P0** ☐ Contrast & dark mode parity
  **AC:** Badges, code, tables meet WCAG AA, both themes.
* **P1** ☐ Respect `prefers-reduced-motion`

---

## 9) Testing & QA

* **P0** ☐ Fixture specs (OpenAPI 2.0/3.0/3.1; small/med/large)
  **AC:** CI builds all fixtures, including at least one **remote URL** fixture (mocked).
* **P0** ☐ Unit tests: param resolution, security injection, request assembly
  **AC:** Header/query auth, path templating, server URL join covered.
* **P1** ☐ E2E smoke (Playwright)
  **AC:** Load overview, endpoint page, schema explorer; run mocked Try-it request; verify namespaced storage keys.
* **P1** ☐ TypeScript strict across public types
  **AC:** No `any` in public API.
* **P2** ☐ Perf budget in CI (bundle size, endpoint TTI)

---

## 10) Docs (prep for README)

* **P0** ☐ Quickstart (local file & remote URL examples)
* **P0** ☐ “How it works” diagram (build-time codegen → pages → dev proxy)
* **P0** ☐ Config reference table (incl. `instanceId`, `storageVersion`, `remote.*`)
* **P0** ☐ Auth guide (API key now; OAuth later)
* **P1** ☐ Customization cookbook (hide/sort/rename endpoints/tags)
* **P1** ☐ Migration notes (from SwaggerUI/ReDoc/RapiDoc)

---

## 11) Examples

* **P0** ☐ `examples/basic` — local spec + API key auth
* **P1** ☐ `examples/remote` — spec URL with headers + ETag cache
* **P1** ☐ `examples/multi-instance` — two explorers (v1 & v2) proving scoped storage
* **P1** ☐ `examples/large-spec` — stress test + perf tips

---

## 12) CI / Repo Hygiene

* **P0** ☐ GitHub Actions: lint + typecheck + build + fixtures
* **P0** ☐ Prettier & ESLint; commit hooks
* **P0** ☐ MIT license, CoC, Contributing, Issue templates
* **P1** ☐ Release workflow with Changesets / npm provenance

---

## 13) Future (Post-v0.1)

* **P1** ☐ OAuth2 (Auth Code + PKCE; Device Code)
* **P1** ☐ Multi-spec/version switcher (v1/v2 dropdown)
* **P2** ☐ AsyncAPI / GraphQL (stretch)
* **P2** ☐ Plugin hooks for custom panels & request transformers
* **P2** ☐ i18n for generated labels

---

## Suggested One-Week Plan

**Day 1**

* P0: **Scoped storage** (helper + migration), Show/Hide/Clear, headings/TOC audit.

**Day 2**

* P0: **Remote spec URL** basic fetch + parse; build-time error handling; config defaults.

**Day 3**

* P0: Dev-proxy badge; Copy as curl/fetch/axios; reserved-route guardrails.

**Day 4**

* P0: **Explore any URL** dev route; ETag caching; whitelist/limits; docs stubs.

**Day 5**

* P0: Fixtures + CI (incl. remote); unit tests for request assembly & security; dark mode/contrast pass.

**Day 6**

* P1: Pretty JSON viewer; file uploads; lazy schema panel mount.

**Day 7**

* P1: `examples/remote` + `examples/multi-instance`; Quickstart & Config table draft.

---

## Open Questions

* Should remote fetch in production be optionally **disabled by default** for stricter environments (`remote.allowInProd=false`)?
* For namespacing, do we prefer `instanceId` **required** when multiple navigators are present, or keep it optional with a derived `specId` fallback?
* Do we want a minimal JSON editor dependency (e.g., CodeMirror) or stick to a plain `<textarea>` first?

---

## Changelog (planned)

* `v0.1.0`: Static multi-page OpenAPI docs for Starlight; **scoped storage**; **remote spec URL** (with ETag & limits); dev proxy + badge; Try-it; schema explorer; API key auth; deep links; search/TOC integration; examples; CI.

