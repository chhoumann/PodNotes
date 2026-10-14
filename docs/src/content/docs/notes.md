---
title: Create episode notes
slug: notes
description: Create a note for an episode or a whole podcast, choose where notes go and what they hold, and browse them with Bases.
---

Create a note for the episode you are listening to, with the episode's details and a link that resumes playback, and keep your timestamps in it.

## Create a note for the current episode

1. Play an episode in PodNotes. You can pause it.
2. Run **PodNotes: Create episode note** from the command palette (`Ctrl+P`, or `Command+P` on macOS).

**Create note** in the full player, beside **Timestamp**, does the same. PodNotes creates the note and opens it. With the default settings, the note for the Acquired episode "The Home Depot" is `PodNotes/Acquired/The Home Depot.md`. When the note exists, the command opens it instead, and the full player's button reads **Open note**. To add timestamps while you listen, see [Capture timestamps](/timestamps/).

## Create a note for another episode

The episode does not have to play.

1. In an episode list, right-click the episode, or select its **More options** button, the three dots at the end of its row.
2. Select **Create note**. Once the note exists, the item reads **Open note**.

The [episode menu reference](/podcasts/#episode-menu-reference) lists the other items.

With no episode loaded, **PodNotes: Create episode note** also creates a note for any episode. Select a podcast, then an episode, and PodNotes creates or opens that episode's note.

## <span id="create-a-feed-note-for-a-podcast"></span>Create a podcast note

A podcast note describes a whole podcast, with its artwork, author, description, website, and feed URL.

1. Open the podcast's page in the PodNotes view.
2. Select **Podcast options**, the three-dot button at the top right.
3. Select **Create podcast note**.

PodNotes creates the note and opens it. Once the note exists, the item reads **Open podcast note**. With the default settings, the podcast note for Acquired is `PodNotes/Podcasts/Acquired.md`. **PodNotes: Create podcast feed note** does the same from the command palette. Select the podcast, and if an episode is loaded, its podcast is first in the list.

The default episode note template links each episode note to its podcast note in the `podcast` property, such as `[[PodNotes/Podcasts/Acquired|Acquired]]`, even when you create the podcast note later.

## Change where notes go

1. Open **Settings → PodNotes**.
2. Under **Notes**, edit **Episode note path**.

The default is `PodNotes/{{podcast}}/{{title}}.md`. To keep notes in a `Podcasts` folder instead:

- `Podcasts/{{title}}.md` puts every note in that folder. Episodes with the same title from different podcasts then share one note.
- `Podcasts/{{podcast}}/{{title}}.md` adds a subfolder per podcast.
- `Podcasts/{{date:YYYY}}/{{podcast}} - {{title}}.md` adds a subfolder per publication year.

Below the setting's name, a preview shows the result for one of your episodes. [File path tags](/templates/#file-path-tags) lists every tag a path accepts.

PodNotes finds a note that has the `guid` and `feedUrl` properties wherever it is. It finds other notes, including every note created before PodNotes 2.22.0, only at the new path or by their title in that path's folder, so move them to match. Otherwise PodNotes can create a second note for such an episode. See [How PodNotes finds a note](/notes/#how-podnotes-finds-a-note).

Podcast notes and downloads have their own paths: **Podcast note path** under **Notes**, and **Download path** under **Downloads**.

## Change what notes contain

**Episode note template** under **Notes** sets the content of each new episode note, and PodNotes fills in its `{{tag}}` placeholders. This example replaces the [default template](/templates/#default-episode-note-template). It adds the episode's duration, shows the artwork at 96 pixels wide, folds the description into a callout, and keeps the `status` and `rating` properties for [Bases](/notes/#browse-your-notes-with-bases). It leaves out the `# {{title}}` heading, the episode URL, and `favorite`. Obsidian still shows the file name as the note's title:

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

{{episodelink:Resume in PodNotes}}

> [!summary]- Episode description
{{description:> }}

## Notes
```

A note made with this template looks like this:

![An episode note made with this template, with its properties, artwork, and a Resume in PodNotes link](/screenshots/episode-note.webp)

**Resume in PodNotes** continues the episode from where you stopped. `{{episodelink:Resume in PodNotes}}` makes that link, and leaves the line empty when the episode has nothing to link to. A changed template applies only to new notes. Podcast notes use **Podcast note template** under **Notes**. [Template tags](/templates/) lists every tag and the [default episode note template](/templates/#default-episode-note-template).

### Update the resume link in an existing template

New installs of PodNotes 2.22.0 get a default template whose resume line is `{{episodelink:Resume in PodNotes}}`. PodNotes never changes a saved template, so if you used PodNotes before, your template keeps `[Resume in PodNotes]({{episodelink}})`. That line leaves an empty link in a note for an episode that PodNotes cannot link to, such as one from a private feed that you have not added. To leave the line out instead:

1. Under **Notes**, open **Episode note template**.
2. Replace `[Resume in PodNotes]({{episodelink}})` with `{{episodelink:Resume in PodNotes}}`.

The change applies to new notes. PodNotes does not rewrite notes you created before.

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

When the feed gives an episode an ID, PodNotes adds two properties to the episode's new note: `guid`, the episode's ID in its feed, and `feedUrl`, the address of its feed. To find an episode's note, PodNotes tries these in order:

1. The one note in the vault whose `guid` and `feedUrl` match the episode.
2. The note at the path that **Episode note path** gives for the episode.
3. The one note in that folder whose name matches the episode title.

So a note with both properties keeps working after you rename it or move it to another folder. If you used PodNotes before 2.22.0, every note you created before the update lacks these properties, and PodNotes cannot add them. Keep such a note at the path that **Episode note path** gives for the episode, or in that path's folder with the episode's title as its name. Otherwise PodNotes no longer finds it for the episode.

To get a note that you can rename and move:

1. On the podcast's page, open the episode's menu.
2. If the menu shows **Open note**, PodNotes still finds the old note, so move the old note to a folder that PodNotes does not use for episode notes, such as a new `Archive` folder.
3. Open the episode's menu again.
4. Select **Create note**. Use the menu, not the command, because an episode that PodNotes restored from an older version can lack the ID from its feed.
5. Check that the new note's properties include `guid` and `feedUrl`. If either is missing, keep the new note at its path. The cases after these steps explain why PodNotes may not add them.
6. Copy your text from the old note into the new one, below its properties.

PodNotes adds the properties at the end of the template's properties, or in a new properties block when the template has none. It skips a property that your template sets itself. PodNotes adds neither property in these cases:

- The episode is a local file.
- The feed gives the same ID to several episodes.
- PodNotes cannot extend the template's properties, as with invalid YAML.
- The properties would show a private feed's address, as for a private feed that you have not added.

For a private feed that you added and that PodNotes recognizes, `feedUrl` holds the feed's placeholder, not its address. See [Private feeds in notes and links](/private-feeds/#private-feeds-in-notes-and-links).

## Limits of note creation

- **PodNotes: Create episode note** needs both **Episode note path** and **Episode note template**. With either one empty, the command is missing, and **Create note** shows "Please set a note path and template in the settings."
- PodNotes finds a note without the `guid` and `feedUrl` properties, such as one created before PodNotes 2.22.0 or one for a local file, only by its path or by its title in the same folder. After you rename or move such a note, PodNotes can create a second note for the episode.
- After you change **Podcast note path**, new episode notes link to the new path. Existing episode notes keep their old links.
