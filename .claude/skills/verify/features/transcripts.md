# Transcripts

A user transcribes the current episode. When its feed publishes a transcript
(`<podcast:transcript>`), PodNotes writes it as timestamped paragraphs with no
API key and no call to OpenAI or Deepgram. Otherwise, and always through
`Transcribe current episode from audio`, it sends the audio to the configured
provider with the user's key. That is Deepgram when `Speaker diarization` is on
with Deepgram as the provider, and OpenAI otherwise. The note goes to
`Transcript path`, filled from `Transcript template`, and opens.

## Sub-features

- `transcript-published` writes the feed's VTT, SRT or JSON transcript as timestamped paragraphs, with no key and no provider call.
- `transcript-select` picks VTT, then SRT, JSON, HTML and text, and resolves a relative transcript URL against the feed URL.
- `transcript-paid` keeps the audio path for an episode without a published transcript: the key notice without a key, the provider with one.
- `transcript-failed` shows the fetch failure when a published transcript cannot be loaded, names the audio command when a key is set, and sends nothing to a provider.
- `transcript-audio` transcribes the audio with the provider through `Transcribe current episode from audio`, even when a published transcript exists.
- `transcript-openai` sends OpenAI the audio as `gpt-transcribe` uploads of at most 24 MB and 2,070 s, one at a time, and writes paragraphs without timestamps or speaker labels.
- `transcript-deepgram` writes timestamped paragraphs with numbered speakers. Deepgram gets the address of an episode a saved public feed lists, and the audio itself for a private feed's episode, a local file, and an address that carries a credential or is not public.
- `transcript-existing` refuses a second run while the note exists.

## How to get to it (user POV)

- With an audio episode loaded, run `PodNotes: Transcribe current episode` or `PodNotes: Transcribe current episode from audio` from the palette.
- Set the path, template and API keys in Settings > PodNotes under `Transcripts`. Timestamps follow `Timestamp template` under `Notes`: links for `{{linktime}}`, plain times for `{{time}}`.

## Driving it with ui.mjs

Preconditions:

- `FEED=$(node .claude/skills/verify/fixtures.mjs transcripts)` prints `http://podnotes.test:<port>/transcripts.xml`. Add `PodNotes Transcripts` through Settings as [feeds.md](./feeds.md) describes. Its episodes are `VTT Episode` (an HTML link, then a relative VTT link), `SRT Episode`, `JSON Episode`, `Untranscribed Episode` and `Broken Transcript Episode` (its VTT returns 404).
- No `transcripts/PodNotes Transcripts/` notes exist yet.
- `NET=node .claude/skills/verify/net.mjs`. Run `$NET watch` before each command. While it watches, the fixture provider answers OpenAI and Deepgram, so nothing is charged even with a key set.

