# Repository Guidelines

## Project Structure & Module Organization
The integration is authored in plain ESM and is organized for clarity between code generation, runtime helpers, and Astro presentation.
- `index.js` resolves user options, wires the integration hooks, and coordinates spec parsing plus page emission.
- `parser/` normalizes OpenAPI specs (`loadAndNormalizeSpec`) and owns slugging/tag bookkeeping.
- `pages/` builds the generated Astro routes and writes them to the consuming project.
- `components/` exposes the Astro UI fragments copied into the host site at build time.
- `runtime/` carries the runtime constants shared by components.
Keep the `TODO.md` roadmap in sync whenever a tracked milestone ships.

## Build, Test, and Development Commands
There is no bundling step; code is consumed as-is by Astro. Use Node 18+ and pnpm.
- `pnpm create astro@latest fixtures/sandbox -- --template starlight` — scaffolds a local Starlight sandbox (gitignored) for manual testing.
- `pnpm astro dev --root fixtures/sandbox` — runs the sandbox and hot-reloads the integration; add this repo via a `link:` dependency so edits are reflected immediately.
- `node --test tests/**/*.test.js` — executes unit suites with Node’s built-in runner once you add tests.
- `pnpm astro build --root fixtures/sandbox` — ensures generated pages survive the static build before opening a PR.

## Coding Style & Naming Conventions
Follow the existing 2-space indentation, single quotes, and terminating semicolons. Prefer `node:` prefixed imports for core modules and maintain JSDoc typedefs for public structures. Functions and variables use `camelCase`, constants use `UPPER_SNAKE_CASE`, and Astro components remain `PascalCase`. Keep helpers small and colocated with their domain (parser utilities in `parser/`, page builders in `pages/`), and avoid leaking host-specific paths outside the page layer.

## Testing Guidelines
Tests are not committed yet, so add targeted suites beside the modules they cover (e.g., `parser/__tests__`). Use fixture specs under `tests/fixtures/` to exercise tricky cases such as remote URLs, tag overrides, and reserved slugs. Aim to cover both happy paths and failure messaging, especially when throwing errors surfaced to Astro logs. When touching endpoints, verify the sandbox still renders overview, operation, and schema pages.

## Commit & Pull Request Guidelines
History is currently a single initial commit; keep new subjects short, imperative, and scope-led (e.g., `parser: guard duplicate tags`). Squash noisy work before pushing. In PRs, include a clear summary, note the spec fixtures touched, update `TODO.md` when relevant, and attach screenshots or dev-server notes if UI output changes. Link tracking issues and call out any manual steps required for reviewers.

## Security & Configuration Tips
Never log credential-bearing values from specs or storage helpers. Respect the namespacing plan outlined in `TODO.md` when adding persistence, and ensure new fetch logic enforces byte and timeout limits. When testing remote specs, strip tokens from checked-in fixtures and prefer environment variables inside the sandbox.
