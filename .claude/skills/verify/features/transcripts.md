# Transcripts

A user transcribes the current episode. When its feed publishes a transcript
(`<podcast:transcript>`), PodNotes writes it as timestamped paragraphs with no
API key and no call to a provider. Otherwise, and always through
`Transcribe current episode from audio`, it sends the audio to the provider
chosen under `Transcription provider`, with the user's key. A new install is on
ElevenLabs with `Speaker labels` on. The note goes to `Transcript path`, filled
from `Transcript template`, and opens.

## Sub-features

- `transcript-published` writes the feed's VTT, SRT or JSON transcript as timestamped paragraphs, with no key and no provider call.
- `transcript-select` picks VTT, then SRT, JSON, HTML and text, and resolves a relative transcript URL against the feed URL.
- `transcript-paid` keeps the audio path for an episode without a published transcript: the key notice without a key, the provider with one.
- `transcript-failed` shows the fetch failure when a published transcript cannot be loaded, names the audio command when a key is set, and sends nothing to a provider.
- `transcript-audio` transcribes the audio with the provider through `Transcribe current episode from audio`, even when a published transcript exists.
- `transcript-settings` shows `Transcription provider`, the chosen provider's API key row alone, `Model`, `Speaker labels` and, while those are on, `Speaker label format`. `Speaker labels` is disabled for a model without them.
- `transcript-elevenlabs` writes timestamped paragraphs with numbered speakers from one `scribe_v3` request. ElevenLabs gets the address of an episode a saved public feed lists, and the audio itself for a private feed's episode, a local file, and an address that carries a credential or is not public.
- `transcript-deepgram` does the same with `nova-3`.
- `transcript-openai` sends OpenAI the audio as `gpt-transcribe` uploads of at most 24 MB and 2,070 s, one at a time, and writes paragraphs without timestamps or speaker labels.
- `transcript-existing` refuses a second run while the note exists.

## How to get to it (user POV)

- With an audio episode loaded, run `PodNotes: Transcribe current episode` or `PodNotes: Transcribe current episode from audio` from the palette.
- Set the provider, its API key, the model, speaker labels, the path and the template in Settings > PodNotes under `Transcripts`. Timestamps follow `Timestamp template` under `Notes`: links for `{{linktime}}`, plain times for `{{time}}`.

## Driving it with ui.mjs

Preconditions:

- `FEED=$(node .claude/skills/verify/fixtures.mjs transcripts)` prints `http://podnotes.test:<port>/transcripts.xml`. Add `PodNotes Transcripts` through Settings as [feeds.md](./feeds.md) describes. Its episodes are `VTT Episode` (an HTML link, then a relative VTT link), `SRT Episode`, `JSON Episode`, `Untranscribed Episode` and `Broken Transcript Episode` (its VTT returns 404).
- No `transcripts/PodNotes Transcripts/` notes exist yet.
- `NET=node .claude/skills/verify/net.mjs`. Run `$NET watch` before each command, and again after an `app:reload`, which drops it. While it watches, the fixture provider answers ElevenLabs, Deepgram and OpenAI, so nothing is charged even with a key set.
- A fake key is a precondition, not a user path. For ElevenLabs: `CLI eval code='app.secretStorage.setSecret("podnotes-elevenlabs-api-key-424242", "sk-verify-fixture-not-real"), app.plugins.plugins.podnotes.settings.elevenLabsSecretId = "podnotes-elevenlabs-api-key-424242", app.plugins.plugins.podnotes.saveSettings(), "key set"'`. Deepgram and OpenAI take `podnotes-deepgram-api-key-424242` in `deepgramSecretId` and `podnotes-openai-api-key-424242` in `openAISecretId`.
- Choose a provider in Settings by focusing the `Transcription provider` dropdown with `UI click` and stepping with `UI key ArrowDown` or `UI key ArrowUp`, or as a precondition with `CLI eval code='app.plugins.plugins.podnotes.settings.transcript.provider = "openai", app.plugins.plugins.podnotes.settings.transcript.model = "", app.plugins.plugins.podnotes.saveSettings(), "chosen"'`.

- **Published.** Play `VTT Episode` ([player.md](./player.md)), then run `UI key Ctrl+p`, `UI type .prompt-input 'Transcribe current episode'` and `UI key Enter`. The exact command is the first suggestion; `--text 'Transcribe current episode'` matches both transcribe commands. The notices read `Queued "VTT Episode" for transcription. It will start automatically.` and, in the progress notice headed `Transcription: VTT Episode (00:00:00):`, `Saved the transcript the feed publishes.` `transcripts/PodNotes Transcripts/VTT Episode.md` opens. Its body starts `[00:00:00](obsidian://podnotes?episodeName=VTT%20Episode&url=...&time=0.48) From Potsdam in Brandenburg, Germany,`. `$NET log` lists `GET .../t/podnews.vtt` and nothing at `api.elevenlabs.io`, `api.deepgram.com` or `api.openai.com`. `node .claude/skills/verify/fixtures.mjs requests` has `/t/podnews.vtt`, not `/t/buzzcast.html`. Repeat with `SRT Episode` and `JSON Episode`.
- **Seek.** Switch to Reading view and click a timestamp. `api.currentTime` lands on its time.
- **Settings.** Open Settings > PodNotes. Under `Transcripts` a new vault shows `Transcription provider` on `ElevenLabs`, `ElevenLabs API key`, `Model` on `Recommended (Scribe v3)`, `Speaker labels` on, `Speaker label format`, then the path and template. Choosing `Deepgram` or `OpenAI` swaps the key row for that provider's and the model list for its models. On `OpenAI` the `Speaker labels` row is disabled and reads `GPT Transcribe does not label speakers.`
- **No published transcript.** Play `Untranscribed Episode` and run the command with no key. The notice is `Select or create an ElevenLabs API key in the transcript settings on this device.` and no note appears.
- **ElevenLabs.** With the fake ElevenLabs key, the fixture provider answers with two speakers, the second 12 s in, so the note reads `[00:00:00](...) **1:** This text came from the fixture provider.` and `[00:00:12](...) **2:** A second speaker answers.`
    - Public. Play `Fixture Episode 1` of `PodNotes Fixture` and run the audio command. `$NET log` shows one `POST https://api.elevenlabs.io/v1/speech-to-text` with a `multipart/form-data` `contentType`, under 1,000 `uploadBytes` and the episode's address as `sourceUrl`, and no request for `/episode-1.wav` after the command.
    - Private. `FEED=$(node .claude/skills/verify/fixtures.mjs private)` prints a feed at `priv3.supercast.com`. Add `PodNotes Private` and check that `data.json` saved it with a `urlSecretId`. Play its `Fixture Episode 1` and run the audio command. `$NET log` shows a `GET` for `/p/episode-1.wav`, then one `POST https://api.elevenlabs.io/v1/speech-to-text` with over 960,044 `uploadBytes` and no `sourceUrl`.
    - Local. Play `Fixtures/Local Fixture.wav` and run the audio command. The `POST` carries the file, with no `GET` before it and no `sourceUrl`.
    - Speaker labels off. Turn `Speaker labels` off and run the audio command on a new episode. The note has the timestamps and no `**1:**`.
