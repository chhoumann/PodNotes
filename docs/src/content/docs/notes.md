---
title: Create episode notes
slug: notes
description: Create a note for an episode or a whole podcast, choose where notes go and what they hold, and browse them with Bases.
---

Create a note for the episode you are listening to, with the episode's details and a link that resumes playback, and keep your timestamps in it.

## Create a note for the current episode

1. Play an episode in PodNotes. You can pause it.
2. Run **PodNotes: Create episode note** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

PodNotes creates the note and opens it. With the default settings, the note for the Acquired episode "The Home Depot" is `PodNotes/Acquired/The Home Depot.md`. When the note exists, the command opens it instead. To add timestamps while you listen, see [Capture timestamps](/timestamps/).

## Create a note for another episode

The episode does not have to play.

1. In an episode list, right-click the episode, or select its three-dot **More options** button.
2. Select **Create note**. Once the note exists, the item reads **Open note**.

The [episode menu reference](/podcasts/#episode-menu-reference) lists the other items.

With no episode loaded, **PodNotes: Create episode note** also creates a note for any episode. Select a podcast, then an episode, and PodNotes creates or opens that episode's note.

## Create a feed note for a podcast

A feed note describes a whole podcast, with its artwork, author, description, website, and feed URL.

1. Run **PodNotes: Create podcast feed note** from the command palette.
2. Select the podcast. If an episode is loaded, its podcast is first in the list.

PodNotes creates the note and opens it, or opens the note if it exists. With the default settings, the feed note for Acquired is `PodNotes/Podcasts/Acquired.md`. In the PodNotes view, **Create podcast note** in the podcast's menu does the same.

The default episode note template links each episode note to its feed note in the `podcast` property, such as `[[PodNotes/Podcasts/Acquired|Acquired]]`, even when you create the feed note later.

## Change where notes go

1. Open **Settings → PodNotes**.
2. Under **Episode notes**, edit **Note creation file path**.

The default is `PodNotes/{{podcast}}/{{title}}.md`. To keep notes in a `Podcasts` folder instead:

- `Podcasts/{{title}}.md` puts every note in that folder. Episodes with the same title from different podcasts then share one note.
- `Podcasts/{{podcast}}/{{title}}.md` adds a subfolder per podcast.
- `Podcasts/{{date:YYYY}}/{{podcast}} - {{title}}.md` adds a subfolder per publication year.

After you edit the path, a preview shows the result for one of your episodes. [File path tags](/templates/#file-path-tags) lists every tag a path accepts.

PodNotes finds a note that has the `guid` and `feedUrl` properties wherever it is. It finds other notes only at the path, so move them to match. Otherwise PodNotes can create a second note for such an episode. See [How PodNotes finds a note](#how-podnotes-finds-a-note).

Feed notes and downloads have their own paths: **Feed note file path** under **Feed notes**, and **Episode download path** under **Downloads**.

## Change what notes contain

**Note creation template** under **Episode notes** sets the content of each new episode note, and PodNotes fills in its `{{tag}}` placeholders. This example replaces the [default template](/templates/#default-episode-note-template). It adds the episode's duration, shows the artwork at 96 pixels wide, folds the description into a callout, and keeps the `status` and `rating` properties for [Bases](#browse-your-notes-with-bases). It leaves out the `# {{title}}` heading, the episode URL, and `favorite`. Obsidian still shows the file name as the note's title:

```md
---
type: podcastEpisode
podcast: "{{podcastlink}}"
date: {{date:YYYY-MM-DD}}
duration: "{{duration}}"
tags:
  - podcastEpisode
status:
rating:
---
![|96]({{artwork}})

[Resume in PodNotes]({{episodelink}})

> [!summary]- Episode description
{{description:> }}

## Notes
```

A note made with this template looks like this:

![An episode note made with this template, with its properties, artwork, a Resume in PodNotes link, and the description folded into a callout](/screenshots/episode-note.webp)

**Resume in PodNotes** continues the episode from where you stopped. A changed template applies only to new notes. Feed notes use **Feed note template** under **Feed notes**. [Template tags](/templates/) lists every tag and the [default episode note template](/templates/#default-episode-note-template).

## Browse your notes with Bases

[Obsidian Bases](https://obsidian.md/help/bases) shows notes as a table that you can filter, sort, and group. The default episode note template sets `type: podcastEpisode`, `podcast`, `date`, `tags`, and `favorite: false`, and leaves `status` and `rating` for you to fill in. To list your episode notes grouped by status:

1. In the note where you want the table, insert this code block:

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

## How PodNotes finds a note

PodNotes adds two properties to each new episode note: `guid`, the episode's ID in its feed, and `feedUrl`, the address of its feed. To find an episode's note, PodNotes tries these in order:

1. The one note in the vault whose `guid` and `feedUrl` match the episode.
2. The note at the path that **Note creation file path** gives for the episode.
3. The one note in that folder whose name matches the episode title.

So a note with both properties keeps working after you rename it or move it to another folder.

PodNotes adds the properties at the end of the template's properties, or in a new properties block when the template has none. It skips a property that your template sets itself. It adds neither property when the feed gives the episode no ID, or when the episode comes from a private feed that you have not added. For a private feed that you added, `feedUrl` holds the feed's placeholder, not its address. See [Private feeds in notes and links](/private-feeds/#private-feeds-in-notes-and-links).

## Limits of note creation

- **PodNotes: Create episode note** needs both **Note creation file path** and **Note creation template**. With either one empty, the command is missing and the episode menu shows "Please set a note path and template in the settings."
- A note without the `guid` and `feedUrl` properties, such as one created before PodNotes 2.22.0 or one for a local file, is found only by its path or by its title in the same folder. After you rename or move such a note, PodNotes can create a second note for the episode.
- After you change **Feed note file path**, new episode notes link to the new path. Existing episode notes keep their old links.
