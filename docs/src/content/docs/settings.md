---
title: Settings
slug: settings
description: Every PodNotes setting, in the order the settings tab shows it, with its default and what it does.
---

Look up any PodNotes setting, its default, and what it does. The settings live in **Settings → PodNotes**, and the sections below follow the tab from top to bottom. In the PodNotes view, **Settings** in the list on the left, or the **PodNotes settings** gear in a narrow view, opens the same tab.

To find a setting, type its name in the search field at the top of Obsidian's settings window. Each PodNotes setting is its own result. Searching for `headset`, `lock screen`, or `media keys` finds **Previous track** and **Next track**.

A toggle or a dropdown saves at once. A text or number field takes effect as you type, and PodNotes saves it after you pause typing for half a second, or when you leave the field or close the settings. If you quit or reload Obsidian before that save, PodNotes does not save what you typed since the last save.

## Playback

| Setting | Default | What it does |
| --- | --- | --- |
| **Skip back (s)** | 15 | Sets how many seconds the player's back button, **PodNotes: Skip Backward**, and the skip backward control of a headset or the lock screen move back. A whole number above 0. |
| **Skip forward (s)** | 15 | Sets how many seconds the forward button, **PodNotes: Skip Forward**, and the skip forward control of a headset or the lock screen move forward. A whole number above 0. |
| **Default speed** | `1×` | Sets the speed, `0.75×`, `1×`, `1.25×`, `1.5×`, `1.75×`, or `2×`, that PodNotes uses when Obsidian starts and whenever a different episode loads. Changing it does not change the speed of the episode that is playing. **PodNotes: Reset playback rate** returns to it. A speed saved by an older version, such as `1.3×`, stays as an extra choice until you pick another. |
| **Queue episodes I switch away from** | On | When you select another episode, puts the one you switch away from at the top of the queue, unless it has ended. When an episode ends, starts the next one in the queue. The Queue page's **Queue options** menu has the same switch. See [Turn off the automatic queue](/playlists/#turn-off-the-automatic-queue). |

## Headset and lock screen

