# Published transcript fixtures

Real `<podcast:transcript>` files and the feeds that link them, retrieved on
2026-10-12. Each transcript is the start of the published file, cut at a cue or
paragraph boundary with its bytes unchanged, so line endings, leading spaces and
raw characters are what the host serves. `.oxfmtrc.json` excludes this folder
from formatting for that reason.

| File | Source | What it covers |
| --- | --- | --- |
| `podnews-2026-10-05.vtt` | <https://podnews.net/audio/podnews261005.mp3.vtt> | Leading space on every cue line, a raw unescaped `&` |
| `build-your-saas.vtt` | <https://share.transistor.fm/s/9c22a01c/transcription.vtt> | `<v Name>` voice tags on some cues and not others, a 30 s cue |
| `build-your-saas.srt` | <https://share.transistor.fm/s/9c22a01c/transcription.srt> | Multi-line cues, "Name:" speaker prefixes, cues 9 and 10 overlap |
| `build-your-saas.json` | <https://share.transistor.fm/s/9c22a01c/transcription.json> | Podcast namespace JSON with times as strings |
| `build-your-saas.txt` | <https://share.transistor.fm/s/9c22a01c/transcription.txt> | Plain text paragraphs with "Name:" prefixes and no times |
| `buzzcast.srt` | <https://www.buzzsprout.com/231452/19932962/transcript.srt> | Leading spaces before the first cue index |
| `buzzcast.json` | <https://www.buzzsprout.com/231452/19932962/transcript.json> | Word-level JSON with numeric times and separate `" "` segments |
| `buzzcast.html` | <https://www.buzzsprout.com/231452/19932962/transcript> | `<cite>`, `<time>` and `<p>` per turn, `&#39;` entities, runs of spaces |
| `adventures-in-devops.srt` | <https://links.adventuresindevops.com/storage/episodes/286/transcript.srt> | CRLF line endings |

The feeds keep the channel and its first item:

| File | Source | Transcript links |
| --- | --- | --- |
| `build-your-saas.xml` | <https://feeds.transistor.fm/build-your-saas> | VTT, SRT, JSON, text and HTML, in that order |
| `buzzcast.xml` | <https://feeds.buzzsprout.com/231452.rss> | HTML, JSON, SRT and VTT, in that order |
| `podcasting-2.0.xml` | <https://feeds.podcastindex.org/pc20.xml> | SRT only, typed `application/srt` |

None of 140 sampled transcripts from these hosts started with a byte order mark
or escaped a character as an entity in VTT or SRT, so tests derive those cases
from the files above.
