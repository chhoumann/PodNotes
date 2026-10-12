# Contributing to PodNotes

Thanks for helping. This guide covers how to build PodNotes, run its checks, test it in Obsidian, and open a pull request. [AGENTS.md](AGENTS.md) has the full details on every tool mentioned here.

## Set up

PodNotes uses npm and the Node version in `.nvmrc` (Node 22). Switch to it first, for example with `nvm use` or `fnm use`. npm refuses to install with another version.

```
npm install
npm run build
```

`npm run build` type-checks PodNotes and writes the production `main.js` to the repository root. While you work, `npm run dev` rebuilds on every change. It keeps running until you stop it with `Ctrl+C`.

## Try your build

PodNotes tests against the Obsidian desktop app: `Obsidian.app` on macOS, and the `.deb` or tarball install at `/opt/Obsidian` on Linux. A Linux machine without a display also needs `xvfb` and `xauth`. The Flatpak and Snap builds do not work.

The test tools drive Obsidian through its command line client, so set that up once. In Obsidian, open **Settings → General**, turn on **Command line interface** under **Advanced**, then select **Set up CLI to work in the terminal**. On Linux, this puts the client in `~/.local/bin`, which must come before `/usr/bin` on your `PATH`.

```
npm run start:e2e-obsidian
```

This starts an isolated Obsidian with its own vault that loads this checkout's build. After a rebuild, run it again to reload PodNotes. `npm run stop:e2e-obsidian` stops it.

To use your own test vault instead, link `main.js` and `manifest.json` from the repository root into the vault's `.obsidian/plugins/podnotes/` folder. After each rebuild, turn PodNotes off and on in **Settings → Community plugins**. Use a vault you do not mind breaking.

## Run the checks

Pull requests must pass these checks. Run them before you push:

```
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run size
npm run test -- --run
npm run docs:build
```

`npm run format` fixes formatting. `npm run size` checks the bundle size budget. `npm run test` runs the Svelte checks and the unit tests, and `--run` stops it from watching for changes. `npm run docs:build` builds the documentation site and checks its links.

Tests sit next to the code as `*.test.ts`. A test file that needs a DOM starts with `// @vitest-environment jsdom`.

## Test in Obsidian

Behavior such as playback, timestamp links, downloads, local files, and settings migrations depends on Obsidian itself. Check it in a real Obsidian before you open a pull request.

The end-to-end suite in `tests/e2e` runs against the isolated Obsidian. On Linux, `npm run test:e2e` starts it, or reuses the one already running. It stops the instance afterwards only if it started it. On macOS, start it first:

```
eval "$(npm run --silent \
  start:e2e-obsidian \
  -- --print-env)"
npm run test:e2e
npm run stop:e2e-obsidian
```

The runner does not support Windows, so check your change by hand there. [AGENTS.md](AGENTS.md#obsidian-runtime-workflow) explains how to drive the app by hand and how to stop leftover instances.

## Change the docs

The documentation site lives in `docs/` and is built with Astro Starlight. [docs/README.md](docs/README.md) explains its layout, and every page follows [docs/STYLE.md](docs/STYLE.md). The site describes the latest release, so put the docs for new behavior in their own pull request. It merges after the release that ships the behavior.

Screenshots come from `node docs/scripts/screenshots.mjs`, which captures them from a seeded vault. Run it after `npm run build`, with network access, whenever the UI changes. Never add images by hand.

## Open a pull request

- Title the pull request in the Conventional Commits style, such as `fix: keep the queue order after a restart`. The type is one of `feat`, `fix`, `perf`, `docs`, `style`, `refactor`, `test`, `build`, `ci`, `chore`, or `revert`. The title becomes the commit on `master`, and the release notes are generated from it.
- Mark a breaking change with a `BREAKING CHANGE:` footer in the squash commit body. The title check rejects `!` in the title.
- Fill in the template: what changed for users, how you verified it (commands, Obsidian version, and platform), and any settings, storage, API, or URI impact. Link the issue it fixes, as in `Fixes #123`.
- Add a screenshot or a short recording for a visible change.
- Keep the pull request to one change.

Releases are automated from `master`. Contributors do not tag or publish releases.
