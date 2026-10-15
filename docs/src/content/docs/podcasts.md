---
title: Add and play podcasts
slug: podcasts
description: Add podcasts by name, RSS feed URL, or Apple Podcasts link, then browse and play their episodes in the PodNotes view.
---

Add podcasts in the PodNotes view, find their episodes, and play them. To open the view, run **PodNotes: Show player** from the command palette, or select **Show PodNotes**, the podcast icon in the ribbon.

## <span id="adding-podcasts"></span>Add a podcast

When your library is empty, the PodNotes view shows **Add your first podcast** with a search field, so start at step 2.

1. In the PodNotes view, select **Add podcast**. In a narrow view, such as the sidebar, it is the plus button at the top of the Library. In a wide view, it is at the top of the list on the left.
2. Type a podcast's name, such as `the daily`. Results appear as you type.
3. Select the podcast.

PodNotes adds the podcast and opens its page.

Search uses the Apple Podcasts directory and shows up to 20 shows. To add a show by its address instead:

1. Copy its RSS feed URL or its Apple Podcasts show link. An RSS feed URL looks like `https://feeds.npr.org/510289/podcast.xml`.
2. In **Add podcast**, paste it into the search field.
3. Select the one result. Its second line starts with **RSS feed** or **podcasts.apple.com**.