- **Failed.** Play `Broken Transcript Episode` and run the command. The progress notice ends with `The published transcript could not be fetched: Network response returned HTTP 404.`, followed with a key by `Run "Transcribe current episode from audio" to transcribe it with ElevenLabs instead, which uses your API credit.` `$NET log` has the transcript GET (it records no status) and no provider call or `.wav`.
- **Audio command.** On the same episode, run `UI key Ctrl+p`, `UI type .prompt-input 'Transcribe current episode from audio'` and `UI click .suggestion-item --text 'from audio'`. With a key, the fixture provider answers.
- **Deepgram.** Choose `Deepgram` with its fake key. The notes read as for ElevenLabs.
    - Public. `$NET log` shows one `POST https://api.deepgram.com/v1/listen` with `contentType` `application/json` and under 100 `uploadBytes`, and no request for `/episode-1.wav` after the command.
    - Private. `$NET log` shows a `GET` for `/p/episode-1.wav`, then one `POST https://api.deepgram.com/v1/listen` with `contentType` `audio/wav` and the WAV's 960,044 `uploadBytes`.
- **OpenAI.** Choose `OpenAI` with its fake key. `Untranscribed Episode` downloads its WAV and `$NET log` shows a `POST https://api.openai.com/v1/audio/transcriptions` answered by the fixture provider. The note holds the fixture text with no timestamps.
    - In parts. Write an MP3 longer than 2,070 s into the vault, for example 70 min in 4 MB: `ffmpeg -f lavfi -i sine=frequency=440:duration=4200 -ac 1 -ar 8000 -b:a 8k "$VAULT/Fixtures/Long Fixture.mp3"`. Play it ([local-files.md](./local-files.md)) and run the audio command. `$NET log` shows three `POST https://api.openai.com/v1/audio/transcriptions` entries of about 1.4 MB each, one after the other, and the note holds the fixture text three times with no timestamps.
    - Speaker labels. With `Speaker labels` on, as in a library that labelled speakers with OpenAI on 2.24.0, the progress notice ends with `Saved without speaker labels, because OpenAI does not label speakers. These providers do: ElevenLabs, Deepgram.` and stays until clicked.
- **A 2.24.0 library.** Write a 2.24.0 `data.json` state into the vault (`transcript.diarization` with `enabled` and `provider`, no `transcript.provider`), run `CLI --reload`, and read `app.plugins.plugins.podnotes.settings.transcript.provider`: `deepgram` for speaker labels with Deepgram, `openai` for speaker labels with OpenAI or a linked OpenAI key, `elevenlabs` otherwise. `data.json` is unchanged until the next save, which adds `transcript.provider`, `transcript.model` and `elevenLabsSecretId` and leaves `transcript.diarization.provider` as it was.
- **Proof.** Screenshot the opened note (`npm run capture:e2e-obsidian -- screenshot .obsidian-e2e-artifacts/transcripts/note.png`), keep the note text, `$NET log` and `fixtures.mjs requests` for every run, and read `data.json` to show no new field.

## Gotchas

- Judge what a command fetched from `$NET log`. `fixtures.mjs requests` also shows audio the player streams on its own.
- To test the feed cache across a restart, reload inside Obsidian (`CLI --reload`, or `app:reload`). `npm run stop:e2e-obsidian` deletes the profile, and the cache with it.

- `net.mjs` sees `window.fetch` and `requestUrl`. The player streams audio through the media element, which only `fixtures.mjs requests` shows.
- A secret id must be `podnotes-<provider>-api-key` or `podnotes-<provider>-api-key-<n>`, where the provider is `elevenlabs`, `deepgram` or `openai`. Any other id reads as missing on this device.
- The progress notice hides about 5 s after a transcript is saved. A failure, or a transcript saved with a warning, stays until clicked. Notices also cover the PodNotes view's head and the full player's collapse button, and `ui.mjs` refuses a covered click, so dismiss them first.
- After editing `fixtures.mjs`, run `fixtures.mjs stop` before `fixtures.mjs transcripts`. A running server keeps serving the old routes.
- Every fixture transcript cue falls inside the 60 s WAV, so its links seek within the audio.
