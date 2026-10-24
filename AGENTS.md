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
and is built with Astro Starlight.

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
- `npm ci`: install the locked dependencies for local development.
- `npm run dev`: watch-mode development build via Vite.
- `npm run typecheck`: run TypeScript 7's native `tsc --noEmit` for source and test projects.
- `npm run lint`: run oxlint against TypeScript sources and tooling scripts (includes the obsidianmd guideline rules and the `svelte-policy` internals guard via jsPlugins), then the `svelte-policy` component checker, configured by `svelte-policy.json`.
- `npm run format:check`: run the configured oxfmt check (`npm run format` to write).
- `npm run check:a11y`: run `lint:tsconfig`, then run `svelte-check --tsgo-experimental-api --fail-on-warnings` for source and test projects.
- `npm run lint:tsconfig`: fail with TS18003 when `tsconfig.json` or `tsconfig.test.json` matches no files, using the native compiler without type checking.
- `npm run test`: run Svelte checks and the application Vitest suite.
- `npm run test:unit`: run `typecheck`, then the application Vitest suite, without the Svelte checks. Bare `vitest` does not type-check.
- `npm run test:tooling`: run the real-process Svelte checker failure tests and the build's syntax floor test, including rejection of tagged templates that disable Obsidian's eval cache. CI runs these separately on every PR.
- `npm run build`: type-check and produce the production plugin bundle.
- `npm run plant -- <test name> <file> <search> <replace> [<file> <search> <replace>...] [-- <command...>]`: plant a defect and pass only when the exactly named test fails on it and the command passes again once restored. Each search must match exactly once, and the plant must type-check. The files are restored on exit or interrupt. The command defaults to the unit suite filtered to the test name.
- `npm run docs:build`: build the Starlight documentation and check its internal links.

`@typescript/native` aliases TypeScript 7. `typecheck` and `lint:tsconfig` call
its compiler by path because npm can link the shared `tsc` command to either
compiler after an incremental install. svelte-check type-checks through that
compiler's API (`--tsgo-experimental-api`), but it still loads the `typescript`
package, as do the TypeScript ESLint packages loaded by oxlint's Obsidian rules.
Keep `typescript` on version 6.

svelte-check's native API path passes when a tsconfig matches no files, which
`lint:tsconfig` catches. `tests/tooling/svelteCheck.test.ts` runs the real
`check:a11y` in temporary workspaces and requires it to fail on that case and
when the native compiler cannot start.

After `npm run build`, `npm run size` enforces 330,000 raw bytes and 103,000 gzip bytes at level 9 for root `main.js` in the Test workflow's Build and sizes worker. `npm run size:data` reports a synthetic v2 stress library with 50 feeds, 2,000 history entries, and 200 saved episodes from frozen NPR metadata, including duplicated snapshots. Its 1.5 MB document goal is advisory. Pass an additive candidate JSON path to report optional-field overhead without changing existing data. In the isolated Obsidian instance, `npm run count:writes -- start`, `report`, and `stop` record writes to PodNotes' exact `data.json` path. Stop the recorder before stopping the instance, because recorder commands start a stopped instance; plugin reloads invalidate its counts.

Before opening a PR or cutting a release, run the CI-equivalent checks locally:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run test
npm run test:tooling
npm run docs:build
```

The `Platforms` workflow runs `npm run test:unit` and `npm run test:tooling` on
macOS and Windows for every PR and `master` push. It is not a required check.

## Testing
Vitest runs in Node and aliases `obsidian` to `tests/mocks/obsidian.ts`. A test
file that needs a DOM or loads Svelte code starts with
`// @vitest-environment jsdom`; leave it off otherwise, because jsdom setup is
the suite's largest cost. A Node test that loads Svelte code or reads `window`
or `document` fails with that hint. Prefer unit tests for pure utility, parser,
store, API, and component behavior. Use Testing Library for Svelte component
behavior instead of asserting on implementation details.

A new or strengthened test counts only once it fails on a planted defect: the
revert of the fix, and each plausible wrong fix (the right check through the
wrong API, the right handler on the wrong scope). Prove each with
`npm run plant`, make the plant reproduce the old code exactly, imports and
timing included, and list the plants and the tests that caught them in the PR
body.

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
Obsidian process. `start`, `run`, `test:e2e`, and a test that restarts Obsidian
all launch it through `scripts/e2e-instance.mjs`, which adds
`--host-resolver-rules=MAP podnotes.test 127.0.0.1,MAP priv3.supercast.com 127.0.0.1`.
The fixture feeds live at `http://podnotes.test:<port>`, and the Supercast-shaped
private feed at `http://priv3.supercast.com:<port>`, so they need no DNS. The
same commands work on both platforms:

```bash
npm run build                    # the vault links the root main.js
npm run start:e2e-obsidian       # start, or reuse and reload PodNotes
npm run obsidian:e2e -- eval code='Boolean(app.plugins.plugins.podnotes)'   # => true
npm run obsidian:e2e -- dev:errors
npm run build && npm run obsidian:e2e -- --reload eval code='app.plugins.plugins.podnotes.manifest.version'
```

