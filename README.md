# Starlight OpenAPI Navigator

Starlight OpenAPI Navigator is a first-class Astro/Starlight integration that turns an OpenAPI document into a fully static API reference. At build time it generates an overview, a page per operation, and a schema explorer that plug directly into Starlight’s table of contents, search index, and theming system. In dev mode it even provisions a zero-config proxy derived from your OpenAPI server URLs so “Try it live” calls work without CORS headaches.

## Feature Highlights

- **Full-site generation** – Emits static `.astro` pages for overview, operations, and schemas, so production deploys stay lightweight and cache-friendly.
- **Endpoint workspaces** – Every operation gets a deep-linkable route with tabbed panels for parameters, responses, code samples, and an integrated “Try it live” runner with API key storage.
- **Schema explorer** – Dedicated page per schema with `$ref` links and a global searchable selector for quick jumps.
- **Native Starlight UX** – Uses AnchorHeading, Tabs, ToC, color themes, and search just like any other Starlight page—no iframes or runtime embeds.
- **Smart navigation** – Optional sidebar injection that groups operations by tag with customizable ordering, labeling, and badges.
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

## Remote Spec URLs

Navigator can bootstrap from any publicly reachable `http://` or `https://` OpenAPI document. Set `specPath` to the remote URL and the integration will fetch it at dev/build startup before generating pages. Because there’s no local file to watch, spec hot-reload is unavailable—reload the dev server (or restart the build) after remote changes.

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
- `navigation.enabled` injects the generated hierarchy into the Starlight sidebar, with options to replace or reposition groups.
- `navigation.schemasItem = false` removes the schemas entry entirely.
- `endpointUI` toggles endpoint navigation (`menu`, `search`, or `auto`). Auto switches to search mode once the spec exceeds 20 operations.

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
