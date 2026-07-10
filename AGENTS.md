# Repository Guidelines

## Project Overview
PodNotes is an Obsidian community plugin for listening to podcasts, tracking
playback progress, creating podcast notes, capturing timestamps, downloading
episodes, using local audio files, and exposing a small API for workflow plugins.

## Project Structure
Source code lives in `src/`. Core plugin registration and lifecycle wiring live
in `src/main.ts`; public API code is under `src/API/`; parsing code is under
`src/parser/`; stores and controllers are under `src/store*`; utility functions
are under `src/utility/`; Svelte UI lives under `src/ui/`; shared types live in
`src/types/`.

Tests are colocated with source files as `*.test.ts` where practical. Shared
test mocks live in `tests/mocks/`. User-facing documentation lives in `docs/`
and is built with MkDocs.

Generated plugin artifacts such as `main.js` and source maps are ignored by git
and should not be hand-edited. Production builds write `main.js` at the repo
root for release packaging; development builds write into `build/` and maintain
root symlinks for local Obsidian loading.

## Tooling
- Use Node 22. The repo has `.nvmrc`, `.npmrc`, and `package.json` engines for
  this.
- Use npm for package management and scripts. Do not introduce another package
  manager unless the migration is intentional and removes the old lockfile.
- Use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) so the
  automated release planner can determine versions and generate release notes.
- If work resolves a GitHub issue, prefer an issue-linked branch workflow before
  implementation.

## Common Commands
- `npm install`: install dependencies for local development.
- `npm run dev`: watch-mode development build via Vite.
- `npm run typecheck`: run `tsc --noEmit`.
- `npm run lint`: run oxlint against TypeScript sources (includes the obsidianmd guideline rules via jsPlugins).
- `npm run format:check`: run the configured oxfmt check (`npm run format` to write).
- `npm run check:a11y`: run `svelte-check --fail-on-warnings`.
- `npm run test`: run Svelte checks and the Vitest suite.
- `npm run build`: type-check and produce the production plugin bundle.
- `npm run docs:build`: build the MkDocs documentation.
- `npm run docs:deploy`: build docs and deploy `docs/site` to Cloudflare Pages.

