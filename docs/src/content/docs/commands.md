---
title: Commands
slug: commands
description: Current PodNotes command names, IDs, availability requirements, and effects.
---

The command palette prefixes these names with **PodNotes:**.
Most playback commands appear only after an episode is loaded. A loaded episode can be paused.
Each command's full ID is listed below for workflow plugins.

## Show player

`podnotes:podnotes-show-leaf` opens the PodNotes view or reveals its existing pane.
It is always available. If no pane exists, it creates one in the right sidebar.
The podcast ribbon action **Show PodNotes** opens the same view.

## Play Podcast

`podnotes:start-playing` starts playback of a loaded, paused episode.
It is available when an episode is loaded and PodNotes is paused.

## Stop Podcast

`podnotes:stop-playing` pauses the loaded episode and keeps its position.
It is available when PodNotes is playing.

## Toggle playback

`podnotes:podnotes-toggle-playback` switches the loaded episode between playing and paused.
It requires a loaded episode.

## Skip Backward

`podnotes:skip-backward` seeks backward by **Skip backward length (s)**, with a minimum position of zero.
It requires a loaded episode and works while paused. The default skip length is 15 seconds.

## Skip Forward

`podnotes:skip-forward` seeks forward by **Skip forward length (s)**.
When duration is known, a forward skip goes no further than 0.25 seconds before the end and never rewinds an episode already nearer its end.
Playback continues, so a playing episode finishes and the queue advances.
It requires a loaded episode and works while paused. The default skip length is 15 seconds.

## Download Playing Episode

`podnotes:download-playing-episode` downloads the loaded episode. Playback does not need to be running.
**Episode download path** controls the vault destination and defaults to `PodNotes/{{podcast}}/{{title}}`.
The media extension is added automatically.

A path that distinguishes episodes, such as one containing `{{title}}`, avoids file collisions.
A collision with another episode's file causes an error rather than an overwrite.
See [Path templates](/templates/#file-path) and [Downloads and sync](/sync/#downloads-on-another-device).

## Reorder Queue

`podnotes:reorder-queue` opens a queue editor with controls to move and remove episodes.
It appears when the queue contains at least two episodes. The saved order is the play order.

## Capture Timestamp

`podnotes:capture-timestamp` inserts the playback time into the active note editor.
It is an editor command that remains available without a loaded episode, so the mobile toolbar can offer it.
Capture itself requires a loaded episode and a non-empty **Capture timestamp format**.
If either is missing, PodNotes shows a notice.

The headset Media Session `previoustrack` action captures a timestamp with an episode-note fallback.
The editor command does not use that fallback. See [Timestamps](/timestamps/) and [Mobile capture](/mobile/).

## <span id="capture-last-10-seconds-capture-last-20-seconds"></span>Capture Last 10 Seconds / Capture Last 20 Seconds

`podnotes:capture-segment-10s` and `podnotes:capture-segment-20s` insert a recent playback range into the active editor.
They require a loaded episode and a non-empty timestamp format.
A linked range plays from its start and pauses at its end. See [Segment capture](/timestamps/#capturing-segments).

## Increase playback rate

`podnotes:increase-playback-rate` increases the loaded episode's speed by `0.1x`, up to `4x`.

## Decrease playback rate

`podnotes:decrease-playback-rate` decreases the loaded episode's speed by `0.1x`, down to `0.5x`.

## Reset playback rate

`podnotes:reset-playback-rate` resets the loaded episode's speed to **Default Playback Rate**.

## Create episode note

`podnotes:create-podcast-note` creates or opens a note for the loaded episode.
It requires a loaded episode, **Note creation file path**, and **Note creation template**.
Its ID is unchanged from the older **Create Podcast Note** name, so existing hotkeys remain associated with it.

See [Templates](/templates/) for the defaults and tag reference.

## Create podcast feed note

`podnotes:create-podcast-feed-note` opens a picker of saved podcasts, then creates or opens the selected feed note.
It requires at least one saved feed, **Feed note file path**, and **Feed note template**.
Playback is not required.

The episode context menu also offers **Create feed note** or **Open feed note**.
See [Feed note templates](/templates/#podcast-feed-notes).

## Copy universal episode link to clipboard

`podnotes:get-share-link-episode` copies a pod.link episode URL for the loaded episode.
It looks up the show in Apple Podcasts, matching its feed URL before trying its name, then matches the episode through pod.link.
A missing show or episode produces a notice. This is a share link for other podcast apps, rather than a PodNotes timestamp link.

## Transcribe current episode

`podnotes:podnotes-transcribe` transcribes the loaded audio episode into a note at **Transcript file path**.
It is available for audio episodes, including local audio, and unavailable for video episodes.
A missing API key does not hide the command. Running it explains which provider needs a key on this device.

Plain transcription uses OpenAI. With **Speaker diarization** enabled, **Diarization provider** selects OpenAI or Deepgram.
**OpenAI API key** and **Deepgram API key** are under **Transcripts** in PodNotes settings.
An existing transcript file is kept rather than transcribed again.
See [Transcripts](/transcripts/) for provider setup.