- **Published.** Play `VTT Episode` ([player.md](./player.md)), then run `UI key Ctrl+p`, `UI type .prompt-input 'Transcribe current episode'` and `UI key Enter`. The exact command is the first suggestion; `--text 'Transcribe current episode'` matches both transcribe commands. The notices read `Queued "VTT Episode" for transcription. It will start automatically.` and, in the progress notice headed `Transcription: VTT Episode (00:00:00):`, `Saved the transcript the feed publishes.` `transcripts/PodNotes Transcripts/VTT Episode.md` opens. Its body starts `[00:00:00](obsidian://podnotes?episodeName=VTT%20Episode&url=...&time=0.48) From Potsdam in Brandenburg, Germany,`. `$NET log` lists `GET .../t/podnews.vtt` and nothing at `api.openai.com` or `api.deepgram.com`. `node .claude/skills/verify/fixtures.mjs requests` has `/t/podnews.vtt`, not `/t/buzzcast.html`. Repeat with `SRT Episode` and `JSON Episode`.
- **Seek.** Switch to Reading view and click a timestamp. `api.currentTime` lands on its time.
- **No published transcript.** Play `Untranscribed Episode` and run the command with no key. The notice is `Select or create an OpenAI API key in the transcript settings on this device.` and no note appears.
- **Key.** A fake key is a precondition, not a user path: `CLI eval code='app.secretStorage.setSecret("podnotes-openai-api-key-424242", "sk-verify-fixture-not-real"), app.plugins.plugins.podnotes.settings.openAISecretId = "podnotes-openai-api-key-424242", app.plugins.plugins.podnotes.saveSettings(), "key set"'`. With it, `Untranscribed Episode` downloads its WAV and `$NET log` shows a `POST https://api.openai.com/v1/audio/transcriptions` answered by the fixture provider.
- **Failed.** Play `Broken Transcript Episode` and run the command. The progress notice ends with `The published transcript could not be fetched: Network response returned HTTP 404.`, followed with a key by `Run "Transcribe current episode from audio" to transcribe it with OpenAI instead, which uses your API credit.` `$NET log` has the transcript GET (it records no status) and no provider call or `.wav`.
- **Audio command.** On the same episode, run `UI key Ctrl+p`, `UI type .prompt-input 'Transcribe current episode from audio'` and `UI click .suggestion-item --text 'from audio'`. With a key, the WAV is fetched and OpenAI (the fixture provider) answers.
- **OpenAI in parts.** Write an MP3 longer than 2,070 s into the vault, for example 70 min in 4 MB: `ffmpeg -f lavfi -i sine=frequency=440:duration=4200 -ac 1 -ar 8000 -b:a 8k "$VAULT/Fixtures/Long Fixture.mp3"`. Play it ([local-files.md](./local-files.md)) and run the audio command. `$NET log` shows three `POST https://api.openai.com/v1/audio/transcriptions` entries of about 1.4 MB each, one after the other, and the note holds the fixture text three times with no timestamps.
- **Deepgram.** Set a fake Deepgram key as above, with the id `podnotes-deepgram-api-key-424242` and the setting `deepgramSecretId`. In Settings turn on `Speaker diarization` and pick `Deepgram` under `Diarization provider`. The fixture provider answers with two speakers, the second 12 s in, so the note reads `[00:00:00](...) **1:** This text came from the fixture provider.` and `[00:00:12](...) **2:** A second speaker answers.`
    - Public. Play `Fixture Episode 1` of `PodNotes Fixture` and run the audio command. `$NET log` shows one `POST https://api.deepgram.com/v1/listen` with `contentType` `application/json` and under 100 `uploadBytes`, and no request for `/episode-1.wav` after the command.
    - Private. `FEED=$(node .claude/skills/verify/fixtures.mjs private)` prints a feed at `priv3.supercast.com`. Add `PodNotes Private` and check that `data.json` saved it with a `urlSecretId`. Play its `Fixture Episode 1` and run the audio command. `$NET log` shows a `GET` for `/p/episode-1.wav`, then one `POST https://api.deepgram.com/v1/listen` with `contentType` `audio/wav` and the WAV's 960,044 `uploadBytes`.
    - Local. Play `Fixtures/Local Fixture.wav` and run the audio command. The `POST` carries `audio/wav`, with no `GET` before it.
- **Speaker labels with OpenAI.** With `Speaker diarization` on and `OpenAI (no speaker labels)` as the provider, the progress notice ends with `Saved without speaker labels, because OpenAI does not label speakers. These providers do: Deepgram.` and stays until clicked.
- **Proof.** Screenshot the opened note (`npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/transcripts/note.png`), keep the note text, `$NET log` and `fixtures.mjs requests` for every run, and read `data.json` to show no new field.

## Gotchas

- Judge what a command fetched from `$NET log`. `fixtures.mjs requests` also shows audio the player streams on its own.
- To test the feed cache across a restart, reload inside Obsidian (`CLI --reload`, or `app:reload`). `npm run stop:e2e-obsidian` deletes the profile, and the cache with it.

- `net.mjs` sees `window.fetch` and `requestUrl`. The player streams audio through the media element, which only `fixtures.mjs requests` shows.
- A secret id must be `podnotes-openai-api-key` or `podnotes-openai-api-key-<n>`. Any other id reads as missing on this device.
- The progress notice hides about 5 s after a transcript is saved. A failure, or a transcript saved with a warning, stays until clicked. Notices also cover the PodNotes view's head and the full player's collapse button, and `ui.mjs` refuses a covered click, so dismiss them first.
- After editing `fixtures.mjs`, run `fixtures.mjs stop` before `fixtures.mjs transcripts`. A running server keeps serving the old routes.
- Every fixture transcript cue falls inside the 60 s WAV, so its links seek within the audio.
