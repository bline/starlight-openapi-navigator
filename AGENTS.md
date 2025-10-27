# Repository Guidelines

## Project Structure & Module Organization
This repository is a pnpm workspace with two packages.
- `packages/starlight-openapi-navigator/` is the published integration. `index.js` wires Astro hooks, `parser/` normalizes specs, `pages/` emits Starlight routes, `components/` holds the Astro UI, and `runtime/` stores shared runtime bits.
- `packages/sandbox/` is the demo Starlight site. It depends on the workspace plugin via `workspace:*` and lives entirely inside the repo for quick smoke checks.
Keep the top-level `TODO.md` roadmap in sync whenever a tracked milestone ships.

## Astro advice
- Astro automatically adds `type="module"` to `<script>` tags. If a script tag has any attribute at all, Astro does not process it and renders it as is on the page. If you add an attribute to a `<script>` tag, this processing does not happen which means imports do not work as expected.
- Astro does not allow you to embed build level variables in `<script>` as `${}` or `{}`, you must use a separate `<script type="application/json" set:html={JSON.stringify(data)} />` or you must use `data-*` attributes and fetch these from the `<script>` that you need the data.

## Build, Test, and Development Commands
Use Node 18+ and pnpm. All commands run from the repo root.
- `pnpm install` — links workspace packages and installs Astro/Starlight for the sandbox.
- `pnpm --filter starlight-openapi-sandbox dev` — boots the demo site with live-reloading integration output.
- `pnpm --filter starlight-openapi-sandbox build` — confirms the generated pages survive a production build.
- `pnpm --filter starlight-openapi-navigator test` — runs Node’s built-in test runner once suites live under `packages/starlight-openapi-navigator`.

## Coding Style & Naming Conventions
Follow the existing 2-space indentation, single quotes, and terminating semicolons. Prefer `node:` prefixed imports for core modules and maintain JSDoc typedefs for public structures. Functions and variables use `camelCase`, constants use `UPPER_SNAKE_CASE`, and Astro components remain `PascalCase`. Keep helpers small and colocated with their domain (parser utilities in `parser/`, page builders in `pages/`), and avoid leaking host-specific paths outside the page layer.

## Testing Guidelines
Tests are not committed yet, so add targeted suites beside the modules they cover (e.g., `parser/__tests__`). Use fixture specs under `tests/fixtures/` to exercise tricky cases such as remote URLs, tag overrides, and reserved slugs. Aim to cover both happy paths and failure messaging, especially when throwing errors surfaced to Astro logs. When touching endpoints, verify the sandbox still renders overview, operation, and schema pages.

## Commit & Pull Request Guidelines
History is currently a single initial commit; keep new subjects short, imperative, and scope-led (e.g., `parser: guard duplicate tags`). Squash noisy work before pushing. In PRs, include a clear summary, note the spec fixtures touched, update `TODO.md` when relevant, and attach screenshots or dev-server notes if UI output changes. Link tracking issues and call out any manual steps required for reviewers.

## Security & Configuration Tips
Never log credential-bearing values from specs or storage helpers. Respect the namespacing plan outlined in `TODO.md` when adding persistence, and ensure new fetch logic enforces byte and timeout limits. When testing remote specs, strip tokens from checked-in fixtures and prefer environment variables inside the sandbox.
