# PodNotes docs standard

Every page on https://podnotes.obsidian.guide follows this checklist. Review a
page against it before you merge. The sources are listed at the end.

The reader is an Obsidian user who wants to listen to a podcast and keep notes.
They skim, they often read on a phone, and they arrive from search on a page
other than the home page.

## The site

- [ ] The sidebar groups pages by what the reader is doing, in this order:
      **Start here**, **Listen**, **Take notes**, **Your library**, **Automate**,
      **Reference**, **Help**. `src/site.mjs` holds the sidebar.
- [ ] Every answer is at most two clicks from the home page: the home page or the
      sidebar, then the page.
- [ ] Each page has one job, named by its title. A page that does two jobs
      becomes two pages.
- [ ] A procedure lives on one page. Other pages link to it instead of repeating
      it. Two exceptions: **Getting started** walks through the first install,
      podcast, playback, timestamp, and note in one place, and the landing page
      and the FAQ may give a one-line fix that links to the page that owns the
      procedure.
- [ ] URLs never break. Every page pins `slug:`. A moved page gets a 301 in
      `public/_redirects`. A renamed heading keeps its old id with an empty
      `<span id="old-id"></span>` (the build checks `legacy-fragments.json`).
- [ ] Content lives in text, not only in images, so the raw `.md` page and
      `llms.txt` carry all of it.

## The page

- [ ] The title says what the reader does or looks up: "Capture timestamps",
      "Template tags". Sentence case.
- [ ] `description:` frontmatter is one sentence. Search results and link
      previews show it.
- [ ] The first sentence says what the page lets the reader do. No "This page",
      no "In this guide", no history.
- [ ] The common case comes first. Limits and edge cases come last, under a
      heading that names them.
- [ ] Task headings start with a verb ("Add a podcast"). Concept headings are
      noun phrases ("Episode identity"). FAQ entries are the reader's questions.
      No heading starts with an -ing word, and no level is skipped.
- [ ] A how-to page covers one feature. Each task on it fits in about one
      screen at 1440x900, and the page stays under about four screens before any
      reference section. Split a page that grows past that. Lookup tables go at
      the end of the page under a heading that says so, or on a reference page.
- [ ] A procedure is a numbered list with one action per step. Each step names
      the place before the action: "In **Settings → PodNotes**, select
      **Add**."
- [ ] When desktop and mobile differ, the page says so where it matters.

## The sentences

- [ ] Write to "you", in the present tense and the active voice.
- [ ] UI labels are bold and spelled exactly as PodNotes shows them, case
      included: **Search Podcasts**, **Capture timestamp format**.
- [ ] Commands use the palette name: **PodNotes: Capture Timestamp**.
- [ ] Settings paths use an arrow: **Settings → Community plugins**.
- [ ] Use "select" for clicks and taps. Shortcuts look like `Ctrl+P`.
- [ ] Use plain words: "use", not "utilize". No "simply", "just", "easy",
      "powerful", or "seamless". No emoji.
- [ ] No em dash and no semicolons. End the sentence instead.
- [ ] Examples use real values: a real feed, a real time such as `00:12:41`.
- [ ] Link text names the destination. Never "here". Link with site-absolute
      paths such as `/timestamps/#capture-a-range`.

## The facts

- [ ] Describe only the latest published release
      (`gh release list --repo chhoumann/PodNotes`). Behavior that exists only
      on `master` waits for the release.
- [ ] Check every claim against `src/` at the release tag.
- [ ] State a limit plainly and give the workaround if one exists.

## Screenshots

- [ ] A screenshot shows something words cannot. Never screenshot text.
- [ ] `docs/scripts/screenshots.mjs` captures every screenshot from the seed
      vault in `docs/screenshots/`. Never add one by hand. Rerun the script
      after a UI change.
- [ ] Each screenshot has a light file and a `-dark` file. The site shows the
      one that matches the reader's theme.
- [ ] The crop shows the part that matters and enough context to find it.
- [ ] A shot whose text is unreadable at 390 px wide gets a `-phone` crop
      captured in Obsidian's phone layout. The site shows it on narrow screens.
- [ ] Alt text says what the screenshot shows in under 150 characters.

## Clips

- [ ] A clip shows a task of a few steps in 10 to 20 seconds. The steps stay in
      the text.
- [ ] `docs/scripts/videos.mjs` records every clip from the same fixtures.
      Never add one by hand. Rerun the script after a UI change.
- [ ] One sentence before the clip says what it shows, and its alt text names
      it in under 150 characters.
- [ ] Each clip is under about 1.5 MB.

## Before you merge

- [ ] `npm run docs:build` passes. It checks links, legacy fragments, and that
      every page is in the sidebar.
- [ ] You read the page at 390 px and 1440 px wide, in light and dark.

## Sources

- Lee Robinson, [Documentation](https://leerob.com/docs) and
  [On developer experience](https://leerob.com/dx).
- [Diátaxis](https://diataxis.fr/).
- [Google developer documentation style guide](https://developers.google.com/style).
- [Write the Docs: documentation principles](https://www.writethedocs.org/guide/writing/docs-principles/).
- [Obsidian Help style guide](https://obsidian.md/help/style-guide).
- [Nielsen Norman Group: how users read on the web](https://www.nngroup.com/articles/how-users-read-on-the-web/).
