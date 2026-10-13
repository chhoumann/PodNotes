# Large v2 persistence fixture

`planet-money.xml` contains the channel and first four items retrieved from
<https://feeds.npr.org/510289/podcast.xml> on 2026-10-11. Episode descriptions,
content, dates, and enclosure URLs are retained. No media is downloaded.
`feed-sample.json` freezes the feed and episode projection PodNotes saves,
with each episode's guid in `guids`. The fixture test compares it with what
`FeedRepository` projects from the feed.
Long dashes use JSON escapes and XML character references outside CDATA to
preserve parsed feed text while following the repository's character rule.

`large-v2.mjs` expands the sample into a deterministic synthetic library.
Subscriptions have distinct numbered names and URLs. Each subscription has
40 history entries and four saved episodes. History uses the released
`podcastName::title` keys. The built-in playlists keep their default flags.

The library has 50 feeds, 2,000 history entries, 200 downloads mirrored into
Local files, 100 favorites, 20 queued episodes, four playlists of 50 episodes,
100 note mappings, and one current episode outside the queue. There are
200 distinct episodes and 721 persisted episode copies. NPR supplies the same
text in description and content. Both fields remain in every copy.

Run `npm run size:data` for the UTF-8 byte breakdown. The fixture round-trips
through the production v2 codec without warnings. The byte report measures
compact JSON and Obsidian's two-space JSON, independently of fixture file
formatting. It does not include media, localStorage feed caches, or transcripts
written as separate vault files.

To measure future optional fields, serialize `createLargeV2Fixture()` to a JSON
file, add the proposed fields to its persisted copies, and run
`npm run size:data -- path/to/candidate.json`. The comparison rejects changes
to existing values, array order, and collection membership. It reports added
bytes by collection. Repeated snapshot bytes and text bytes overlap and are
diagnostics, not additive totals or promised savings. Exact-snapshot groups
can split when metadata changes only one copy, so their byte delta can be
negative. The added-field totals in the table remain separate.

The default report also probes a hypothetical `podnotesGuid` field using the
real RSS guids. It reports the added bytes on all copies and the portion on
identical repeated snapshots. The baseline contains no such field.

The fixture deliberately stresses retained downloads and playlist overlap.
Its measured document size is a baseline for this workload, not a claim about
all users. The 1,500,000-byte document goal remains advisory.

# Released data.json fixtures

`released-2.20.0.json` and `released-2.21.1.json` are data.json files that the
2.20.0 and 2.21.1 sources encoded. Each tag's own `DEFAULT_SETTINGS` and
`encodePodNotesData` produced it from one private subscription, whose URL is a
placeholder with a `podnotes-feed-url-<uuid>` reference, and one of its
episodes in the current episode, the queue, favorites, and history. The
compatibility test loads them with the current code and requires them to stay
unchanged.