A podcast you already follow has a check mark instead of a plus, and selecting it opens its page. See [Which podcasts can I add?](/faq/#which-podcasts-can-i-add) and [Use private feeds](/private-feeds/).

## Remove a podcast

1. Open the podcast's page.
2. Select **Podcast options**, the three-dot button at the top right.
3. Select **Remove podcast**.

You can also right-click the podcast's artwork in the Library and select **Remove podcast**. A notice says "Removed" and the podcast's name. To bring the podcast back, select **Undo** in the notice within seven seconds. If you miss the notice, [add the podcast](/podcasts/#add-a-podcast) again.

Removing a podcast removes nothing else. Its episode notes and downloaded files stay in your vault, and its episodes stay in the queue and your playlists. PodNotes also keeps your progress and played episodes, so they are there when you add the podcast again.

## <span id="episode-list"></span>Browse episodes

The Library is the top of the PodNotes view. In a narrow view, it lists **Latest episodes**, **Queue**, **Playlists**, **Local files**, and **Played**, and below them, under **Podcasts**, the artwork of every podcast you added. In a wide view, the same pages are in a list on the left, where **Podcasts** opens the artwork grid.

![The PodNotes Library in the sidebar, with the Latest episodes, Queue, Playlists, Local files, and Played rows above the artwork of seven podcasts](/screenshots/podcast-grid.webp)

To see a podcast's episodes, select its artwork. The podcast's page lists its episodes, newest first. To go back, select the back button at the top left, which names the page it returns to.

![A podcast's page with its artwork, the episode search field, and a list of episodes, one of them paused at 34 minutes left, above the mini player](/screenshots/episode-list.webp)

At the top of a podcast's page:

- **Search episodes** filters the list by title.
- **Hide played episodes** hides the episodes you finished, and **Show played episodes** brings them back. The choice applies to every podcast's page.
- **Refresh episodes** fetches the feed again.

Each episode shows its date and length, or the time left in it. A check mark means you finished it. Icons after the length show that it is downloaded or has a note.

Other pages list episodes from all your podcasts:

- <span id="how-many-latest-episodes-are-shown"></span>**Latest episodes** shows the 10 newest episodes of each podcast, newest first. To show up to 75, raise **Latest episodes per podcast** under **Library** in **Settings → PodNotes**. **Refresh all feeds**, at the top of the page, fetches every feed again.
- **Played** lists the episodes you finished, including ones that have left their feed. An episode that PodNotes can no longer find in any feed or list is dimmed, and its menu only has **Mark as unplayed**.

### When a feed cannot be reached

When PodNotes cannot fetch a podcast's feed, the podcast's page shows **Feed didn't load** with the feed's host name, or **Private feed** for a private feed, and a **Retry** button. In the Library, the podcast's artwork gets a warning badge.

PodNotes then lists the episodes from the last copy of the feed on this device, however old the copy is. PodNotes keeps a copy of each feed on this device, with its 75 newest episodes, and fetches the feed again when the copy is more than six hours old. With many podcasts, PodNotes keeps copies only of the feeds it fetched most recently. **Refresh episodes** and **Refresh all feeds** fetch at once. Without a copy, the page lists the podcast's downloaded episodes, and with none it shows **No episodes**.

Offline, PodNotes fetches nothing. The view shows **Offline** at the top, lists the episodes from each copy, and turns off the refresh buttons. When the device is online again, PodNotes fetches the feeds that have no copy or an old one. [Listen offline](/local_files/#listen-offline) shows what plays offline.

For a private feed whose address is not on this device, **Feed didn't load** comes with **Address not on this device** and a **Set feed address** button instead of **Retry**, also offline. Setting the address needs a connection. See [Use a private feed on another device](/private-feeds/#use-a-private-feed-on-another-device).

## <span id="player"></span>Play an episode

1. Select an episode.

PodNotes plays the episode from where you stopped and opens the full player over the view. When you select the episode that is already loaded, PodNotes opens the full player without changing playback. If the episode is paused, select **Play** there. [Use the player](/player/) covers the controls, the **Chapters**, **Transcript**, and **Up next** panels, and the mini player that stays at the bottom of the view.

## <span id="playlists"></span><span id="reordering-the-queue"></span><span id="turning-off-the-queue"></span>Queue and playlists

The queue decides what plays next, and playlists collect episodes you want to keep together. [Use the queue and playlists](/playlists/) shows how to add and remove episodes, reorder the queue, and make your own playlists.

## Reference

### <span id="context-menu"></span>Episode menu reference

To open an episode's menu, right-click the episode, or select the three-dot button at the end of its row. Episodes on the Queue page and in **Up next** have no three-dot button, so right-click them, open their menu from another list that holds them, or use **Episode options** in the full player while the episode is loaded. The menu shows these items in this order:

| Item | What it does |
| --- | --- |
| **Play** or **Open player** | Plays the episode and opens the full player. For the loaded episode, only opens the full player. |
| **Add to queue** or **Remove from queue** | Adds the episode to the end of the queue, or removes it. |
| **Create note** or **Open note** | Creates or opens the episode note. See [Create episode notes](/notes/). |
| **Download**, **Remove download**, or **Remove from Local files** | Downloads the episode. **Remove download** moves the downloaded file to the trash, and **Remove from Local files** removes your own file from **Local files** and keeps the file. See [Downloads and local files](/local_files/). |
| **Add to Favorites** or **Remove from Favorites** | Adds the episode to **Favorites**, or removes it. |
| **Add to playlist** | Opens a list of your playlists, with a check mark on each one that holds the episode. Select a playlist to add or remove the episode, or **New playlist** to make one that holds it. |
| **Mark as played** or **Mark as unplayed** | Changes whether the episode counts as played. |
| **Copy episode link** | Copies a link that resumes the episode in PodNotes. It is missing when the link would show a private feed's address. |

The full player's **Episode options** menu has the same items, except **Play** and **Mark as played**.

### Podcast menu reference

To open a podcast's menu, select **Podcast options** on its page, or right-click its artwork in the Library. The menu shows these items in this order:

| Item | What it does |
| --- | --- |
| **Create podcast note** or **Open podcast note** | Creates or opens the note for the whole podcast. See [Create a podcast note](/notes/#create-a-podcast-note). |
| **Copy feed URL** | Copies the feed's address. Only for a feed that is not private. |
| **Set feed address** | Asks for a private feed's address when it is not on this device. Turned off offline. |
| **Edit feed URL** | Changes the address of a feed that is not private, when PodNotes cannot load it. Turned off offline. |
| **Remove podcast** | Removes the podcast, with **Undo** in the notice. |
