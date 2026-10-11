# PodNotes docs

The docs site (https://podnotes.obsidian.guide), built with
[Astro Starlight](https://starlight.astro.build/). This directory is a
standalone npm package with its own `package-lock.json`, separate from the
plugin's dependencies.

## Layout

- `src/content/docs/` holds the pages as markdown. Each page sets `slug:`
  frontmatter to its URL path. For example, `slug: commands` serves
  `/commands/`, and `slug: index` serves `/`. The build fails if a page has no
  `slug:`, because Astro would otherwise lowercase the generated slug and
  change URLs such as `/QuickAdd/`. If you change a slug, add a 301 in
  `public/_redirects`.
- `astro.config.mjs` holds the Starlight config. The sidebar lives in
  `src/site.mjs`, which the LLM files below also read.
- `scripts/legacy-fragments.mjs` runs after every build and fails it if a
  heading fragment from the old MkDocs site (`legacy-fragments.json`) has no
  target. When a heading's new id differs from the old one, add an empty
  `<div id="old-id"></div>` before the heading, as `commands.md` does.
- `public/` holds static assets served as-is. Images live in
  `public/resources/` and are referenced with site-absolute paths such as
  `/resources/podcast_grid.png`. The repo-root `README.md` uses the same
  images.

## Commands

```sh
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run preview  # serve the production build
```

From the repo root, `npm run docs:build` runs `npm ci` and the build.

## Link checking

`starlight-links-validator` runs during `npm run build` and fails the build on
a broken internal link or heading anchor. Link to other pages with
site-absolute paths such as `/timestamps/#capturing-segments`, not relative
`.md` paths.

## LLM and agent files

The build also writes these files:

- `/llms.txt`, an index of every page in sidebar order, and `/llms-full.txt`,
  every page in one file. `src/pages/llms.txt.ts` and
  `src/pages/llms-full.txt.ts` generate them.
- `<page-url>.md`, the raw markdown of every page, such as `/commands.md`. The
  home page is `/index.md`.

## Deployment

Cloudflare Pages builds this repo through its GitHub integration and publishes
`docs/dist`, set by `pages_build_output_dir` in the repo-root `wrangler.jsonc`.
`npm run docs:deploy` from the repo root builds and deploys with Wrangler
instead. The `Docs` check in the Documentation GitHub workflow builds the docs
on every pull request and push to master.
