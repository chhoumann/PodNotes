---
title: Settings
slug: settings
description: Every PodNotes setting, in the order the settings tab shows it, with its default and what it does.
---

Look up any PodNotes setting, its default, and what it does. The settings live in **Settings → PodNotes**, and the sections below follow the tab from top to bottom. In the PodNotes view, **Settings** in the list on the left, or the **PodNotes settings** gear in a narrow view, opens the same tab.

To find a setting, type its name in the search field at the top of Obsidian's settings window. Each PodNotes setting is its own result. `headset`, `lock screen`, and `media keys` find **Previous track** and **Next track**.

A toggle or a dropdown saves at once. A text or number field takes effect as you type, and PodNotes saves it after you pause typing for half a second, or when you leave the field or close the settings. If you quit or reload Obsidian before that save, PodNotes does not save what you typed since the last save.

## Playback

| Setting | Default | What it does |
| --- | --- | --- |
| **Skip back (s)** | 15 | Sets how many seconds the player's back button, **PodNotes: Skip Backward**, and the skip backward control of a headset or the lock screen move back. A whole number above 0. |
| **Skip forward (s)** | 15 | Sets how many seconds the forward button, **PodNotes: Skip Forward**, and the skip forward control of a headset or the lock screen move forward. A whole number above 0. |
| **Default speed** | `1×` | Sets the speed, `0.75×`, `1×`, `1.25×`, `1.5×`, `1.75×`, or `2×`, that PodNotes uses when Obsidian starts and whenever a different episode loads. Changing it does not change the speed of the episode that is playing. **PodNotes: Reset playback rate** returns to it. A speed saved by an older version, such as `1.3×`, stays as an extra choice until you pick another. |
| **Queue episodes I switch away from** | On | When you select another episode, puts the one you switch away from at the top of the queue, and starts the next queued episode when one ends. The Queue page's **Queue options** menu has the same switch. See [Turn off the automatic queue](/playlists/#turn-off-the-automatic-queue). |

## Headset and lock screen

