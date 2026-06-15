## Adding podcasts
You can add podcasts by searching for them in the podcast search box in settings.
This searches the iTunes podcast repository.

It is also possible to add custom podcast feeds by pasting the feed URL in the search box.
PodNotes will try to parse the feed, and if successful, will prompt you to add it to your saved feeds.


## Playlists
PodNotes can create playlists, which are lists of episodes.
For each playlist, you can specify a name and an icon.

The playlists are shown in the episode grid, represented by their icons.

By default, you will have a queue playlist and a favorites playlist.

The queue plays from top to bottom: the episode at the top is played next. See [Reordering the queue](#reordering-the-queue) to resequence it.

PodNotes also shows a Played playlist in the episode grid. It is a virtual playlist that lists episodes marked as played across all podcasts. Episodes still available in your feeds can be played or managed like normal episodes. Older played-history entries that can no longer be found in current feeds remain visible so you can mark them as unplayed.

You can delete playlists by pressing the trash bin icon next to the playlist name.
The icon will change to a checkmark, which should be pressed within a short duration to confirm the deletion.

## Episode list
The episode list is a dynamic view, which will change depending on your selection.

If you have no podcast selected, the episode list will show the latest episodes of all your saved feeds.

If you have a podcast selected, the episode list will show all episodes of that podcast.

And lastly, if you select a playlist, the episode list shows all episodes in that playlist.

## Context menu
You can right-click (desktop) or long-press (mobile) on an episode in the episode list to open the context menu.

The context menu will let you

- Play the episode
- Mark the episode as played
- Download / remove the episode
- Add / remove the episode to favorites
- Add / remove the episode to queue
- Add / remove the episode to a playlist

When you open the context menu on an episode in the queue list (shown in the player), it also offers **Move to top / up / down / bottom of queue** so you can resequence without leaving the player.

## Reordering the queue
The queue plays from the top down, so its order is its play order. There are two ways to change it:

- **From the player's queue list:** right-click (desktop) or long-press (mobile) a queued episode and choose **Move to top**, **Move up**, **Move down**, or **Move to bottom of queue**.
- **From the command palette:** run **PodNotes: Reorder Queue** to open a dedicated window listing the whole queue, where each episode has move-up / move-down / move-to-top / move-to-bottom buttons (and a remove button). This works the same on desktop and mobile and is the easiest way to resequence a long queue.

The new order is saved automatically and restored the next time you open Obsidian.

Episodes in the queue are kept unique by title, so adding an episode that is already queued will not create a duplicate.

## Turning off the queue
By default the queue fills itself: when you switch to a new episode, the one you were listening to is kept at the top of the queue, and playback continues with the next queued episode when the current one ends.

If you would rather manage the queue yourself, turn off **Keep a queue of episodes you switch away from** in PodNotes settings. With it off:

- episodes are no longer added to the queue automatically when you switch, and
- playback no longer advances to the next queued episode on its own.

You can still add, remove, and reorder episodes in the queue manually from the episode context menu. While the queue is empty in this mode, its tile in the podcast grid and its list in the player are hidden.

## Player
The player will automatically load and play the current episode.

Clicking on the epsiode image will toggle episode playback.

The player also features a progress bar, which you can use to seek to a specific time in the episode.
You can also press the buttons on the player to skip backwards or forwards in the episode.

Episode playback rate can be controlled by using the playback rate slider.
This is, by default, what you have set in the settings.
