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
Vitest runs in Node and aliases `obsidian` to `tests/mocks/obsidian.ts`. A test
file that needs a DOM or loads Svelte code starts with
`// @vitest-environment jsdom`; leave it off otherwise, because jsdom setup is
the suite's largest cost. A Node test that loads Svelte code or reads `window`
or `document` fails with that hint. Prefer unit tests for pure utility, parser,
store, API, and component behavior. Use Testing Library for Svelte component
behavior instead of asserting on implementation details.

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
Goal: publish each version from a tested, reviewed, and attested commit. Stop
when the GitHub release is public, its tag points at the release commit, and
`main.js` and `manifest.json` match their recorded SHA-256 digests.

Three workflows in `.github/workflows/` call reusable workflows in
`chhoumann/obsidian-plugin-workflows` pinned to v4
(`ebcf84b80dc48ba15e0eec1f3575d41519a78ed5`):

1. `Prepare release` (`release-prepare.yml`) runs after a green `Test` push run
   on `master`, or by `workflow_dispatch` with an optional `targetSha`. It skips
   if `master` moved past the tested commit. It plans the version with
   semantic-release's commit analyzer from the Conventional Commits since the
   latest tag. `feat` is minor, `fix` and `perf` are patch, and a
   `BREAKING CHANGE:` footer is major. The pinned `release-policy` makes
   `build(deps)` a patch, so production Dependabot bumps release and
   `build(deps-dev)` bumps do not. A `build(deps)` commit stays a patch even
   with a `BREAKING CHANGE:` footer. The analyzer ignores the `!` marker, so the
   PR title check rejects it. The `podnotes-release-bot` GitHub App then opens
   or refreshes one draft PR from `release/<version>` titled
   `release(version): Release <version>`, with the generated notes in its body.
   It changes exactly `package.json`, `package-lock.json`, `manifest.json`, and
   `versions.json`. Release PRs that a newer plan supersedes are closed.
2. `Trigger release` (`release-trigger.yml`) runs on `pull_request_target`
   `closed` for a merged `release/*` PR into `master`. It validates the bot
   author, branch, title, exact version-file diff, merger, squash parent, and
   tree, creates the `release-run/<version>` recovery branch at the release
   commit, and dispatches `release.yml` on it.
3. `Release` (`release.yml`) validates again, recomputes the version, and runs
   `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test`,
   and `npm run docs:build`. It builds, creates the `<version>` tag, attests
   `main.js` and `manifest.json`, uploads them to a draft GitHub release,
   downloads and re-hashes them, publishes, and then deletes the recovery
   branch. Slack and Discord notifications are optional secrets.

The App, not `GITHUB_TOKEN`, opens the release PR, so it gets the normal PR
checks. Review the exact diff, wait for the required checks, mark it ready, and
squash-merge it with the generated title unchanged. Only the repository owner
(`chhoumann`) may merge it, and only directly onto its recorded base. When
`master` moves, the ruleset marks the PR out of date until the bot refreshes it
after the next green `Test` push run. Each refresh puts the PR back in draft
and restarts its checks, so once the owner marks it ready, stop merging other
PRs until it merges.

Never update a release PR's branch yourself, not even with
`gh pr update-branch`. The bot refuses to overwrite a branch head it did not
generate, so release planning fails on every later push. To recover before the
PR merges, close it and delete its `release/<version>` branch. The next green
`Test` push run creates both again.

When a feature requires a newer Obsidian API, raise `manifest.json`
`minAppVersion` in the feature PR and leave existing `versions.json` entries
unchanged. The floor can only go up, and the release PR records it under the
new version.

Setup: install the `podnotes-release-bot` App with the `RELEASE_APP_ID`
variable and the `RELEASE_APP_PRIVATE_KEY` secret. The default `GITHUB_TOKEN`
stays read-only. The pipeline writes only `release/*` and `release-run/*`
branches and tags, never `master`, so the master ruleset needs no bypass actor.
Keep CodeQL default setup enabled: the required `CodeQL` check comes from it, so
turning it off blocks every PR.

`.github/rulesets/protect-master.json` is the source of truth for the "Protect
master" ruleset: no deletion, no force push, PRs only, squash only, PRs up to
date with `master`, and the required checks `Test`, `Docs`, `Validate PR title`,
`Dependency Review`, and `CodeQL`. Bring any PR except a release PR up to date
with `gh pr update-branch <number>`. Each check is pinned to the app that
reports it: GitHub Actions, or GitHub Advanced Security for `CodeQL`, the code
scanning check that CodeQL default setup reports on every PR. Apply or update
the ruleset with:

```bash
gh api -X POST repos/chhoumann/PodNotes/rulesets --input .github/rulesets/protect-master.json
gh api -X PUT repos/chhoumann/PodNotes/rulesets/<id> --input .github/rulesets/protect-master.json
```

To rename a required job, change the JSON in the same PR. For `Test`, `Docs`,
and `Dependency Review`, apply it with `PUT` just before that PR merges. For
`Validate PR title`, apply it right after: `pull_request_target` runs the
workflow from `master`, so the PR still reports the old name. `Prepare release`
also matches the `Test` workflow by its top-level `name:`, so renaming the
workflow stops release planning without failing any check.

Recovery is for the owner. Agents never dispatch release workflows. The release
stage accepts only the refs below, re-derives and re-verifies the release commit
from the PR on each, and re-running a published version verifies it and changes
nothing.

```bash
# Re-validate from the current master head:
gh workflow run release-trigger.yml --ref master -f pr-number=<merged-pr-number>
# Re-run only the release stage. Use the tag once it exists, or master to pick
# up a reviewed workflow fix:
gh workflow run release.yml --ref release-run/<version> -f releasePr=<merged-pr-number>
gh workflow run release.yml --ref <version> -f releasePr=<merged-pr-number>
gh workflow run release.yml --ref master -f releasePr=<merged-pr-number>
```

## PR Expectations
Pull requests should include:
- a Conventional Commits title with a type from
  `.github/workflows/pr-title.yml`, because the squash-merge commit takes the
  PR title and the release planner reads it; record a breaking change with a
  `BREAKING CHANGE:` footer in the squash commit body, not with `!`;
- a concise summary of the user-facing change;
- linked issues when relevant;
- screenshots or short recordings for visible UI changes;
- feed URLs, local file details, or transcript setup for podcast-specific fixes;
- exact commands run and whether Obsidian runtime verification was performed;
- release or migration impact, especially for settings, storage, API, or URI
  behavior.

The sections of `.github/PULL_REQUEST_TEMPLATE.md` follow this list.

Keep changes scoped to the touched behavior. Do not mix unrelated formatting,
dependency churn, docs rewrites, or generated artifact changes into feature and
bug-fix commits.
