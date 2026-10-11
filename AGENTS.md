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
Prove runtime behavior in a real Obsidian whose PodNotes plugin folder links this
checkout's build. Prefer scripted, repeatable checks, and for commands or URIs
test both the user-facing path and the direct command/URI path. The project
verify skill (`.claude/skills/verify/SKILL.md`) shows how to seed a feed and a
local file, drive each feature, and capture evidence.

### Shared dev vault (macOS main checkout)
The canonical `/Users/christian/Developer/PodNotes` checkout uses the shared
`dev` vault at `/Users/christian/Developer/dev_vault/dev`, whose
`.obsidian/plugins/podnotes` symlinks point at that checkout's artifacts:

```bash
npm run dev
obsidian vault=dev plugin:reload id=podnotes
obsidian vault=dev eval code='app.plugins.plugins.podnotes?.manifest?.version'
```

Only one checkout can own those symlinks, so worktrees never touch the `dev`
vault. They use the isolated instance below.

### Isolated worktree instance (macOS and Linux)
`scripts/obsidian-e2e.mjs` wraps the `obsidian-e2e` instance runner, configured
by `obsidian-e2e.config.mjs`. Each worktree gets its own vault
(`.obsidian-e2e-vaults/podnotes-<worktree>`, git-ignored, seeded with
`DEFAULT_SETTINGS` on first provision), private `HOME`, CLI socket, and
Obsidian process. The same commands work on both platforms:

```bash
npm run build                    # the vault links the root main.js
npm run start:e2e-obsidian       # start, or reuse and reload PodNotes
npm run obsidian:e2e -- eval code='Boolean(app.plugins.plugins.podnotes)'   # => true
npm run obsidian:e2e -- dev:errors
npm run build && npm run obsidian:e2e -- --reload eval code='app.plugins.plugins.podnotes.manifest.version'
```

| | macOS | Linux (headless) |
| --- | --- | --- |
| App | `Obsidian.app` via `open` | `/opt/Obsidian/obsidian` under `xvfb-run`, no `DISPLAY` needed |
| Profile | `/private/tmp/podnotes-obsidian-e2e/<vault>-<hash>/` | `/tmp/podnotes-obsidian-e2e/<vault>-<hash>/` |
| Evidence | `npx obsidian-e2e capture launch` (a separate instance) | the capture commands below, against this instance |

- `obsidian:e2e` brings the instance up when needed. A warm instance is used as
  is: since obsidian-e2e 0.11 `run` does not reload the plugin, so pass
  `--reload` after every rebuild or you test the old bundle.
- `npm run start:e2e-obsidian -- --print-env` prints only `export` lines
  (`OBSIDIAN_E2E_VAULT`, `_VAULT_PATH`, `_OBSIDIAN_HOME`, legacy `PODNOTES_E2E_*`
  aliases; on Linux also `XDG_RUNTIME_DIR`). After
  `eval "$(npm run --silent start:e2e-obsidian -- --print-env)"` the raw
  `obsidian vault="$OBSIDIAN_E2E_VAULT" ...` CLI reaches the instance on Linux.
  On macOS also `export HOME="$OBSIDIAN_E2E_OBSIDIAN_HOME"`.

### E2E suite
`npm run test:e2e` is the one command. Vitest arguments pass through
(`npm run test:e2e -- -t "timestamp"`), every test is listed, and a filter that
matches no test fails the run.

- Linux: it builds, starts or reuses this worktree's instance, runs `tests/e2e`
  against it, and stops the instance afterwards only if this run launched it.
- macOS: it runs against whatever the environment selects, the shared `dev`
  vault by default. For the isolated instance, export its env first:
  `eval "$(npm run --silent start:e2e-obsidian -- --print-env)" && npm run test:e2e`.
- An interrupted run can leave test fixtures in the vault's `data.json`. Reset
  the vault with `npm run stop:e2e-obsidian && rm -rf .obsidian-e2e-vaults`.

### Evidence (Linux)
Screenshots and recordings come from the same instance. Write them under the
git-ignored `.obsidian-e2e-artifacts/`, not `/tmp`:

```bash
npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/player.png         # the PodNotes view
npm run record:e2e-obsidian -- .obsidian-e2e-artifacts/player.mp4             # 3 s take of the window
npm run record:e2e-obsidian -- .obsidian-e2e-artifacts/flow.mp4 -- ./drive.sh  # take while a driver runs
npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/modal.png --modal
```

`screenshot` and `record` open the player first and fail without capturing
when it does not open. `capture` forwards to `obsidian-e2e capture` (see its
README), with this instance's CDP port for the verbs that connect. A record
driver that exits non-zero discards the take.

### Stopping (avoid leaks)
Removing a worktree does not stop its instance. Stop it when you are done:

```bash
npm run stop:e2e-obsidian                # this worktree's process tree and profile
npm run stop:e2e-obsidian -- --dry-run   # show what would be stopped
npm run stop:e2e-obsidian -- --prune     # also reap instances whose worktree is gone
```

`stop` matches only this worktree's `--user-data-dir` (it carries a
per-worktree hash), including Xvfb on Linux, and never touches the `dev` vault
or other worktrees. `start:e2e-obsidian` and `obsidian:e2e` also reap orphaned
instances under the default profile root before launching.

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
