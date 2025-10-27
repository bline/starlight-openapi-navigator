# Starlight OpenAPI Navigator

Starlight OpenAPI Navigator is a first-class Astro/Starlight integration that turns an OpenAPI document into a fully static API reference. At build time it generates an overview, a page per operation, and a schema explorer that plug directly into Starlight’s table of contents, search index, and theming system. In dev mode it even provisions a zero-config proxy derived from your OpenAPI server URLs so “Try it live” calls work without CORS headaches.

## Feature Highlights

- **Full-site generation** – Emits static `.astro` pages for overview, operations, and schemas, so production deploys stay lightweight and cache-friendly.
- **Endpoint workspaces** – Every operation gets a deep-linkable route with tabbed panels for parameters, responses, code samples, and an integrated “Try it live” runner with API key storage.
- **Schema explorer** – Dedicated page per schema with `$ref` links and a global searchable selector for quick jumps.
- **Native Starlight UX** – Uses AnchorHeading, Tabs, ToC, color themes, and search just like any other Starlight page—no iframes or runtime embeds.
- **Smart navigation** – Optional sidebar injection that groups operations by tag with customizable ordering, labeling, and badges.
- **Multi-spec aware** – Serve several OpenAPI documents side-by-side with isolated routes (e.g. `/api/stripe`, `/api/msgraph`) and per-spec config.
- **Developer ergonomics** – Watches your spec in dev, regenerates pages instantly, hydrates code samples per language, and spins up a Vite proxy based on declared servers to bypass dev-time CORS.

## Why Navigator?

| Feature                         | starlight-openapi             | starlight-openapi-rapidoc  | **starlight-openapi-navigator** |
| ------------------------------- | ----------------------------- | -------------------------- | -------------------------------- |
| Build-time page generation      | ❌ (single page runtime embed) | ❌                          | ✅                                |
| Endpoint-per-page               | ❌                             | ❌                          | ✅                                |
| Schema browser                  | ⚠️ minimal                    | ⚠️ monolithic Rapidoc view | ✅ multi-panel with links         |
| Deep-link headings              | ⚠️ limited                    | ✅ but inside iframe        | ✅ native Astro headings          |
| Dev proxy / CORS bypass         | ❌                             | ❌                          | ✅                                |
| Theming & side menu integration | ⚠️ partial                    | ❌ (separate iframe)        | ✅ native Starlight               |
| Configurable sorting/exclusions | ❌                             | ⚠️ limited                 | ✅                                |
| Code examples per language      | ⚠️                            | ⚠️                         | ✅ tabbed                         |
| API key auth                    | ⚠️ manual                     | ✅ Rapidoc UI               | ✅ simple localstorage            |
| “Try it live”                   | ⚠️ limited                    | ✅ built-in Rapidoc         | ✅ integrated panel               |
| Search integration              | ❌                             | ❌                          | ✅ full Starlight search          |
| Static deploy friendliness      | ⚠️                            | ❌ (needs JS app)           | ✅ pure static pages              |

## Quick Start

1. Install the integration alongside Astro/Starlight (requires Node 18.17+):
   ```bash
   pnpm add -D starlight-openapi-navigator
   ```
2. Register the plugin inside Starlight’s `plugins` array (e.g. `starlight.config.mjs`):
   ```js
   import { defineConfig } from 'astro/config';
   import starlight from '@astrojs/starlight';
   import starlightOpenApiNavigator from 'starlight-openapi-navigator';

   export default defineConfig({
     integrations: [
       starlight({
         title: 'Docs',
         // ...any other Starlight config
         plugins: [
           starlightOpenApiNavigator({
             specPath: 'public/openapi.yaml',
             baseSlug: 'api',
             navigation: {
               enabled: true,
               groupLabel: 'API Explorer',
             },
           }),
         ],
       }),
     ],
   });
   ```
3. Place your OpenAPI document at `public/openapi.yaml` (or point `specPath` at an `https://…/openapi.yaml` URL—remote specs are fetched on demand and aren’t file-watched).
4. Run the Starlight dev server and explore `/api/…` routes:
   ```bash
   pnpm astro dev
   ```

During `astro dev`, the spec file is watched for changes and the docs are regenerated automatically.

### Multiple Specs & Nested Layouts

