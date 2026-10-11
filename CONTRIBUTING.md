# Contributing to PodNotes

Thanks for helping. This guide covers how to build PodNotes, run its checks, test it in Obsidian, and open a pull request. [AGENTS.md](AGENTS.md) has the full details on every tool mentioned here.

## Set up

PodNotes uses Node 22 (see `.nvmrc`) and npm.

```sh
npm install
npm run dev     # rebuilds into build/ on every change
npm run build   # type-checks and writes the production main.js
```

To try your build, link `main.js` and `manifest.json` into a test vault's `.obsidian/plugins/podnotes/` folder and reload the plugin. Never point it at a vault you care about.

## Run the checks

Pull requests must pass these checks. Run them before you push:

```sh
npm run lint
npm run format:check   # npm run format fixes formatting
npm run typecheck
npm run build
npm run test           # Svelte checks and the unit tests
npm run docs:build     # only if you changed docs/
```

Tests sit next to the code as `*.test.ts`. A test file that needs a DOM starts with `// @vitest-environment jsdom`.

## Test in Obsidian

Behavior such as playback, timestamp links, downloads, local files, and settings migrations depends on Obsidian itself. Check it in a real Obsidian before you open a pull request.

`npm run test:e2e` builds PodNotes and runs the end-to-end suite in `tests/e2e` against a real Obsidian. On Linux it starts an isolated Obsidian for this checkout and stops it afterwards. On macOS it uses the `dev` vault unless you point it at the isolated instance. [AGENTS.md](AGENTS.md#obsidian-runtime-workflow) explains both setups, how to drive the app by hand, and how to stop leftover instances.

## Change the docs

The documentation site lives in `docs/` and is built with Astro Starlight. [docs/README.md](docs/README.md) explains its layout, and every page follows [docs/STYLE.md](docs/STYLE.md). The site describes the latest release, so document a behavior change in its own pull request and merge it once a release ships the change.

Screenshots come from `node docs/scripts/screenshots.mjs`, which captures them from a seeded vault. Rerun it after a UI change instead of adding images by hand.

## Open a pull request

- Title the pull request in the Conventional Commits style, such as `fix: keep the queue order after a restart`. The title becomes the commit on `master`, and the release notes are generated from it.
- Fill in the template: what changed for users, how you verified it (commands and Obsidian version), and any settings, storage, API, or URI impact.
- Add a screenshot or a short recording for a visible change.
- Keep the pull request to one change.

Releases are automated from `master`. Contributors do not tag or publish releases.