| | macOS | Linux (headless) |
| --- | --- | --- |
| App | `Obsidian.app` via `open` | `~/.local/share/obsidian-versions/obsidian-1.14.4/obsidian`, under `xvfb-run` when `DISPLAY` is unset |
| CLI | `obsidian` on `PATH` | `obsidian-cli` next to the app |
| Profile | `/private/tmp/podnotes-obsidian-e2e/<vault>-<hash>/` | `~/.cache/podnotes-e2e/<vault>-<hash>/` |
| Evidence | `npx obsidian-e2e capture launch` (a separate instance) | the capture commands below, against this instance |

- `obsidian:e2e` brings the instance up when needed. A warm instance is used as
  is: `run` does not reload the plugin, so pass `--reload` after every rebuild
  or you test the old bundle.
- `npm run start:e2e-obsidian -- --print-env` prints only `export` lines
  (`OBSIDIAN_E2E_VAULT`, `_VAULT_PATH`, `_OBSIDIAN_HOME`, legacy `PODNOTES_E2E_*`
  aliases). On macOS, after
  `eval "$(npm run --silent start:e2e-obsidian -- --print-env)"` and
  `export HOME="$OBSIDIAN_E2E_OBSIDIAN_HOME"`, the raw
  `obsidian vault="$OBSIDIAN_E2E_VAULT" ...` CLI reaches the instance. On Linux
  it does not, so use `npm run obsidian:e2e -- <command>`.
- The CLI socket sits in the profile, and Linux limits its path to 107 bytes.
  `start` fails before it launches anything when the path
  does not fit.

### Obsidian versions (Linux)
The isolated instance runs Obsidian 1.14.4 by default. `manifest.json`
`minAppVersion` is 1.13.0, so the suite must also pass on 1.13.x, which the
`.deb` installs at `/opt/Obsidian`. Never run an Obsidian executable yourself,
not even with `--version`: it opens the host's real profile. Launch it only
through the npm scripts, with `PODNOTES_OBSIDIAN_APP` below to pick a build.
Install 1.14.4 once, without root, from the official release asset, and check
its SHA-256:

```bash
dir="$HOME/.local/share/obsidian-versions"
mkdir -p "$dir"
curl -fL -o "$dir/obsidian-1.14.4.tar.gz" \
  https://github.com/obsidianmd/obsidian-releases/releases/download/v1.14.4/obsidian-1.14.4.tar.gz
echo "e70b7cd63787e7f798a84fec453f5c446b91877bd3f612e8fb98e9b76cc81120  $dir/obsidian-1.14.4.tar.gz" | sha256sum -c -
tar -xzf "$dir/obsidian-1.14.4.tar.gz" -C "$dir" && rm "$dir/obsidian-1.14.4.tar.gz"
```

The archive unpacks to `obsidian-1.14.4/`, with `obsidian` and `obsidian-cli`
side by side. Two variables select another build:

- `PODNOTES_OBSIDIAN_APP` is the Obsidian executable.
- `PODNOTES_OBSIDIAN_BIN` is the CLI client. It defaults to the `obsidian-cli`
  next to `PODNOTES_OBSIDIAN_APP`, so set it only when the client lives
  elsewhere.

Run the suite on 1.13.x with:

```bash
PODNOTES_OBSIDIAN_APP=/opt/Obsidian/obsidian npm run test:e2e
```

For other commands, stop this worktree's instance before you switch builds.
The runner refuses to reuse an instance that a different build launched, and
its error calls that a mid-session update. Every command against a 1.13.x
instance needs the same variable.

### E2E suite
`npm run test:e2e` is the one command. Vitest arguments pass through
(`npm run test:e2e -- -t "timestamp"`), every test is listed, and a filter that
matches no test fails the run.

- On both platforms it builds, stops this worktree's isolated instance,
  provisions a fresh vault, starts the instance, runs `tests/e2e` against it,
  and stops it afterwards. State left by manual work or an interrupted run
  never reaches the suite. It never uses the shared `dev` vault. A second run
  in the same worktree fails at once instead of replacing the first's bundle
  or vault.
- The suite fails when Obsidian has more than one window open, because a second
  vault window keeps Obsidian from quitting.
- The harness snapshots the workspace, app settings in `app.json`, the core
  plugins with `core-plugins.json`, and PodNotes' `data.json` before each test,
  and restores them after it. A test can turn on a core plugin, such as the file
  explorer, and leave its restore to the harness.
- A temporary plugin, loaded before PodNotes, writes every uncaught renderer
  error to a journal that survives reloads and restarts. The harness fails the
  test that raised the error, or the next test, or the suite when its final
  cleanup raised it. The next run removes a recorder that an interrupted run
  left behind.
