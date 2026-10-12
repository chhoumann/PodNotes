---
title: Use with QuickAdd
slug: QuickAdd
legacyTitleId: quickadd
description: Call the PodNotes API from QuickAdd to capture timestamps with comments and create episode notes from your own template.
---

Build your own capture and note workflows with the [QuickAdd](https://quickadd.obsidian.guide/docs/) plugin and the [PodNotes API](/api/), such as a comment next to each timestamp or a note template that asks you questions. PodNotes alone [captures timestamps](/timestamps/) and [creates episode notes](/notes/).

## <span id="timestamp-capture"></span>Capture a timestamp with a comment

A Capture choice, with no macro, writes a timestamp link and your comment on a new line below the cursor:

```md
- [00:12:41](obsidian://podnotes?...) Why tariffs raise prices
```

1. In **Settings → QuickAdd**, select **New choice**.
2. Select **Capture**.
3. Set **Name** to `Podcast timestamp`.
4. Turn on **Capture to active file**.
5. Set **Write position** to **New line below cursor**.
6. In **Capture format**, enter:

   ````md
   - ```js quickadd
   const podnotes = this.app.plugins.plugins.podnotes.api;
   return podnotes.getPodcastTimeFormatted("HH:mm:ss", true);
   ``` {{VALUE}}
   ````

7. Play an episode in PodNotes.
8. Open the note you want to write in, in editing view, and place the cursor where the timestamp goes.
9. Run **QuickAdd: Run**.
10. Select `Podcast timestamp`.
11. Type your comment.

The `js quickadd` [inline script](https://quickadd.obsidian.guide/docs/InlineScripts/) returns the playback time, and `true` makes it a link. For other formats, use the [time tokens](/timestamps/#time-formats). To subtract reaction time, pass seconds as a third argument. To capture 5 seconds earlier, the script's `return` line becomes:

```js
return podnotes.getPodcastTimeFormatted(
	"HH:mm:ss",
	true,
	5,
);
```

Without a loaded episode, the call fails with `No podcast loaded`.

To run the capture from a hotkey:

1. In **Settings → QuickAdd**, select **Command palette: Podcast timestamp**, the lightning icon next to the choice.
2. In **Settings → Hotkeys**, assign a hotkey to **QuickAdd: Podcast timestamp**.

QuickAdd's [Capture docs](https://quickadd.obsidian.guide/docs/Choices/CaptureChoice/) describe the other options.

## <span id="add-podcast-note"></span>Create an episode note from your own template

This macro runs a user script that saves the loaded episode's fields as QuickAdd variables. A Template choice then fills your template with them and asks you for the rest.

1. QuickAdd cannot read scripts in `.obsidian` or other hidden folders. In a visible folder of your vault, create `scripts/podnotes-episode.js`:

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

3. In **Settings → QuickAdd**, select **New choice**.
4. Select **Macro**.
5. Set **Name** to `Podcast episode note`.
6. On the **Podcast episode note** page, under **Commands**, next to **User scripts**, select **Browse**.
7. Select `scripts/podnotes-episode.js`.
8. In the command bar, select **Template**. QuickAdd adds **Untitled Template Choice** after the script.
9. Select **Configure Untitled Template Choice**, the gear icon next to it.
10. Set **Template path** to `Templates/Podcast episode.md`.
11. Set **File name** to `{{VALUE:fileName}}`.
12. Load an episode in PodNotes. It can be paused.
13. Run **QuickAdd: Run**.
14. Select `Podcast episode note`.

QuickAdd asks you for `guest`, which the script does not set. For the other episode fields, see [`podcast`](/api/#podcast).

PodNotes finds an episode note only at **Note creation file path**, or by the episode title in that folder. **Open Note**, **PodNotes: Create episode note**, and headset capture do not find a note that QuickAdd saves anywhere else. QuickAdd's [Macros](https://quickadd.obsidian.guide/docs/Choices/MacroChoice/) and [User Scripts](https://quickadd.obsidian.guide/docs/UserScripts/) docs describe the macro settings.

## Send a transcript to an AI prompt

This macro returns a prompt with the current episode's transcript, for QuickAdd's AI Assistant. It reads the episode's transcript note, so [transcribe the episode](/transcripts/) first.

1. In a visible folder of your vault, save the script from [QuickAdd AI prompt example](/api/#quickadd-ai-prompt-example) as `scripts/podnotes-transcript-prompt.js`.
2. In **Settings → QuickAdd**, select **New choice**.
3. Select **Macro**.
4. Set **Name** to `Transcript prompt`.
5. On the **Transcript prompt** page, under **Commands**, next to **User scripts**, select **Browse**.
6. Select `scripts/podnotes-transcript-prompt.js`.
7. In a prompt template for QuickAdd's AI Assistant, insert `{{MACRO:Transcript prompt}}`. QuickAdd runs the macro and puts its prompt there.