These settings decide what the previous-track and next-track buttons of a headset or the lock screen do. See [Control playback from a headset or the lock screen](/mobile/#control-playback-from-a-headset-or-the-lock-screen).

| Setting | Default | Choices |
| --- | --- | --- |
| **Previous track** | **Capture timestamp** | **Capture timestamp**, **Back by the skip length**, **Previous chapter** |
| **Next track** | **Forward by the skip length** | **Forward by the skip length**, **Next in queue**, **Next chapter**, **Capture timestamp** |

## <span id="episode-notes"></span><span id="feed-notes"></span>Notes

| Setting | Default | What it does |
| --- | --- | --- |
| **Timestamp template** | `- {{linktime}}` with a space at the end | Sets the text each capture inserts. While an episode is loaded, the setting shows the result for it. Its time tag also sets the times in audio transcripts from ElevenLabs, Deepgram, OpenRouter, and an OpenAI-compatible server that returns times, and in timed transcripts that feeds publish. See [Capture timestamps](/timestamps/). |
| **Timestamp offset (s)** | 0 | Subtracts this many seconds from each capture, to make up for reaction time. |
| **QuickAdd choice** | None | Runs this QuickAdd choice for each capture, instead of inserting the timestamp. **Choose...** picks one of your QuickAdd choices, and **Create** adds a ready-made one. See [Capture with QuickAdd](/QuickAdd/#capture-with-quickadd). |
| **Episode note path** | `PodNotes/{{podcast}}/{{title}}.md` | Sets where PodNotes creates episode notes, and shows the path for one of your episodes. See [Create episode notes](/notes/). |
| **Episode note template** | [The default episode note template](/templates/#default-episode-note-template) | Sets the content of a new episode note. |
| **Podcast note path** | `PodNotes/Podcasts/{{podcast}}.md` | Sets where PodNotes creates the note for a whole podcast. See [Create a podcast note](/notes/#create-a-podcast-note). |
| **Podcast note template** | [The default podcast note template](/templates/#podcast-note-tags) | Sets the content of a new podcast note. [Podcast note tags](/templates/#podcast-note-tags) lists the tags it accepts. |

## Transcripts

Only the API key row for the selected **Transcription provider** is shown. **Server address** appears while **OpenAI-compatible server** is selected, and **Speaker label format** appears while **Speaker labels** is on.

| Setting | Default | What it does |
| --- | --- | --- |
| **Transcription provider** | **ElevenLabs** on new installs ([migrated on update](/update-2-25/)) | Chooses **ElevenLabs**, **Deepgram**, **OpenRouter**, **OpenAI**, or **OpenAI-compatible server** for audio transcription, and resets **Model** to the provider's recommended model (or clears it for **OpenAI-compatible server**) when changed. See [Choose a transcription provider](/transcription-providers/). |
| **Server address** | Empty | Shown when **Transcription provider** is **OpenAI-compatible server**. Sets the server's `http://` or `https://` URL (placeholder `http://localhost:8000/v1`). PodNotes trims trailing slashes and appends `/audio/transcriptions` unless the address already ends with `/audio/transcriptions`. |
| **ElevenLabs API key**, **Deepgram API key**, **OpenRouter API key**, **OpenAI API key**, or **OpenAI-compatible server API key** | None | Selects the Obsidian secret on this device that holds your API key for the selected provider, or creates one. Optional when **Transcription provider** is **OpenAI-compatible server**. |
| **Model** | Provider's recommended model (empty on **OpenAI-compatible server**) | Chooses the speech-to-text model for the selected provider: **Scribe v3** on **ElevenLabs**, **Nova-3** on **Deepgram**, **Grok STT 2.0** (recommended), **ElevenLabs Scribe v2**, **MAI-Transcribe 2**, **Voxtral Mini Transcribe 3**, or **Qwen3 ASR 1.7B** on **OpenRouter**, and **GPT Transcribe** on **OpenAI**. On **OpenAI-compatible server**, becomes a text field where you enter the model ID your server expects. |
| **Speaker labels** | On (Off if off before updating) | Numbers speakers `1`, `2`, `3` in audio transcripts. Disabled while off when the selected model or provider does not label speakers (**Voxtral Mini Transcribe 3**, **Qwen3 ASR 1.7B**, **GPT Transcribe**, or **OpenAI-compatible server**). See [Speaker labels](/transcripts/#speaker-labels). |
| **Speaker label format** | `**{{speaker}}:**` with a space at the end | Sets the text before each speaker's turn. `{{speaker}}` becomes the speaker number or feed speaker name. Transcripts that feeds publish use it too, even with **Speaker labels** off. See [Change the speaker label format](/transcripts/#change-the-speaker-label-format). |
| **Transcript path** | `transcripts/{{podcast}}/{{title}}.md` | Sets where PodNotes saves transcripts, and shows the path for one of your episodes. Keep `.md` at the end, because PodNotes does not add it. |
| **Transcript template** | [The default transcript template](/templates/#transcript-and-timestamp-tags) | Sets the content of a new transcript note. |

## Downloads

| Setting | Default | What it does |
| --- | --- | --- |
| **Download path** | `PodNotes/{{podcast}}/{{title}}` | Sets where downloaded episodes go. PodNotes adds the file extension. When the path has no `{{title}}`, a warning says that episodes would share a file name and a second download to it fails. See [Download an episode](/local_files/#download-an-episode). |

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
| **Include API keys** | Off | Adds the ElevenLabs, Deepgram, OpenRouter, OpenAI, and OpenAI-compatible server API keys stored on this device to the next export, in plain text. The export file sits in your vault, where sync and other plugins can read it. The toggle turns off again each time you open the tab. |
| **Export settings** | `PodNotes_Settings.json` | **Export** saves your preferences, templates, feeds, playlists, queue, favorites, and playback progress to a file with this name in your vault. Private feeds that PodNotes recognizes keep their placeholder and reference, never their address, and other feed addresses stay as they are. It does not overwrite an existing file. See [Export your settings](/import_export/#export-your-settings). |

## <span id="search-podcasts"></span><span id="playlists"></span><span id="performance"></span>Settings that moved or were removed

PodNotes 2.22.0 moved these out of the settings tab. [Update to 2.22.0](/upgrade/) lists what else changes when you update from 2.21.1 or earlier, and [Update to 2.25.0](/update-2-25/) covers the 2.25.0 transcription update.

| Earlier name | Now |
| --- | --- |
| **Search Podcasts** | **Add podcast** in the PodNotes view. Remove a podcast from its page's **Podcast options** menu. See [Add and play podcasts](/podcasts/). |
| **Playlists** | The Playlists page in the PodNotes view, with **New playlist**. A new playlist gets the default icon. See [Use the queue and playlists](/playlists/). |
| **Default Volume** | The volume button in the full player. PodNotes keeps that volume for every episode, and starts with the volume you saved before. |
| **Cache podcast feeds**, **Cache duration (hours)**, and **Clear cached feeds** | PodNotes always caches feeds on this device and fetches a feed again when its copy is more than six hours old, even if you turned caching off before. **Refresh episodes** and **Refresh all feeds** fetch at once. See [When a feed cannot be reached](/podcasts/#when-a-feed-cannot-be-reached). |

These settings have new names:

| Earlier name | Now |
| --- | --- |
| **Skip backward length (s)**, **Skip forward length (s)** | **Skip back (s)**, **Skip forward (s)** |
| **Default Playback Rate** | **Default speed** |
| **Keep a queue of episodes you switch away from** | **Queue episodes I switch away from** |
| **Capture timestamp format** | **Timestamp template** |
| **Note creation file path**, **Note creation template** | **Episode note path**, **Episode note template** |
| **Feed note file path**, **Feed note template** | **Podcast note path**, **Podcast note template** |
| **Transcript file path** | **Transcript path** |
| **Speaker diarization** | **Speaker labels** |
| **Diarization provider** | **Transcription provider** and **Model** |
| **Episode download path** | **Download path** |