These settings decide what the previous-track and next-track buttons of a headset or the lock screen do. See [Control playback from a headset or the lock screen](/mobile/#control-playback-from-a-headset-or-the-lock-screen).

| Setting | Default | Choices |
| --- | --- | --- |
| **Previous track** | **Capture timestamp** | **Capture timestamp**, **Back by the skip length**, **Previous chapter** |
| **Next track** | **Forward by the skip length** | **Forward by the skip length**, **Next in queue**, **Next chapter**, **Capture timestamp** |

## <span id="episode-notes"></span><span id="feed-notes"></span>Notes

| Setting | Default | What it does |
| --- | --- | --- |
| **Timestamp template** | `- {{linktime}}` with a space at the end | Sets the text each capture inserts. While an episode is loaded, the setting shows the result for it. Its time tag also sets the times in transcripts that feeds publish. See [Capture timestamps](/timestamps/). |
| **Timestamp offset (s)** | 0 | Subtracts this many seconds from each capture, to make up for reaction time. |
| **Episode note path** | `PodNotes/{{podcast}}/{{title}}.md` | Sets where PodNotes creates episode notes, and shows the path for one of your episodes. See [Create episode notes](/notes/). |
| **Episode note template** | [The default episode note template](/templates/#default-episode-note-template) | Sets the content of a new episode note. |
| **Podcast note path** | `PodNotes/Podcasts/{{podcast}}.md` | Sets where PodNotes creates the note for a whole podcast. See [Create a podcast note](/notes/#create-a-podcast-note). |
| **Podcast note template** | [The default podcast note template](/templates/#podcast-note-tags) | Sets the content of a new podcast note. [Podcast note tags](/templates/#podcast-note-tags) lists the tags it accepts. |

## Transcripts

**Diarization provider**, **Deepgram API key**, and **Speaker label format** are turned off until **Speaker diarization** is on. **Deepgram API key** also needs **Diarization provider** set to **Deepgram**.

| Setting | Default | What it does |
| --- | --- | --- |
| **OpenAI API key** | None | Selects the Obsidian secret that holds your OpenAI API key, or creates one. See [Set up an OpenAI key](/transcripts/#set-up-an-openai-key). |
| **Transcript path** | `transcripts/{{podcast}}/{{title}}.md` | Sets where PodNotes saves transcripts. Keep `.md` at the end, because PodNotes does not add it. |
| **Transcript template** | [The default transcript template](/templates/#transcript-and-timestamp-tags) | Sets the content of a new transcript note. |
| **Speaker diarization** | Off | Labels transcript turns by speaker. See [Add speaker labels](/transcripts/#add-speaker-labels). |
| **Diarization provider** | **OpenAI (gpt-4o-transcribe-diarize)** | Chooses OpenAI, which uses your OpenAI API key, or **Deepgram**, which needs its own key and keeps speaker labels consistent across long episodes. |
| **Deepgram API key** | None | Selects the Obsidian secret that holds your Deepgram API key, or creates one. |
| **Speaker label format** | `**{{speaker}}:**` with a space at the end | Sets the text before each speaker's turn. `{{speaker}}` becomes the speaker label. Transcripts that feeds publish use it too, even with **Speaker diarization** off. See [Change the speaker label format](/transcripts/#change-the-speaker-label-format). |

## Downloads

| Setting | Default | What it does |
| --- | --- | --- |
| **Download path** | `PodNotes/{{podcast}}/{{title}}` | Sets where downloaded episodes go. PodNotes adds the file extension. A warning appears when the path has no `{{title}}`, because episodes would share one file. See [Download an episode](/local_files/#download-an-episode). |

## <span id="importexport"></span>Library

| Setting | Default | What it does |
| --- | --- | --- |
| **Import OPML** | None | **Import** opens a file picker. PodNotes adds the podcasts in the `.opml` file you choose. See [Import podcasts from OPML](/import_export/#import-podcasts-from-opml). |
| **Export OPML** | `PodNotes_Export.opml` | **Export** saves the podcasts you added to an OPML file with this name in your vault. The file holds private feed addresses in plain text. See [Export podcasts to OPML](/import_export/#export-podcasts-to-opml). |
| **Latest episodes per podcast** | 10 | Sets how many of each podcast's newest episodes **Latest episodes** shows, from 1 to 75. |

## <span id="preferences--templates"></span>Import and export

| Setting | Default | What it does |
| --- | --- | --- |
| **Import settings** | None | **Import** opens a file picker. After you confirm, PodNotes replaces your preferences, templates, feeds, playlists, queue, and favorites with the ones in the file, and adds its playback progress for episodes this vault has not played. Your own progress, downloads, and local files stay. See [Import your settings](/import_export/#import-your-settings). |
| **Include API keys** | Off | Adds the OpenAI and Deepgram keys on this device to the next export, in plain text. The export file sits in your vault, where sync and other plugins can read it. The toggle turns off again each time you open the tab. |
| **Export settings** | `PodNotes_Settings.json` | **Export** saves your preferences, templates, feeds, playlists, queue, favorites, and playback progress to a file with this name in your vault. Private feeds that PodNotes recognizes keep only their placeholder, and other feed addresses stay as they are. It does not overwrite an existing file. See [Export your settings](/import_export/#export-your-settings). |

## <span id="search-podcasts"></span><span id="playlists"></span><span id="performance"></span>Settings that moved or were removed

PodNotes 2.22.0 moved these out of the settings tab. [Update to 2.22.0](/upgrade/) lists what else changes when you update.

| Before 2.22.0 | Now |
| --- | --- |
| **Search Podcasts** | **Add podcast** in the PodNotes view. Remove a podcast from its page's **Podcast options** menu. See [Add and play podcasts](/podcasts/). |
| **Playlists** | The Playlists page in the PodNotes view, with **New playlist**. A new playlist gets the default icon. See [Use the queue and playlists](/playlists/). |
| **Default Volume** | The volume button in the full player. PodNotes keeps that volume for every episode, and starts with the volume you saved before. |
| **Cache podcast feeds**, **Cache duration (hours)**, and **Clear cached feeds** | PodNotes always keeps a copy of each feed on this device and fetches it again after six hours, even if you turned caching off before. **Refresh episodes** and **Refresh all feeds** fetch at once. See [When a feed cannot be reached](/podcasts/#when-a-feed-cannot-be-reached). |

These settings have new names:

| Before 2.22.0 | Now |
| --- | --- |
| **Skip backward length (s)**, **Skip forward length (s)** | **Skip back (s)**, **Skip forward (s)** |
| **Default Playback Rate** | **Default speed** |
| **Keep a queue of episodes you switch away from** | **Queue episodes I switch away from** |
| **Capture timestamp format** | **Timestamp template** |
| **Note creation file path**, **Note creation template** | **Episode note path**, **Episode note template** |
| **Feed note file path**, **Feed note template** | **Podcast note path**, **Podcast note template** |
| **Transcript file path** | **Transcript path** |
| **Episode download path** | **Download path** |
