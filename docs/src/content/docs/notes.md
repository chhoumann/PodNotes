---
title: Create episode notes
slug: notes
description: Create a note for an episode or a whole podcast, choose where notes go and what they hold, and browse them with Bases.
---

Create a note for the episode you are listening to, with the episode's details and a link that resumes playback, and keep your timestamps in it.

![The top of an episode note with its title, properties, artwork, a Resume in PodNotes link, and a collapsed episode description](/screenshots/episode-note.webp)

## Create a note for the current episode

1. Play an episode in PodNotes. You can pause it.
2. Run **PodNotes: Create episode note** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

PodNotes creates the note and opens it. With the default settings, the note for the Acquired episode "The Home Depot" is `PodNotes/Acquired/The Home Depot.md`. When the note exists, the command opens it instead. To add timestamps while you listen, see [Capture timestamps](/timestamps/).

## Create a note for another episode

1. In an episode list, right-click the episode, or select its three-dot **More options** button.
2. Select **Create Note**. Once the note exists, the item reads **Open Note**.

The [episode menu reference](/podcasts/#episode-menu-reference) lists the other items.

## Create a feed note for a podcast

A feed note describes a whole podcast, with its artwork, author, description, website, and feed URL.

1. Run **PodNotes: Create podcast feed note** from the command palette.
2. Select the podcast. If an episode is loaded, its podcast is first in the list.

PodNotes creates the note and opens it, or opens the note if it exists. With the default settings, the feed note for Acquired is `PodNotes/Podcasts/Acquired.md`. The episode menu's **Create feed note** does the same.

The default episode note template links each episode note to its feed note in the `podcast` property, such as `[[PodNotes/Podcasts/Acquired|Acquired]]`, even when you create the feed note later.

## Change where notes go

1. Open **Settings → PodNotes**.
2. Under **Episode notes**, edit **Note creation file path**.

The default is `PodNotes/{{podcast}}/{{title}}.md`. To keep notes in a `Podcasts` folder instead:

- `Podcasts/{{title}}.md` puts every note in that folder.
- `Podcasts/{{podcast}}/{{title}}.md` adds a subfolder per podcast.
- `Podcasts/{{date:YYYY}}/{{podcast}} - {{title}}.md` adds a subfolder per publication year.

After you edit the path, a preview shows the result for one of your episodes. [File path tags](/templates/#file-path-tags) lists every tag a path accepts.

PodNotes looks for notes at the new path, so move your existing notes to match. Otherwise it can create a second note for an episode.

Feed notes and downloads have their own paths: **Feed note file path** under **Feed notes**, and **Episode download path** under **Downloads**.

## Change what notes contain

**Note creation template** under **Episode notes** sets the content of each new episode note, and PodNotes fills in its `{{tag}}` placeholders. This template adds the episode's duration and a section for your notes:

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

**Resume in PodNotes** continues the episode from where you stopped. A changed template applies only to new notes. Feed notes use **Feed note template** under **Feed notes**. [Template tags](/templates/) lists every tag and the [default episode note template](/templates/#default-episode-note-template).

## Browse your notes with Bases

[Obsidian Bases](https://obsidian.md/help/bases) shows notes as a table that you can filter, sort, and group. The default episode note template sets `type: podcastEpisode`, `podcast`, `date`, and `tags`, and leaves `status`, `rating`, and `favorite` for you to fill in. To list your episode notes grouped by status, add this code block to a note:

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

![A Bases table of five episode notes, grouped by status into finished, listening, and next](/screenshots/bases.webp)

The same lines also work as the content of a `.base` file, such as `PodNotes/Episodes.base`. If your template has no `type` property, filter on a property or tag that it sets.

## Limits of note creation

These cases can surprise you:

- **PodNotes: Create episode note** needs both **Note creation file path** and **Note creation template**. With either one empty, the command is missing and the episode menu shows "Please set a note path and template in the settings."
- PodNotes finds an existing note by its path, or by a matching title in the same folder. After you rename or move a note, it can create a second note for the episode.
- After you change **Feed note file path**, new episode notes link to the new path. Existing episode notes keep their old links.