Before opening a PR or cutting a release, run the CI-equivalent checks locally:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run test
npm run docs:build
```

## Testing
Vitest runs in jsdom and aliases `obsidian` to `tests/mocks/obsidian.ts`.
Prefer unit tests for pure utility, parser, store, API, and component behavior.
Use Testing Library for Svelte component behavior instead of asserting on
implementation details.

When a bug depends on real Obsidian runtime behavior, reproduce it in Obsidian
before changing code and verify it there after the fix. Timestamp links, URI
handling, playback restore, downloaded/local media, file writes, settings
migrations, and workspace/view behavior are runtime-sensitive and should not be
trusted to jsdom alone.

For runtime verification, record the exact Obsidian version, platform, vault
setup, feed or local file used, command or URI invoked, console/runtime errors,
and observed plugin state before and after the action.

## Obsidian Runtime Workflow
Use a dedicated development vault for manual or scripted Obsidian checks. Ensure
the vault's PodNotes plugin folder points at this checkout's generated plugin
artifacts before trusting runtime evidence.

If using the `obsidian` CLI, pass the vault selector consistently and prefer
scripted, repeatable checks for non-trivial flows. For bugs involving commands
or URIs, test both the user-facing path and the direct command/URI path when
possible.

### Shared dev vault (main checkout)
For work in the canonical `/Users/christian/Developer/PodNotes` checkout, use the
shared `dev` vault and target it explicitly with the `obsidian` CLI:

```bash
npm run dev
# reload or re-enable PodNotes in the dev vault, e.g.:
obsidian vault=dev plugin:reload id=podnotes
# trigger the relevant command, UI flow, or obsidian://podnotes URI
obsidian vault=dev eval code='app.plugins.plugins.podnotes?.manifest?.version'
# inspect console/errors and plugin state
```

- Dev vault root: `/Users/christian/Developer/dev_vault/dev`.
- PodNotes plugin folder in the vault:
  `/Users/christian/Developer/dev_vault/dev/.obsidian/plugins/podnotes`, whose
  `main.js`/`manifest.json` symlinks point at the canonical checkout's artifacts.
- Only one checkout can own those symlinks at a time, so the shared `dev` vault
  is for the main checkout. Worktrees must use the isolated wrapper below.

### Isolated worktree vault (parallel worktrees)
In a worktree (e.g. `/Users/christian/orca/workspaces/PodNotes/<slug>`), do **not**
race the shared `dev` vault — multiple worktree agents would clobber each other on
the plugin symlink, `data.json`, and `plugin:reload`. Use the isolated worktree
wrapper instead, which provisions a worktree-local vault under
`.obsidian-e2e-vaults/podnotes-<worktree>` (git-ignored), starts or reuses a
private-`HOME` Obsidian instance bound to that vault, disables Restricted Mode,
waits until PodNotes is live, and then runs your command with the right
`vault=<worktree vault>` and private `HOME` already applied:

```bash
npm run build                              # produce root main.js + manifest.json first
npm run obsidian:e2e -- eval code=app.vault.getName()
npm run obsidian:e2e -- eval code='Boolean(app.plugins.plugins.podnotes)'
npm run obsidian:e2e -- dev:errors
```

- The four `provision:e2e-vault` / `start:e2e-obsidian` / `stop:e2e-obsidian` /
  `obsidian:e2e` scripts run on the shared `obsidian-e2e` instance-runner bin,
  configured by `obsidian-e2e.config.mjs` at the repo root (plugin id, the two
  symlinked artifacts, the `data.json` seed, and the PodNotes ready probe).
- The wrapper links the worktree's own `main.js`/`manifest.json` (PodNotes injects
  its CSS into the bundle, so there is no `styles.css` to link) and seeds a clean
  `DEFAULT_SETTINGS`-shaped `data.json` on first provision; it never touches
  `/Users/christian/Developer/dev_vault/dev`.
- `npm run provision:e2e-vault` and `npm run start:e2e-obsidian` expose the
  provision/launch steps individually; both accept `--help`.
- Use `npm run start:e2e-obsidian -- --print-env` only when you need to export
  the vault env for a separate process. `--print-env` emits export-only lines on
  stdout (so `eval "$(...)"` is safe): the canonical `OBSIDIAN_E2E_VAULT` /
  `OBSIDIAN_E2E_VAULT_PATH` / `OBSIDIAN_E2E_OBSIDIAN_HOME` names and, during the
  migration, legacy `PODNOTES_E2E_*` aliases; `tests/e2e/harness.ts` reads the
  canonical name first, then the alias. The `obsidian` CLI routes by `$HOME` (it
  talks to `$HOME/.obsidian-cli.sock`), so to point the Vitest `tests/e2e` suite
  at the isolated instance you must remap `HOME` as well as the vault name —
  exporting the vault alone leaves the suite talking to the shared `dev` vault:

  ```bash
  npm run build                                     # required: provisioning links main.js
  eval "$(npm run --silent start:e2e-obsidian -- --print-env)"
  export HOME="$OBSIDIAN_E2E_OBSIDIAN_HOME"         # required: re-point the CLI socket
  OBSIDIAN_E2E_VAULT="$OBSIDIAN_E2E_VAULT" npm run test:e2e
  ```

  Build first so the instance loads the current bundle (provisioning also needs
  `main.js` to exist). `start:e2e-obsidian` reloads PodNotes when it reuses a
  running instance, so the exported instance is never stale.

### Stopping an isolated instance (avoid leaks)

Each started instance is a real Obsidian process tree plus a private profile
directory under `/private/tmp/podnotes-obsidian-e2e/<vault>-<hash>/`. Removing a
worktree does **not** stop it, so a finished worktree would leak an Obsidian
process tree and a `/private/tmp` directory. Stop it explicitly:

```bash
npm run stop:e2e-obsidian            # stop THIS worktree's instance + remove its tmp dir
npm run stop:e2e-obsidian -- --dry-run   # show what would be stopped/removed
npm run stop:e2e-obsidian -- --prune     # also reap orphaned instances (worktree gone)
```

The teardown identifies only this worktree's instance by its private
`--user-data-dir` token (which contains a per-worktree hash), terminates that
process tree (SIGTERM, then SIGKILL for stragglers), and removes its profile
directory. It never touches the shared `dev` vault, other worktrees, or quickadd
instances.

Two layers keep instances from leaking, so you rarely need to run `stop` by hand:

- **Orca archive hook** — `orca.yaml` defines a `scripts.archive` hook that runs
  this teardown for the worktree being removed. Remove worktrees with
  `orca worktree rm --worktree <selector> --run-hooks` so the hook fires (Orca
  skips archive hooks without `--run-hooks`).
- **Reap on next start** — `start:e2e-obsidian` and `obsidian:e2e` reap any
  orphaned instance (one whose backing worktree no longer exists on disk, i.e.
  it was removed) before launching, even if its Obsidian is still running. An
  idle instance for a worktree that still exists is left alone so concurrent
  workers can reuse it. Reaping scans the default profile root
  (`/tmp/podnotes-obsidian-e2e`); instances started under a custom
  `--profile-root` are only reaped by a start that uses that same root, so stop
  those explicitly.

## Documentation
Docs live in `docs/docs/` and are configured by `docs/mkdocs.yml`. Update docs
with user-facing behavior changes, new commands, API changes, template syntax,
transcript behavior, local-file behavior, or import/export changes.

Use `npm run docs:build` to validate docs locally. The Cloudflare Pages output
directory is `docs/site`, configured in `wrangler.jsonc`.

## Release Workflow
Goal: publish each version from a tested, reviewable, and cryptographically
attested commit.

Success means:
- the release PR changes exactly `package.json`, `package-lock.json`,
  `manifest.json`, and `versions.json`;
- the release commit passes the full lint, format, type, build, test, and docs
  gates;
- `main.js` and `manifest.json` receive build-provenance attestations and match
  the assets downloaded back from the draft GitHub release.

Stop when: the GitHub release is public, its tag targets the validated release
commit, and both remote assets match their recorded SHA-256 digests.

After a successful `Test` run on `master`, the no-checkout
`Trigger release preparation` workflow dispatches `Prepare release` at the
exact tested commit. `Prepare release` uses `npm run release:plan` to calculate
the next Conventional Commits version and opens a machine-generated draft PR
containing the four synchronized version files. Review that exact diff, wait
for its explicitly dispatched `Test` run, mark the PR ready, and squash-merge
it with the generated title unchanged.

When a feature requires a newer Obsidian API, change `manifest.json`
`minAppVersion` in the feature PR and leave every existing `versions.json`
entry unchanged. Those entries describe already-published releases. The
release planner verifies that released history still matches the latest tag,
then the generated release PR records the new compatibility floor only under
the new version.

Keep the repository's default `GITHUB_TOKEN` permission read-only. Enable the
repository setting that lets GitHub Actions create and approve pull requests so
the narrowly scoped `Open release PR` job can create the machine-generated PR;
the publisher separately requires the repository owner to perform the merge.

The no-checkout `Trigger release` workflow validates the merged PR, creates an
exact `release-run/<version>` recovery branch, and dispatches `Release` from
that ref. `Release` revalidates the PR provenance and field-level diff before
installing dependencies. It recomputes the exact version, runs every build
gate, creates the durable release tag, attests `main.js` and `manifest.json`,
uploads both to a draft GitHub release, downloads and hashes the remote assets,
and publishes the release as the final step. Successful publication removes
the recovery branch. Recover an interrupted run from its exact remaining ref:

```bash
gh workflow run release.yml --ref release-run/<version> -f releasePr=<merged-pr-number>
# After the durable tag exists:
gh workflow run release.yml --ref <version> -f releasePr=<merged-pr-number>
# If the release workflow itself needed a reviewed fix on master:
gh workflow run release.yml --ref master -f releasePr=<merged-pr-number>
```

The `master` recovery path still rebuilds and publishes the exact merge commit
validated from the machine-generated release PR. It exists only so a reviewed
workflow fix can recover an already-tagged release without moving the durable
tag or rewriting the release commit.

## PR Expectations
Pull requests should include:
- a concise summary of the user-facing change;
- linked issues when relevant;
- screenshots or short recordings for visible UI changes;
- feed URLs, local file details, or transcript setup for podcast-specific fixes;
- exact commands run and whether Obsidian runtime verification was performed;
- release or migration impact, especially for settings, storage, API, or URI
  behavior.

Keep changes scoped to the touched behavior. Do not mix unrelated formatting,
dependency churn, docs rewrites, or generated artifact changes into feature and
bug-fix commits.
