# Episode notes

A user creates a note for the playing episode. PodNotes fills
`Note creation template` and writes it to `Note creation file path`, by default
`PodNotes/{{podcast}}/{{title}}.md`, then opens it. The note links back to the
episode with a `Resume in PodNotes` URI.

## Sub-features

- `note-create` creates and opens the note for the current episode ("Create episode note").
- `note-template` renders the template tags (`{{title}}`, `{{podcast}}`, `{{date}}`, `{{artwork}}`, `{{episodelink}}`, `{{url}}`, `{{description}}`).
- `note-existing` opens the existing note instead of overwriting it on a second run.
- `note-menu` creates or opens the note from an episode's `More options` menu (`Create Note` / `Open Note`).
- `feed-note` creates a note for a saved podcast ("Create podcast feed note").

## How to get to it (user POV)

- With an episode loaded, run `PodNotes: Create episode note` from the palette.
- In an episode list, click the episode's `More options` button, then `Create Note`.
- Edit the path and template in Settings > PodNotes under `Episode notes`.

## Driving it with ui.mjs

Preconditions:

- `Fixture Episode 1` is the current episode ([player.md](./player.md)).
- `PodNotes/PodNotes Fixture/Fixture Episode 1.md` does not exist yet.

- **Create.** Run `UI key Ctrl+p`, `UI type .prompt-input 'Create episode note'`, `UI click .suggestion-item --text 'Create episode note'`. `CLI eval code='app.workspace.getActiveFile()?.path'` is `=> PodNotes/PodNotes Fixture/Fixture Episode 1.md`.
- **Content.** Run `cat '.obsidian-e2e-vaults/podnotes-<worktree>/PodNotes/PodNotes Fixture/Fixture Episode 1.md'`. It has the frontmatter `type: podcastEpisode`, `podcast: "[[PodNotes/Podcasts/PodNotes Fixture|PodNotes Fixture]]"` and `date: 2026-10-09`, the heading `# Fixture Episode 1`, the artwork image, `[Resume in PodNotes](obsidian://podnotes?episodeName=Fixture%20Episode%201&url=...)` with no `time`, the feed URL, and the description.
- **Run it again.** Repeat the palette steps. The same file opens, and its content and modification time are unchanged.
- **From the menu.** Run `UI click '.podcast-view [aria-label="More options for Fixture Episode 2"]'`, then `UI click '.menu .menu-item' --text 'Create Note'`. `PodNotes/PodNotes Fixture/Fixture Episode 2.md` is created.
- **Proof.** Screenshot the opened note (`npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/notes/note.png`) and keep the `cat` output.

## Gotchas

- The palette lists `Create episode note` only while an episode is loaded and both the note path and template settings are non-empty.
- `{{podcastlink}}` in the default template links the feed note path, which does not exist until you run `Create podcast feed note`. An unresolved link in the new note is expected.