Pass an array to `starlightOpenApiNavigator` to generate multiple API references in one site. When more than one spec is configured the plugin automatically nests each set of pages under `<baseSlug>/<instanceId>` so routes do not collide and rebuilds can safely remove old folders. You can override the behavior per spec with `nestUnderBase`:

```ts
plugins: [
  starlightOpenApiNavigator([
    {
      instanceId: 'stripe',
      specPath: 'https://raw.githubusercontent.com/stripe/openapi/refs/heads/master/openapi/spec3.yaml',
      nestUnderBase: true,   // emits /api/stripe/…
    },
    {
      instanceId: 'msgraph',
      specPath: 'https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/v1.0/openapi.yaml',
      operations: {
        include: [{ pathStartsWith: '/users' }],
      },
      nestUnderBase: true,   // emits /api/msgraph/…
    },
  ]),
];
```

With a single spec `nestUnderBase` defaults to `false` so you retain the classic `/api/...` layout; set it to `true` if you prefer the grouped structure even when only one document is present.

### Filtering Operations

Massive OpenAPI documents are common (15k+ operations in Microsoft Graph). Use the `operations` option to pare them down without editing the source spec. `include` acts as an allow list, while `exclude` removes matching operations after the include step. Matchers can be simple strings (treated as `pathStartsWith`) or objects with `path`, `pathStartsWith`, `slug`, and `method`/`methods` keys:

```js
operations: {
  include: [
    '/users',
    { pathStartsWith: '/me', methods: ['GET', 'PATCH'] },
    { slug: 'groups-list' },
  ],
  exclude: [
    { path: '/users/{id}/messages' },
  ],
}
```

Anything not matched by `include` is omitted; anything matched by `exclude` is removed even if it was included earlier.

## Remote Spec URLs

Navigator can bootstrap from any publicly reachable `http://` or `https://` OpenAPI document. Set `specPath` to the remote URL and the integration will fetch it at dev/build startup before generating pages. Because there’s no local file to watch, spec hot-reload is unavailable—reload the dev server (or restart the build) after remote changes.

## Roadmap: Enterprise-Scale Specs

Stress-testing with Stripe’s OpenAPI (≈9 MB YAML, 500+ operations) highlighted two remaining bottlenecks during `astro build`:

- The generated `spec-data` module still holds the entire normalized spec in one bundle, so Node allocates the full object plus a huge JSON string while serializing.
- Each operation page pulls its payload from that shared module at render time, meaning the whole document stays resident while Vite compiles every route.

We’re planning to ship both of the following improvements to keep builds stable for enterprise-sized specs:

1. **Chunked runtime loader** – Split the generated payload into a compact manifest (info, stats, tag/operation digests) plus per-tag chunks that `import()` lazily. Operation pages read only the chunk they need, keeping the base module tiny and capping peak heap usage.
2. **Pre-rendered operation payloads** – During page generation, serialize each operation’s resolved data directly into the `.astro` file (similar to how schema pages already inline their data). This removes the need to materialize the full spec at runtime while preserving Starlight’s static HTML for search indexing.

Both approaches maintain compatibility with Starlight’s built-in search because the final HTML still contains the full operation content—there are no client-only fetches.

## Generated Pages

- **Overview** – Summarizes API metadata, tags, servers, and quick links.
- **Operation pages** – One route per `tag → operation` with panels for:
  - Parameters (grouped by path, query, header, body)
  - Sample responses with example payloads
  - Language-tabbed code samples (filtered/renamed via config)
  - “Try it live” client that respects auth headers, servers, and schema-derived forms
- **Schema pages** – Each component schema gets its own page with anchored sections and a searchable selector for jumping between schemas.

All headings participate in Starlight’s deep linking and global search index.

## Endpoint Navigation Modes

Use the `endpointUI` option to control how endpoints are surfaced:

- `menu` – Keep the per-tag listing on the overview page and, when sidebar navigation is enabled, populate it with tag groups.
- `search` – Replace the overview listing with an inline autocomplete widget and surface the same control at the top of every operation page. Endpoint groups are omitted from the sidebar to keep it compact.
- `auto` (default) – Stick with the menu until the spec exceeds 20 operations, then switch to search mode automatically.

The search widget runs entirely client-side using pre-generated JSON embedded in each page, so no additional network calls are required.

## Schema Navigation

Each schema now renders on its own page under `/api/schemas/<schema>/`. The schema index and every schema detail page include an always-open searchable selector (no extra network fetches) that filters the list in-place so you can jump quickly between schemas—even for very large specifications.

