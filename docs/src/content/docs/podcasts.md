---
title: Add and play podcasts
slug: podcasts
description: Add podcasts by name, RSS feed URL, or Apple Podcasts link, then browse and play their episodes.
---

Add podcasts to PodNotes, find their episodes, and play them.

## <span id="adding-podcasts"></span>Add a podcast

1. Open **Settings → PodNotes**.
2. Under **Search Podcasts**, type a podcast's name, such as `the daily`. Results appear as you type.
3. Next to the podcast, select **Add**.

Search uses the Apple Podcasts directory. To add a show by its address instead:

1. Copy its RSS feed URL or its Apple Podcasts show link. An RSS feed URL looks like `https://feeds.npr.org/510289/podcast.xml`.
2. Paste it into **Search Podcasts**.
3. Select **Add** on the one result that appears.

See [Which podcasts can I add?](/faq/#which-podcasts-can-i-add) and [Can I use a private feed?](/faq/#can-i-use-a-private-feed)

## Remove a podcast

1. Open **Settings → PodNotes**.
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

Above each list:

- **Search episodes** filters the list.
- **Refresh episodes** fetches new episodes in **Latest Episodes** and a podcast's list. In **Played**, it fetches the podcasts that have played episodes. In other playlists, it does nothing.
- **Hide played episodes** hides the episodes that PodNotes strikes through as played, and **Show played episodes** brings them back. The **Played** list always shows them.

The **Queue** list under the player has none of these controls.

<span id="how-many-latest-episodes-are-shown"></span>**Latest Episodes** shows and searches the 10 newest episodes of each podcast. To show up to 75, raise **Latest episodes per podcast** in **Settings → PodNotes**.

### When a feed cannot be reached

When PodNotes cannot fetch a podcast's feed, for example offline, the podcast's episode list shows **Feed didn't load** with a **Retry** button. PodNotes lists the episodes from the last copy of the feed on this device, however old the copy is. That copy is the one PodNotes fetched since Obsidian started, or the one it cached if **Cache podcast feeds** is on. Without a copy, PodNotes lists the podcast's downloaded episodes. If there are none, the list is empty.

For a private feed whose address is not on this device, the list shows **Address not on this device** and **Set feed address** instead. See [Use a private feed on another device](/private-feeds/#use-a-private-feed-on-another-device).

## <span id="player"></span>Play an episode

1. In an episode list, select an episode.

The player opens and resumes where you stopped last time. To return to the player from a list, select **Player**, the third button at the top of the view.

![The player with episode artwork, the episode title, the progress bar, and the skip buttons](/screenshots/player.webp)

- Select the artwork to play or pause. Select a point on the progress bar to jump there. The time on the left is how far you are, and the time on the right is how much is left.
- The skip buttons jump 15 seconds. **Skip backward length (s)** and **Skip forward length (s)** change that.
- The speed slider, below the volume slider, goes from 0.5x to 4x. The speed resets to **Default Playback Rate** each time Obsidian starts and each time a different episode loads.
- The episode keeps playing while you browse, change settings, or close the PodNotes view.
- When Obsidian starts, the player shows the episode you played last, paused at its saved position. It plays when you play it.
- A video plays in the player while the view is in the main window. When the view is in a popout window, the player there shows the episode's artwork, and the video keeps playing.
- When an episode's media cannot load, the player shows "Could not load this episode's media."
- **Chapters** lists the episode's chapters when it has them. Select a chapter to jump to it.

## <span id="playlists"></span><span id="reordering-the-queue"></span><span id="turning-off-the-queue"></span>Queue and playlists

The queue decides what plays next, and playlists collect episodes you want to keep together. [Use the queue and playlists](/playlists/) shows how to add and remove episodes, reorder the queue, and make your own playlists.

## <span id="context-menu"></span>Episode menu reference

To open an episode's menu, right-click the episode or select its **More options** button. The menu shows these items in this order:

| Item | What it does |
| --- | --- |
| **Play** | Plays the episode. |
| **Mark as Played** or **Mark as Unplayed** | Changes whether the episode counts as played. |
| **Download**, **Remove file**, or **Remove from Local Files** | Downloads the episode. **Remove file** deletes a download to the trash, and **Remove from Local Files** removes your own file from the list and keeps the file. See [Downloads and local files](/local_files/). |
| **Create Note** or **Open Note** | Creates or opens the episode note. See [Create episode notes](/notes/). |
| **Create feed note** or **Open feed note** | Creates or opens the note for the whole podcast. |
| **Add to Favorites** or **Remove from Favorites** | Adds the episode to **Favorites** or removes it. |
| **Add to Queue** or **Remove from Queue** | Adds the episode to the bottom of the queue or removes it. |
| **Move to top of queue**, **Move up in queue**, **Move down in queue**, **Move to bottom of queue** | Moves the episode within the queue. Shown only in the player's **Queue** list when the queue has two or more episodes, and only the directions the episode can move in. |
| **Add to** *playlist* or **Remove from** *playlist* | Adds the episode to that playlist or removes it. One item per playlist you made. |
