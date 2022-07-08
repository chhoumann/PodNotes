# PodNotes

The one goal for PodNotes is to make it easier to write notes on podcasts.

Here's the features that'll help you do that 👇.

## Features
- Mobile friendly
- Podcast player built into Obsidian
- Add any publicly available podcast through search
- Track played episodes & playback progress
- API that can be used by plugins like [QuickAdd](https://github.com/chhoumann/QuickAdd) or [Templater](https://github.com/silentvoid13/Templater). With it, you can get
    - Episode title
    - Episode description
    - Episode URL
    - Episode podcast name
    - Episode publish date
    - A 'safe' filename for the episode (using the title)
    - Current playback time, both raw and formatted (with customn formatting). This can link to the episode at a given time, which PodNotes can pick up and play
- API allows controlling the player

## Installation
This plugin is currently not in the Obsidian plugin repository. Therefore, you'll need to install it manually.

### Installation with BRAT
BRAT is an Obsidian plugin that helps you test beta plugins and themes. Click [here](obsidian://show-plugin?id=obsidian42-brat) to install it in Obsidian.

Add `chhoumann/PodNotes` to BRAT with the `Add a beta plugin for testing` command.

Now follow the appropriate instructions, which most likely will have you go and enable the plugin once it has finished installing.

### Manual installation
Go to the [releases](https://github.com/chhoumann/podnotes/releases/latest) page.
Download `main.js` and `manifest.json`.
Create a new directory in your Obsidian vaults `.obsidian/plugins/` folder called `podnotes` and place the downloaded files there.

Now refresh the plugins in Obsidian and enable PodNotes.

## Screenshots
### Demo
![Demo](resources/demo.gif)

### Podcast Grid
![Podcast Grid](resources/podcast_grid.png)

### Episode List
![Episode List](resources/episode_list.png)

### Player
![Player](resources/player.png)

### Podcast Note Editing
![Podcast Note Editing](resources/podcast_note.png)

### Podcast search
![Podcast Search](resources/podcast_search.png)