## Dev Proxy & “Try it Live”

Navigator inspects `servers` entries from your OpenAPI document and automatically configures a Vite proxy during `astro dev`:

- Proxy context paths are generated per origin (e.g. `/__openapi/api-example-com/v1`).
- The “Try it live” panel rewrites requests through that proxy so you can call real services without browser CORS issues.
- API keys entered in the panel are stored locally (via `localStorage`) and reused across operations.

For production builds the proxy is omitted; the generated pages stay 100% static.

## Configuration Reference

```ts
starlight({
  // ...other Starlight options
  plugins: [
    starlightOpenApiNavigator({
      specPath: 'public/openapi.yaml',
      watchSpec: true,
      baseSlug: 'api',
      nestUnderBase: true,
      outputDir: 'src/pages/api',
      tags: {
        include: ['payments'],
        exclude: ['internal'],
        order: ['core', 'payments'],
        overrides: {
          payments: {
            label: 'Payments',
            sidebarLabel: 'Payments API',
            description: 'Public payment operations',
          },
        },
      },
      codeSamples: {
        includeLanguages: ['javascript', 'python'],
        rename: {
          javascript: 'Node.js',
          python: 'Python 3',
        },
      },
      operations: {
        include: [
          '/payments',
          { pathStartsWith: '/balances', methods: ['GET'] },
        ],
        exclude: [
          { path: '/payments/internal' },
        ],
      },
      navigation: {
        enabled: true,
        groupLabel: 'API Explorer',
        replaceGroupLabel: 'API Explorer',
        insertPosition: 'append', // or 'prepend'
        insertBefore: undefined,  // label of another sidebar group
        insertAfter: undefined,   // label of another sidebar group
        tagSort: 'spec',          // or 'alpha'
        operationSort: 'spec',    // or 'alpha'
        operationLabel: 'summary',// or 'path'
        operationTitle: 'path',   // or 'summary'
        overviewItem: {
          label: 'Overview',
          link: '/api/',
          badge: { text: 'New', variant: 'note' },
        },
        schemasItem: {
          label: 'Schemas',
          link: '/api/schemas/',
        },
      },
    }),
  ],
});
```

Key behaviors:

- `specPath` accepts absolute/relative filesystem paths or `http(s)` URLs; remote specs are fetched at startup and aren’t file-watched.
- `watchSpec` regenerates docs on spec changes during dev for local files.
- `baseSlug` controls the route prefix (`/api/...`) and `outputDir` can redirect the generated files elsewhere.
- `tags.include/exclude/order` filter and prioritize tag groups; `tags.overrides` can rename labels/descriptions.
- `codeSamples.includeLanguages` narrows languages; `codeSamples.rename` renames sample tabs (case-insensitive).
- `operations.include` / `operations.exclude` accept strings (treated as leading path prefixes) or matcher objects (`{ path, pathStartsWith, slug, method, methods }`) so you can slim massive specs down to the endpoints you care about.
- `navigation.enabled` injects the generated hierarchy into the Starlight sidebar, with options to replace or reposition groups.
- `navigation.schemasItem = false` removes the schemas entry entirely.
- `endpointUI` toggles endpoint navigation (`menu`, `search`, or `auto`). Auto switches to search mode once the spec exceeds 20 operations.
- `nestUnderBase` (default `true` when multiple specs are configured) emits pages under `<baseSlug>/<instanceId>` and keeps rebuilds tidy; set it explicitly per spec to opt in or out.

## Project Layout

This repository ships both the integration and a sandbox Starlight site:

```
packages/
  starlight-openapi-navigator/   # Published integration source
  sandbox/                       # Demo Starlight site wired to the integration
```

The sandbox consumes the integration via `workspace:*` so you can smoke-test changes without publishing.

## Contributing & Local Development

- Install workspace dependencies: `pnpm install`
- Run the demo site locally: `pnpm --filter starlight-openapi-sandbox dev`
- Build the demo for production validation: `pnpm --filter starlight-openapi-sandbox build`
- (Future) add tests under `packages/starlight-openapi-navigator/**/__tests__` and run with `pnpm --filter starlight-openapi-navigator test`

Please keep the top-level `TODO.md` roadmap in sync when shipping milestones, and avoid checking in secrets inside fixture specs.

## License

MIT © Scott Beck
