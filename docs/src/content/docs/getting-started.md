---
title: Getting started
slug: getting-started
description: Install PodNotes, add a podcast, play an episode, and save your first timestamp and episode note.
---

Let's play one podcast episode and save a link to a moment in it.

## Install PodNotes

1. Open Obsidian settings and choose **Community plugins**.
2. Turn off restricted mode if it is enabled.
3. Browse for **PodNotes**, install it, and enable it.
4. Run **PodNotes: Show player** from the command palette.

The PodNotes view opens. On a phone, use the same command or the **Show PodNotes** ribbon action.

## Add a podcast

1. Open PodNotes settings and find **Search Podcasts**.
2. Enter a show name, its RSS feed URL, or its Apple Podcasts show link.
3. Choose **Add** on the matching result.

The result changes to **Remove**. Your podcast is now saved.
If a show is missing, try its publisher's RSS URL. See the [supported podcast FAQ](/faq/#which-podcasts-can-i-add) for source limits.

## Play an episode

1. Run **PodNotes: Show player** again.
2. Choose the saved podcast.
3. Select an episode to play it.

The player loads the episode and its playback time advances.

## Capture a timestamp

1. Create or open a Markdown note in edit mode.
2. Place the cursor where you want the timestamp.
3. Run **PodNotes: Capture Timestamp**.

On a new install, a clickable timestamp appears. Opening that link plays the episode at the captured time.
If your saved format produces plain text, see [Timestamp settings](/timestamps/#settings).
Phone users can add a [mobile toolbar button](/mobile/#add-a-capture-button-to-the-editor-toolbar).

## Create an episode note

1. With the episode still loaded, run **PodNotes: Create episode note**.
2. Write your notes in the file that opens.

PodNotes fills the note with the episode's metadata and a resume link.
The defaults work without a custom template. See [Templates](/templates/) when you want to change the note's path or content.
