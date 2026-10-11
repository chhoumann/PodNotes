# Timestamps and URIs

While an episode plays, a user captures the current time, or the last 10 or 20
seconds, into the open note. With a `{{linktime}}` format each capture is an
`obsidian://podnotes` link. Clicking it later reopens that episode at that
moment.

## Sub-features

- `ts-capture` inserts the formatted current time at the cursor ("Capture Timestamp").
- `ts-segment` inserts a linked range ending now ("Capture Last 10 Seconds", "Capture Last 20 Seconds").
- `ts-format` applies the `Capture timestamp format` and `Timestamp offset (s)` settings.
- `uri-open` reopens the linked episode at `time`, also after another episode played.
- `uri-segment` plays a linked range and stops at its end (`endTime`).
- `uri-errors` shows a Notice for a missing `url` or `episodeName`, or for a bad `time`.

## How to get to it (user POV)

- With a note open and an episode playing, run `PodNotes: Capture Timestamp` from the palette or a hotkey.
- Set the format in Settings > PodNotes > `Capture timestamp format`, for example `- {{linktime}} `.
- Click a captured link in Reading view or Live Preview.
- Open an `obsidian://podnotes?...` URI from outside Obsidian.

## Driving it with ui.mjs

Preconditions:

- `PodNotes Fixture` is saved ([feeds.md](./feeds.md)) and `Fixture Episode 1` is unplayed.
- A note exists and is open: `CLI create path='Verify/Timestamps.md' content='# Timestamps\n\n' open`.

- **Set a linked format.** Open Settings > PodNotes ([feeds.md](./feeds.md)), run `UI fill '.modal.mod-settings textarea[placeholder="- {{linktime}} "]' '- {{linktime}} '`, then close Settings. `data.json` `timestamp.template` is `- {{linktime}} `.
- **Play.** Start `Fixture Episode 1` ([player.md](./player.md)) and wait about 5 s.
- **Capture.** Run `UI click '.workspace-leaf-content[data-type="markdown"] .cm-content .cm-line:last-child'`, `UI key Ctrl+p`, `UI type .prompt-input 'Capture Timestamp'`, `UI click .suggestion-item --text 'Capture Timestamp'`. After about 2 s, `CLI read path='Verify/Timestamps.md'` has a line like `- [00:00:05](obsidian://podnotes?episodeName=Fixture%20Episode%201&url=...&time=5.73)`.
- **Segment.** Run the same palette steps with `Capture Last 10 Seconds`. The line holds a range such as `00:00:05-00:00:15` and its URI has `time` and `endTime`.
- **Open the link.** Let playback move on, run `CLI command id=markdown:toggle-preview` (Reading view), then `UI click '.markdown-reading-view a' --text '00:00:05'`. `api.podcast.title` is `Fixture Episode 1` and `api.currentTime` restarts from about 5.7 s. The instance log `<HOME>/Library/Logs/obsidian.log` shows `Received callback URL` and `Processed URI`.
- **Direct URI path.** Run `UI uri 'obsidian://podnotes?episodeName=Fixture%20Episode%201&url=<encoded feed URL>&time=30'`. `api.currentTime` jumps to about 30 s.
- **Proof.** Screenshot the note and the player after each step (`npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/timestamps/note.png`), and keep the `read` output that holds the captured line.

## Gotchas

- Capture commands are editor commands. The palette lists them only while a Markdown editor is focused, so click into the note first.
- The default format `- {{time}} ` inserts plain text with no link. Set `{{linktime}}` before proving links.
- Obsidian writes the note about 2 s after the edit. Read after a short wait, or read the editor with `CLI eval code='app.workspace.getLeavesOfType("markdown")[0].view.editor.getValue()'`.
- A clicked link leaves the app through `xdg-open` and comes back through Obsidian's single-instance handoff, which the Linux bridge sets up. Never run `xdg-open` yourself: it reaches the system Obsidian profile.
- `UI uri` decodes values with `decodeURIComponent`, as Obsidian does, so `+` stays a literal plus.
