---
title: Add and play podcasts
slug: podcasts
description: Add podcasts by name, RSS feed URL, or Apple Podcasts link, then browse and play their episodes.
---

Add podcasts to PodNotes, find their episodes, and play them.

## <span id="adding-podcasts"></span>Add a podcast

1. Open **Settings → PodNotes**.
2. Under **Search Podcasts**, type a podcast's name, such as `the daily`. Results appear as you type.
3. Next to the podcast, select **Add**.

Search uses the Apple Podcasts directory. To add a show by its feed instead:

1. Copy its RSS feed URL or its Apple Podcasts show link. An RSS feed URL looks like `https://feeds.npr.org/510289/podcast.xml`.
2. Paste it into **Search Podcasts**.
3. Select **Add** on the one result that appears.

See [Which podcasts can I add?](/faq/#which-podcasts-can-i-add) and [Can I use a private feed?](/faq/#can-i-use-a-private-feed)

## Remove a podcast

1. Open **Settings → PodNotes**.
2. Under **Search Podcasts**, clear the search box. It lists the podcasts you follow.
3. Next to the podcast, select **Remove**.

PodNotes keeps the podcast's episode notes, downloads, and playlist entries.

## <span id="episode-list"></span>Browse episodes

1. Run **PodNotes: Show player**, or select **Show PodNotes** in the ribbon.
2. At the top of the PodNotes view, select **Podcast grid**, the first of the three buttons.
3. Select a podcast's artwork, or select a playlist.

![The podcast grid with the Queue, Favorites, Local Files, Played, and Commute playlists beside podcast artwork tiles](/screenshots/podcast-grid.webp)

The view then lists that podcast's or playlist's episodes. **Queue** is the exception: when it holds episodes, it opens the player, which shows the **Queue** list.

To return to the last list you saw, select **Episode list**, the second button at the top of the view. If it shows a podcast or a playlist, select **Latest Episodes** at the top to see the newest episodes of every podcast.

Above each list, **Search episodes** filters it, and **Refresh episodes** fetches new episodes. **Hide played episodes** hides the episodes that PodNotes strikes through as played, and **Show played episodes** brings them back. The **Played** list always shows them.

<span id="how-many-latest-episodes-are-shown"></span>**Latest Episodes** shows and searches the 10 newest episodes of each podcast. To show up to 75, raise **Latest episodes per podcast** in **Settings → PodNotes**.

## <span id="player"></span>Play an episode

Select an episode to play it. The player resumes where you stopped last time. To return to the player from a list, select **Player**, the third button at the top of the view.

![The player with episode artwork, the episode title, the progress bar, and the skip buttons](/screenshots/player.webp)

- Select the artwork to play or pause. Select a point on the progress bar to jump there. The time on the left is how far you are, and the time on the right is how much is left.
- The skip buttons jump 15 seconds. **Skip backward length (s)** and **Skip forward length (s)** change that.
- The speed slider, below the volume slider, goes from 0.5x to 4x. Each time Obsidian starts, the speed resets to **Default Playback Rate**.
- **Chapters** lists the episode's chapters when it has them. Select a chapter to jump to it.

## <span id="playlists"></span><span id="reordering-the-queue"></span><span id="turning-off-the-queue"></span>Queue and playlists

The queue decides what plays next, and playlists collect episodes you want to keep together. [Use the queue and playlists](/playlists/) shows how to add, reorder, and remove episodes in both.

## <span id="context-menu"></span>Episode menu reference

To open an episode's menu, right-click the episode or select its **More options** button. The menu shows these items in this order:

| Item | What it does |
| --- | --- |
| **Play** | Plays the episode. |
| **Mark as Played** or **Mark as Unplayed** | Changes whether the episode counts as played. |
| **Download**, **Remove file**, or **Remove from Local Files** | Downloads the episode, or removes the download or your own file. See [Downloads and local files](/local_files/). |
| **Create Note** or **Open Note** | Creates or opens the episode note. See [Create episode notes](/notes/). |
| **Create feed note** or **Open feed note** | Creates or opens the note for the whole podcast. |
| **Add to Favorites** or **Remove from Favorites** | Adds the episode to **Favorites** or removes it. |
| **Add to Queue** or **Remove from Queue** | Adds the episode to the bottom of the queue or removes it. |
| **Move to top of queue**, **Move up in queue**, **Move down in queue**, **Move to bottom of queue** | Moves the episode within the queue. Shown only in the player's **Queue** list. |
| **Add to** *playlist* or **Remove from** *playlist* | Adds the episode to that playlist or removes it. One item per playlist you made. |
