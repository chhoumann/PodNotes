---
title: Settings
slug: settings
description: Every PodNotes setting, in the order the settings tab shows it, with its default and what it does.
---

Look up any PodNotes setting, its default, and what it does. The settings live in **Settings → PodNotes**, and the sections below follow the tab from top to bottom.

<span id="search-podcasts"></span>You add and remove podcasts in the PodNotes view, not in the settings. See [Add a podcast](/podcasts/#add-a-podcast).

## Playlists

The section lists **Queue**, **Favorites**, and your own playlists with their episode counts. Each playlist you made has a **Delete playlist** button, and the controls below the list add a playlist. See [Collect episodes in playlists](/playlists/#collect-episodes-in-playlists).

## Playback

These settings sit below **Playlists** in the tab, with no heading of their own.

| Setting | Default | What it does |
| --- | --- | --- |
| **Keep a queue of episodes you switch away from** | On | Puts the episode you switch away from at the top of the queue, and starts the next queued episode when one ends. See [Turn off the automatic queue](/playlists/#turn-off-the-automatic-queue). |
| **Latest episodes per podcast** | 10 | Sets how many of each podcast's newest episodes **Latest episodes** shows and searches, from 1 to 75. |
| **Default Playback Rate** | 1x | Sets the speed, from 0.5x to 4x, that PodNotes uses when Obsidian starts and whenever a different episode loads. Changing it does not change the speed of the episode that is playing. **PodNotes: Reset playback rate** returns to it. |
| **Default Volume** | 1 (100%) | Sets the volume, from 0 to 1, and changes the current volume at once. The player's volume slider changes this setting too, so one volume applies to every episode. |
| **Skip backward length (s)** | 15 | Sets how many seconds the skip backward button, the command, and the skip backward control of a headset or the lock screen move back. |
| **Skip forward length (s)** | 15 | Sets how many seconds the skip forward button, the command, and the skip forward control of a headset or the lock screen move forward. |

## Episode notes

| Setting | Default | What it does |
| --- | --- | --- |
| **Capture timestamp format** | `- {{linktime}}` with a space at the end | Sets the text each capture inserts. A preview below the field shows the result for the loaded episode. Its time tag also sets the times in transcripts that feeds publish. See [Capture timestamps](/timestamps/). |
| **Timestamp offset (s)** | 0 | Subtracts this many seconds from each capture, to make up for reaction time. |
| **Note creation file path** | `PodNotes/{{podcast}}/{{title}}.md` | Sets where PodNotes creates episode notes. See [Create episode notes](/notes/). |
| **Note creation template** | [The default episode note template](/templates/#default-episode-note-template) | Sets the content of a new episode note. |

## Feed notes

[Feed note tags](/templates/#feed-note-tags) lists the tags a feed note path and template accept.

| Setting | Default | What it does |
| --- | --- | --- |
| **Feed note file path** | `PodNotes/Podcasts/{{podcast}}.md` | Sets where **PodNotes: Create podcast feed note** and **Create podcast note** in the podcast's menu create the note for a podcast. See [Create episode notes](/notes/). |
| **Feed note template** | [The default feed note template](/templates/#feed-note-tags) | Sets the content of a new feed note. |

## Downloads

| Setting | Default | What it does |
| --- | --- | --- |
| **Episode download path** | `PodNotes/{{podcast}}/{{title}}` | Sets where downloaded episodes go. PodNotes adds the file extension. A warning appears when the path has no `{{title}}`, because episodes would share one file. See [Download an episode](/local_files/#download-an-episode). |

## Performance

| Setting | Default | What it does |
| --- | --- | --- |
| **Cache podcast feeds** | On | Keeps a copy of each saved feed, with up to its 75 newest episodes, on this device, outside your vault, so PodNotes starts faster. When a feed cannot be fetched, PodNotes uses this copy, however old it is. |
| **Cache duration (hours)** | 6 | Sets how long PodNotes reuses a cached feed before it fetches the feed again, from 1 to 24. An older copy stays for when the feed cannot be fetched. |
| **Clear cached feeds** | None | **Clear cache** deletes the cached feeds and fetches every saved feed again. |

## Import/Export

| Setting | Default | What it does |
| --- | --- | --- |
| **Import OPML** | None | **Import** opens a file picker. PodNotes adds the podcasts in the `.opml` file you choose. See [Import podcasts from OPML](/import_export/#import-podcasts-from-opml). |
| **Export OPML** | `PodNotes_Export.opml` | **Export** saves the podcasts you added to an OPML file with this name in your vault. The file holds private feed addresses in plain text. See [Export podcasts to OPML](/import_export/#export-podcasts-to-opml). |

## Preferences & templates

| Setting | Default | What it does |
| --- | --- | --- |
| **Import settings** | None | **Import** opens a file picker. After you confirm, PodNotes replaces your preferences, templates, feeds, playlists, queue, and favorites with the ones in the file, and adds its playback progress for episodes this vault has not played. Your own progress, downloads, and local files stay. See [Import your settings](/import_export/#import-your-settings). |
| **Include API keys** | Off | Adds the OpenAI and Deepgram keys on this device to the next export, in plain text. The export file sits in your vault, where sync and other plugins can read it. The toggle turns off again each time you open the tab. |
| **Export settings** | `PodNotes_Settings.json` | **Export** saves your preferences, templates, feeds, playlists, queue, favorites, and playback progress to a file with this name in your vault. Private feeds keep only their placeholder. It does not overwrite an existing file. See [Export your settings](/import_export/#export-your-settings). |

## Transcripts

The last three settings appear only when **Speaker diarization** is on. **Deepgram API key** also needs **Diarization provider** set to **Deepgram**.

| Setting | Default | What it does |
| --- | --- | --- |
| **OpenAI API key** | None | Selects the Obsidian secret that holds your OpenAI API key, or creates one. See [Set up an OpenAI key](/transcripts/#set-up-an-openai-key). |
| **Transcript file path** | `transcripts/{{podcast}}/{{title}}.md` | Sets where PodNotes saves transcripts. Keep `.md` at the end, because PodNotes does not add it. |
| **Transcript template** | [The default transcript template](/templates/#transcript-and-timestamp-tags) | Sets the content of a new transcript note. |
| **Speaker diarization** | Off | Labels transcript segments by speaker. See [Add speaker labels](/transcripts/#add-speaker-labels). |
| **Diarization provider** | **OpenAI (gpt-4o-transcribe-diarize)** | Chooses OpenAI, which uses your OpenAI API key, or **Deepgram**, which needs its own key and keeps speaker labels consistent across the episode. |
| **Deepgram API key** | None | Selects the Obsidian secret that holds your Deepgram API key, or creates one. |
| **Speaker label format** | `**{{speaker}}:**` with a space at the end | Sets the text before each speaker's turn. `{{speaker}}` becomes the speaker label. Transcripts that feeds publish use it too, even with **Speaker diarization** off. See [Change the speaker label format](/transcripts/#change-the-speaker-label-format). |
