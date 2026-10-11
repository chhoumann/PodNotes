---
title: Use with QuickAdd
slug: QuickAdd
legacyTitleId: quickadd
description: Call the PodNotes API from QuickAdd to capture timestamps with comments and create episode notes from your own template.
---

Build your own capture and note workflows with the [QuickAdd](https://quickadd.obsidian.guide/docs/) plugin and the [PodNotes API](/api/).
PodNotes already captures timestamps and creates episode notes on its own. See [Capture timestamps](/timestamps/) and [Create episode notes](/notes/).
Use QuickAdd when you want more, such as a comment prompt next to each timestamp, or a note template that asks you questions.

## <span id="timestamp-capture"></span>Capture a timestamp with a comment

This Capture choice asks for a comment and writes it after a timestamp link, on a new line below the cursor:

```md
- [00:12:41](obsidian://podnotes?...) Why tariffs raise prices
```

1. In **Settings → QuickAdd**, select **New choice**, then **Capture**.
2. Set **Name** to `Podcast timestamp`.
3. Turn on **Capture to active file**.
4. Set **Write position** to **New line below cursor**.
5. In **Capture format**, enter:

   ````md
   - ```js quickadd
   const podnotes = this.app.plugins.plugins.podnotes.api;
   return podnotes.getPodcastTimeFormatted("HH:mm:ss", true);
   ``` {{VALUE}}
   ````

6. Play an episode in PodNotes.
7. Open the note you want to write in.
8. Run **QuickAdd: Run** and select `Podcast timestamp`.
9. Type your comment.

The `js quickadd` block is a QuickAdd [inline script](https://quickadd.obsidian.guide/docs/InlineScripts/). It returns the current playback time, and `true` makes it a link that opens PodNotes at that moment.
To change the time format, use the tokens in [Time formats](/timestamps/#time-formats).
To subtract reaction time the way **Timestamp offset (s)** does, pass the seconds as a third argument: `getPodcastTimeFormatted("HH:mm:ss", true, 5)`.
Without a loaded episode, the call fails with `No podcast loaded`.

To run the capture from a hotkey, select the lightning icon next to the choice in **Settings → QuickAdd**, then assign a hotkey in **Settings → Hotkeys**.
QuickAdd's [Capture docs](https://quickadd.obsidian.guide/docs/Choices/CaptureChoice/) describe every option.

## <span id="add-podcast-note"></span>Create an episode note from your own template

This macro creates an episode note from a QuickAdd template, so QuickAdd can ask you questions while it creates the note.
A user script reads the loaded episode from `api.podcast` and saves its fields as QuickAdd variables. A Template choice in the same macro uses them.

1. In your vault, create `scripts/podnotes-episode.js`. Keep it out of `.obsidian` and other hidden folders, or QuickAdd cannot find it.

   ```js
   module.exports = async (params) => {
   	const episode = params.app.plugins.plugins.podnotes?.api?.podcast;
   	if (!episode) params.abort("Load an episode in PodNotes first.");

   	params.variables.title = episode.title;
   	params.variables.podcast = episode.podcastName;
   	params.variables.url = episode.url;
   	params.variables.artwork = episode.artworkUrl ?? "";
   	params.variables.fileName = episode.title.replace(/[\\\/:*?"<>|#^[\]]/g, "");
   };
   ```

2. Create `Templates/Podcast episode.md`:

   ```md
   ---
   podcast: "{{VALUE:podcast}}"
   guest: "{{VALUE:guest}}"
   ---
   # {{VALUE:title}}

   ![]({{VALUE:artwork}})

   {{VALUE:url}}

   ## Notes
   ```

3. In **Settings → QuickAdd**, select **New choice**, then **Macro**.
4. Set **Name** to `Podcast episode note`.
5. In the Macro Builder, under **User scripts**, select **Browse**, then select `scripts/podnotes-episode.js`.
6. In the command bar, select **Template**. QuickAdd adds a Template choice after the script.
7. Select the gear icon next to the new Template choice.
8. Set **Template path** to `Templates/Podcast episode.md`.
9. Set **File name** to `{{VALUE:fileName}}`.
10. Load an episode in PodNotes. It can be paused.
11. Run **QuickAdd: Run** and select `Podcast episode note`.

QuickAdd fills in the episode's fields. The script does not set `guest`, so QuickAdd asks you for it.
The `fileName` variable is the episode title without the characters a file name cannot hold.
For the other fields of `api.podcast`, see [`podcast`](/api/#podcast).

PodNotes finds an episode note only at **Note creation file path**, or by the episode title in that folder.
**Open Note**, **PodNotes: Create episode note**, and headset capture do not find a note that QuickAdd saves anywhere else.
QuickAdd's [Macros](https://quickadd.obsidian.guide/docs/Choices/MacroChoice/) and [User Scripts](https://quickadd.obsidian.guide/docs/UserScripts/) docs describe the Macro Builder in full.

## Send a transcript to an AI prompt

To summarize an episode with QuickAdd's AI Assistant, use the script in [QuickAdd AI prompt example](/api/#quickadd-ai-prompt-example).
It reads the episode's transcript note, so transcribe the episode first. See [Transcribe episodes](/transcripts/).
