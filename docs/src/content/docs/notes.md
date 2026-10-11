---
title: Create episode notes
slug: notes
description: Create a note for an episode or a whole podcast, choose where notes go and what they hold, and browse them with Bases.
---

Create a note for the episode you are listening to, with the episode's details and a link that resumes playback, and keep your timestamps in it.

![An episode note with properties, artwork, a Resume in PodNotes link, a collapsed episode description, and three timestamp notes](/screenshots/episode-note.webp)

## Create a note for the current episode

1. Play an episode in PodNotes. You can pause it.
2. Run **PodNotes: Create episode note** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

PodNotes creates the note and opens it. With the default settings, the note for the Acquired episode "The Home Depot" is `PodNotes/Acquired/The Home Depot.md`. To add timestamps while you listen, see [Capture timestamps](/timestamps/).

The command appears only while an episode is loaded. To create a note for an episode you are not playing, right-click it in an episode list, or select its ⋮ button, then select **Create Note**. The [episode menu reference](/podcasts/#context-menu) lists the other items.

## Open an existing note

Run **PodNotes: Create episode note** again. When the note exists, PodNotes opens it and does not create another one. In the episode menu, the item reads **Open Note** once the note exists.

## Create a feed note for a podcast

A feed note describes a whole podcast, with its artwork, author, description, website, and feed URL.

1. Run **PodNotes: Create podcast feed note** from the command palette.
2. Select the podcast. If an episode is loaded, its podcast is first in the list.

PodNotes creates the note and opens it, or opens the note if it exists. With the default settings, the feed note for Acquired is `PodNotes/Podcasts/Acquired.md`. The command needs at least one saved podcast but no loaded episode. You can also select **Create feed note** in the episode menu.

The default episode note template sets its `podcast` property to `{{podcastlink}}`. That tag becomes a link to the feed note, such as `[[PodNotes/Podcasts/Acquired|Acquired]]`. The link works whether you create the feed note before or after the episode note.

## Change where notes go

1. Open **Settings → PodNotes**.
2. Under **Episode notes**, edit **Note creation file path**.

The default is `PodNotes/{{podcast}}/{{title}}.md`. For a folder per publication year, use `Podcasts/{{date:YYYY}}/{{podcast}} - {{title}}.md`. After you edit the path, a preview shows the result for one of your episodes. [File path tags](/templates/#file-path) lists every tag a path accepts.

Feed notes use **Feed note file path** under **Feed notes**.

## Change what notes contain

**Note creation template** under **Episode notes** sets the content of each new episode note. It is Markdown with `{{tag}}` placeholders that PodNotes fills in when it creates the note. This template adds the episode's duration and a section for your notes:

```md
---
type: podcastEpisode
podcast: "{{podcastlink}}"
date: {{date:YYYY-MM-DD}}
duration: "{{duration}}"
---
# {{title}}

[Resume in PodNotes]({{episodelink}})

## Notes
```

For "The 12 Years that Changed Steve Jobs" from The Knowledge Project, the properties become `date: 2026-09-01` and `duration: "1:03:52"`, and `podcast` links to `[[PodNotes/Podcasts/The Knowledge Project|The Knowledge Project]]`. **Resume in PodNotes** opens the player and continues from where you stopped.

Feed notes use **Feed note template** under **Feed notes**. A changed template applies only to notes you create after the change. Existing notes keep their content.

[Template tags](/templates/) lists every tag and the [default episode note template](/templates/#using-the-default-template-with-bases).

## Browse your notes with Bases

[Obsidian Bases](https://obsidian.md/help/bases) shows notes as a table that you can filter, sort, and group. The default episode note template sets `type: podcastEpisode`, `podcast`, `date`, and `tags`. It leaves `status`, `rating`, and `favorite` for you to fill in, for example `status: listening`.

To list your episode notes grouped by status:

1. Open the note where you want the table.
2. Add this code block:

````md
```base
filters:
  and:
    - 'type == "podcastEpisode"'
views:
  - type: table
    name: Episodes
    order:
      - file.name
      - note.podcast
      - note.date
      - note.status
      - note.rating
    sort:
      - property: note.date
        direction: DESC
    groupBy:
      property: note.status
      direction: ASC
```
````

The lines inside the code block also work as the content of a `.base` file, such as `PodNotes/Episodes.base`.

![A Bases table of five episode notes with podcast, date, status, and rating columns, grouped into finished, listening, and next](/screenshots/bases.webp)

The filter matches the `type` property from the default template. If your template has no `type`, filter on a property or tag that it sets.

## Limits of note creation

These cases can surprise you:

- **PodNotes: Create episode note** needs both **Note creation file path** and **Note creation template**. With either one empty, the command is missing and the episode menu shows "Please set a note path and template in the settings."
- PodNotes finds an existing note by its path, or by a matching title in the same folder. After you rename or move a note, or change **Note creation file path**, PodNotes can create a second note for the same episode.
- After you change **Feed note file path**, new episode notes link to the new path. Existing episode notes keep their old links.