- A collapsed or narrow left sidebar opens at 280 px for the run. The suite
  restores the original layout after its last test.
- Settings must open in the main window. A test fails at once, naming the
  `settingsPopoutWindow` config, when Obsidian would open it in a popout.
  The harness reapplies the runner's required app settings on every restart.
- Each test gets its own `sandbox` folder inside its file's sandbox.
- Build code for Obsidian to evaluate with `jsLiteral` from
  `tests/e2e/runtime.ts`, never with `JSON.stringify` alone.
- `harness-lifecycle.test.ts` runs the suites in `tests/e2e/harness-fixtures`
  in their own Vitest processes and checks how each run ends.

### Evidence (Linux)
Screenshots and recordings come from the same instance. Write them under the
git-ignored `.obsidian-e2e-artifacts/`, not `/tmp`:

```bash
npm run screenshot:e2e-obsidian -- .obsidian-e2e-artifacts/player.png         # the PodNotes view
npm run record:e2e-obsidian -- .obsidian-e2e-artifacts/player.mp4             # 3 s take of the window
npm run record:e2e-obsidian -- .obsidian-e2e-artifacts/flow.mp4 -- ./drive.sh  # take while a driver runs
npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/modal.png --modal
```

`screenshot` and `record` reveal the PodNotes view first and fail without
capturing when it does not open. `capture` forwards to `obsidian-e2e capture` (see its
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
or other worktrees. Starting an instance never reaps other instances, so one
worktree's launch never stops a process another session started. Only an
explicit `stop --prune` reaps instances whose worktree is gone.

### Obsidian mobile (Android emulator)

`scripts/omd.sh` drives the real Obsidian Android app through
[obsidian-mobile-debug](https://github.com/chhoumann/obsidian-mobile-debug) at a
pinned commit. It is Linux-only (KVM, a systemd user unit) and needs `uv` and `jq`.

```bash
npm run mobile:setup                # first run downloads about 8 GB (up to 35 min)
npm run --silent mobile:verify      # build, deploy, smoke probe; JSON on stdout, exit 0/2/1
npm run mobile:eval -- 'app.plugins.plugins.podnotes.manifest.version'
npm run mobile:screenshot -- .obsidian-e2e-artifacts/mobile/player.png
npm run mobile:logs -- --seconds 20
npm run --silent mobile:download    # downloads the playing episode, reports native memory
npm run mobile:stop
```

The host runs one emulator. The worktree that boots it owns it until its own
`mobile:stop`, and every other worktree's mobile commands refuse until then, so
always stop when done. Stop keeps the AVD and every device vault. Each worktree
has its own device vault, seeded from `obsidian-e2e.config.mjs` `defaultData`
only on first provision. Run long setup/download commands in an asynchronous
terminal session and allow their documented timeout.

## Documentation
Docs are an Astro Starlight site in `docs/`, a standalone npm package with its
own `package-lock.json`. Pages live in `docs/src/content/docs/` and the sidebar
in `docs/src/site.mjs`. Every page sets `slug:` frontmatter to pin its URL, and
the build fails without it. Update docs with user-facing behavior changes, new
commands, API changes, template syntax, transcript behavior, local-file
behavior, or import/export changes.

Every page follows the standard in `docs/STYLE.md`: pages grouped by what the
reader is doing, one job per page, UI labels spelled as PodNotes shows them,
and facts that describe the latest published release, not unreleased `master`.
Screenshots come only from `node docs/scripts/screenshots.mjs`, which captures
them in light and dark from the seeded vault in `docs/screenshots/`. Rerun it
after a UI change instead of adding images by hand.

Use `npm run docs:build` to validate docs locally. It installs the docs
dependencies and runs `astro build`, which fails on a broken internal link or
anchor, a page missing from the sidebar, or a published heading id that no
longer resolves. Cloudflare Pages builds from `docs/` and publishes `docs/dist`,
configured in `docs/wrangler.jsonc`. See `docs/README.md` for the docs project
layout.

## Release Workflow
Goal: publish each version from a tested, reviewed, and attested commit. Stop
when the GitHub release is public, its tag points at the release commit, and
`main.js` and `manifest.json` match their recorded SHA-256 digests.

Three workflows in `.github/workflows/` call reusable workflows in
`chhoumann/obsidian-plugin-workflows` pinned to v5.0.0
(`d6b3b8c2cf460059238043b32a08dcaa3be4828f`):

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
   Dispatch it with `dryRun` set to `true` to plan without opening or
   refreshing the release PR.
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

Setup: install the `podnotes-release-bot` App with the `RELEASE_APP_CLIENT_ID`
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

The `Test`, `Documentation`, `PR Title`, `Dependency Review`, and `Platforms`
workflows have no `concurrency` block. Do not add one: a group cancels a
pending run when a newer run joins it, even with `cancel-in-progress: false`,
and a cancelled run on a PR head turns its check rollup to `FAILURE`. Duplicate
runs on one head, such as after a reopen, must all finish.

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
