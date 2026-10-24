# PodNotes docs

The docs site (https://podnotes.obsidian.guide), built with
[Astro Starlight](https://starlight.astro.build/). This directory is a
standalone npm package with its own `package-lock.json`, separate from the
plugin's dependencies.

## Layout

- `STYLE.md` is the standard every page follows. Read it before you write.
- `src/content/docs/` holds the pages as markdown. Each page sets `slug:`
  frontmatter to its URL path. For example, `slug: commands` serves
  `/commands/`, and `slug: index` serves `/`. The build fails if a page has no
  `slug:`, because Astro would otherwise lowercase the generated slug and
  change URLs such as `/QuickAdd/`. If you change a slug, add a 301 in
  `public/_redirects`.
- `index.md` is the landing page. It uses Starlight's splash template, and
  `src/components/Hero.astro` renders its hero with the hero screenshot.
- `astro.config.mjs` holds the Starlight config. The sidebar lives in
  `src/site.mjs`, which the LLM files below also read. `src/styles/custom.css`
  holds the theme.
- `src/components/MarkdownContent.astro` post-processes every page:
  `src/screenshots.mjs` gives each screenshot its size, its dark twin, and its
  phone crop, and `src/tables.mjs` labels table cells so wide tables stack on
  phones.
- `scripts/legacy-fragments.mjs` runs after every build and fails it if a
  heading fragment the site has published (`legacy-fragments.json`) has no
  target. When a heading's new id differs from the old one, start the heading
  with an empty `<span id="old-id"></span>`, as `commands.md` does. For an old
  page-title id, set `legacyTitleId:` in the frontmatter instead.
- `public/` holds static assets served as-is. Older images live in
  `public/resources/` and stay for existing links.

## Screenshots and clips

Every screenshot in `public/screenshots/` and every clip in `public/videos/`
comes from a script that drives this worktree's isolated Obsidian (see
AGENTS.md) with the verify skill's screens tooling and its fixture podcasts.
From the repo root:

```sh
npm run build && npm run start:e2e-obsidian
node docs/scripts/screenshots.mjs
node docs/scripts/videos.mjs
```

`screenshots.mjs` copies the notes in `screenshots/vault/` into the vault,
creates episode notes and captures timestamps with PodNotes' own commands, as
`screenshots/seed.json` plans them, and writes each shot at 2x as
`<name>.webp` and `<name>-dark.webp`. Where the desktop shot is unreadable on a
phone, it adds a `<name>-phone.webp` crop. It also writes the README demo GIFs
and the social preview `og.png`.

`videos.mjs` records each clip with real mouse or touch input at 2x, and writes
`<name>.mp4`, a `<name>.webp` poster, and `-dark` twins for pages whose
screenshots have them. Pass clip names to record only those, such as
`node docs/scripts/videos.mjs transcript`.

To show a screenshot on a page, write
`![What it shows](/screenshots/<name>.webp)`. The site adds the size, lazy
loading, the dark twin, and the phone crop if there is one. To show a clip,
write `![What it shows](/videos/<name>.mp4)` after a sentence that says what
the clip shows. The site plays it muted on a loop, or shows its poster with
controls to readers who prefer reduced motion.

## Brand

The PodNotes mark is `public/brand/podnotes-mark.svg`, drawn on a 16 px grid so
the smallest favicon stays sharp. The header logo uses it directly. The
favicons and the Apple touch icon are built from it. After you change the mark,
run from the repo root:

```sh
node docs/scripts/brand.mjs
```

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

Cloudflare Pages builds through its GitHub integration with `docs/` as the root
directory. It installs this package's dependencies, runs the dashboard build
command (which ends in `npm run docs:build`, an alias of `npm run build` here),
and publishes `dist`, set by `pages_build_output_dir` in `wrangler.jsonc`.
The `Docs` check in the Documentation GitHub workflow builds the docs
on every pull request and push to master.
