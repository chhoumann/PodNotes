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

## Screenshots

Every screenshot in `public/screenshots/` comes from one script. From the repo
root, after `npm run build`:

```sh
node docs/scripts/screenshots.mjs
```

It builds a vault from `screenshots/` (the notes, a Bases file, the PodNotes
settings in `seed.json`, and the Minimal theme), opens it in a private Obsidian
capture instance at 2x, adds the podcast feeds through Settings, plays the
episodes, creates notes and captures timestamps with PodNotes' own commands, and
writes each shot as `<name>.webp` and `<name>-dark.webp`, with a
`<name>-phone.webp` crop where the desktop shot is unreadable on a phone, plus
the README demo
GIFs and the social preview `og.png`. It needs network access for the feeds,
their artwork, and the theme. The episodes in `seed.json` must still be among
each feed's latest episodes. If one has left, pick a newer one and update its
notes in `screenshots/notes/`.

To show a screenshot on a page, write
`![What it shows](/screenshots/<name>.webp)`. The site adds the size, lazy
loading, the dark twin, and the phone crop if there is one.

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
`npm run docs:deploy` from the repo root builds and deploys with Wrangler
instead. The `Docs` check in the Documentation GitHub workflow builds the docs
on every pull request and push to master.
