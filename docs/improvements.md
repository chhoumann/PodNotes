### Build & Tooling
- Migrate bundling to Vite (or SvelteKit adapter for Obsidian) to get faster dev/HMR, simpler Svelte 5 config, and better tree-shaking. Use `build.lib` with `formats: ['cjs']` to satisfy Obsidian’s CJS requirement, and keep esbuild only if needed for legacy outputs.
- Enable `sourcemap: false` in production and `minify + drop: ['console']` to shrink the ~624 KB `main.js`. Consider removing unused deps (e.g., evaluate whether `openai` is needed client-side).
- Enforce lint/format in CI: add `biome check` (or eslint + prettier) plus `tsc --noEmit` to catch issues pre‑release.
- Tighten TypeScript: turn on `strict`, remove `allowJs`, consider `noImplicitOverride`, and drop `inlineSourceMap` for builds to reduce bundle size.
- Add lint rules for consistent type-only imports (`@typescript-eslint/consistent-type-imports`) and `import/no-duplicates`; run a codemod to ensure consistency.
- Add `.nvmrc` and keep `engines.node >=22` for local/CI parity. Consider `engine-strict=true` in `.npmrc`.

### Testing
- Extend component tests (Vitest + @testing-library/svelte) for Progressbar, TopBar, Image, and keyboard/a11y flows we fixed. Include snapshot + interaction tests.
- Add an integration smoke test for the main flow: select feed → play episode → create note → ensure note file path/template substitution works.
- Add a11y linting: run `svelte-check --fail-on-warnings` or `eslint-plugin-svelte` a11y rules to prevent regressions.

### CI/CD
- Once npm lock is stable, switch CI back to `npm ci` (or migrate to pnpm to avoid npm’s bundled-npm dependency friction). Cache `~/.npm`/pnpm store.
- Keep Node 22 in workflows and engines; add `node-version-file: '.nvmrc'` in `setup-node`.
- Vercel: either disable for this plugin repo or produce a minimal static artifact (docs). If keeping, ensure `installCommand`/`buildCommand` match the plugin build or keep `ignoreCommand` to skip deploy noise.
- Add Dependabot/Renovate with weekly grouped updates to avoid large jump-upgrades.

### Repo Hygiene
- Add `CONTRIBUTING.md` covering Node 22 requirement, install (`npm install` or `pnpm i`), build/test commands, and release flow.
- Document Obsidian-specific build steps and external APIs (OpenAI usage, iTunes feed fetching) in README or `/docs`.
- Consider `npm audit` (or `pnpm audit`) gating CI, or at least surface results in PR comments.

### Performance/UX
- Audit dependency usage; remove unused code paths. Confirm OpenAI usage is necessary on client; if not, move server-side or gate-load.
- Evaluate CSS and a11y debt: continue converting interactive spans/divs to buttons, add roles/tabindex only where appropriate, and ensure keyboard parity.
- Consider lazy-loading heavy UI sections (podcast artwork, feed parsing) and caching feed results to reduce start-up.
