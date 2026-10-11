---
title: Add and play podcasts
slug: podcasts
description: Add podcasts by name, RSS feed URL, or Apple Podcasts link, then browse, play, queue, and organize their episodes.
---

Add podcasts to PodNotes, find their episodes, and control what plays next.

## <span id="adding-podcasts"></span>Add a podcast

1. Open **Settings → PodNotes**.
2. Under **Search Podcasts**, type a podcast's name in the search box, such as `planet money`.
3. Next to the podcast, select **Add**.

![Search Podcasts in PodNotes settings with results for "planet money", each with an Add or Remove button](/screenshots/add-podcast.webp)

The search box also accepts a link:

- An RSS feed URL that starts with `https://` or `http://`, such as `https://feeds.npr.org/510289/podcast.xml`.
- An Apple Podcasts show link, such as `https://podcasts.apple.com/us/podcast/planet-money/id290783428`. PodNotes looks up the show's RSS feed.

Search uses the Apple Podcasts directory and shows up to 20 podcasts. If a show is missing, paste its RSS feed URL instead. [Which podcasts can I add?](/faq/#which-podcasts-can-i-add) explains what works.
For a paid or members-only feed, see [Can I use a private feed?](/faq/#can-i-use-a-private-feed)

## Remove a podcast

1. Open **Settings → PodNotes**.
2. Under **Search Podcasts**, clear the search box. It lists the podcasts you follow.
3. Next to the podcast, select **Remove**.

Removing a podcast leaves its episode notes, downloads, and playlist entries in place.

## <span id="episode-list"></span>Browse episodes

PodNotes opens on the podcast grid. The playlists come first, then one tile per podcast.

![The podcast grid with the Queue, Favorites, Local Files, and Played playlists above podcast artwork tiles](/screenshots/podcast-grid.webp)

- To see all of a podcast's episodes, select its artwork.
- To see a playlist's episodes, select the playlist.
- To see the newest episodes of every podcast in one list, select the list button in the top bar. From a podcast's or a playlist's list, select **Latest Episodes** at the top.

![Latest Episodes with the search box, the played toggle, the refresh button, and episodes with their dates](/screenshots/episode-list.webp)

Above each list, **Search episodes** filters it as you type. The eye button hides or shows played episodes, and the refresh button fetches new episodes. Played episodes are struck through.

### <span id="how-many-latest-episodes-are-shown"></span>Show more latest episodes

By default, **Latest Episodes** shows the 10 newest episodes of each podcast, and its search covers only those. To reach further back, raise **Latest episodes per podcast** in **Settings → PodNotes**, up to 75.
A podcast's own list always shows all of its episodes.

## <span id="player"></span>Play an episode

Select an episode to play it. The player opens and resumes where you stopped last time. To return to the player from a list, select the play button in the top bar.

![The player with episode artwork, the progress bar, skip buttons, volume and speed sliders, and the queue](/screenshots/player.webp)

- Select the artwork to play or pause. A video episode shows the video instead.
- Select a point on the progress bar to jump there. The left time is your position and the right time is what remains.
- The skip buttons jump back and forward 15 seconds. To change that, set **Skip backward length (s)** and **Skip forward length (s)**.
- The volume slider sets the volume, and PodNotes remembers it.
- The speed slider goes from 0.5x to 4x. Each time Obsidian starts, the speed resets to **Default Playback Rate**.
- **Chapters** lists the episode's chapters when it has them. Select a chapter to jump to it.

## Manage the queue

The **Queue** list under the player shows what plays next, top first. When an episode ends, the top episode in the queue starts.
When you switch to another episode, PodNotes puts the one you left at the top of the queue.

To add an episode yourself, right-click it or select its ⋮ button, then select **Add to Queue**. It goes to the bottom of the queue.

### <span id="reordering-the-queue"></span>Reorder the queue

In the player's **Queue** list, open an episode's menu and select **Move to top of queue**, **Move up in queue**, **Move down in queue**, or **Move to bottom of queue**.

To reorder a long queue, run **PodNotes: Reorder Queue**. It lists the whole queue with buttons to move or remove each episode. The command appears when the queue has two or more episodes.

### <span id="turning-off-the-queue"></span>Turn off the automatic queue

To fill the queue only by hand, turn off **Keep a queue of episodes you switch away from** in **Settings → PodNotes**.
PodNotes then stops adding the episode you switch away from, and stops starting the next queued episode when one ends. **Add to Queue** still works.
While the queue is empty, its tile and its list in the player are hidden.

## <span id="playlists"></span>Collect episodes in playlists

The podcast grid shows three more built-in playlists:

- **Favorites** holds the episodes you add with **Add to Favorites**.
- **Local Files** holds your downloads and your own media files. See [Downloads and local files](/local_files/).
- **Played** lists every episode you finished or marked as played. An episode that has left its feed stays here so you can mark it as unplayed.

To make your own playlist:

1. Open **Settings → PodNotes**.
2. Under **Playlists**, choose an icon from the dropdown.
3. In **Playlist name**, type a name, such as `Commute`.
4. Select **Add**.

To add an episode, open its menu and select **Add to Commute**. To delete a playlist, select its trash button under **Playlists**, then select the check button within two seconds.

## <span id="context-menu"></span>Episode menu reference

To open an episode's menu, right-click the episode or select its ⋮ button. The menu shows these items in this order:

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
| **Add to** or **Remove from** followed by a playlist name | Adds the episode to that playlist or removes it. One item per playlist you made. |
