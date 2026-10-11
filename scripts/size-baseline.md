# PERF0 byte and write-count baseline

Measured on `origin/master` at `0d82581`, then on the PERF0 scripts with the
same production artifact. Node 22.23.2, npm 10.9.8, Linux. The build uses
production Vite/Rolldown minification and includes injected Svelte CSS.

`npm run build && npm run size` passes.

```text
main.js raw: 306084 bytes; budget 330000 bytes; 23916 bytes remaining
main.js gzip (level 9): 96810 bytes; budget 100000 bytes; 3190 bytes remaining
```

Gzip uses Node's `gzipSync` at level 9, without a filename or timestamp.
Budgets use decimal bytes. The brief's 96,533-byte reference used a different
gzip implementation. This report fixes the compressor instead of comparing
compressed sizes across tools.

Five independent reads and gzip operations produced the same values, with
zero errors. Decompressing every result reproduced the original bundle.
The raw and gzip ranges were both zero bytes. These are byte measurements,
not startup or shared-runner timing claims.

For the rejection proof, copy production `main.js` and append a comment with
100,000 random bytes encoded as base64. Run the same CLI on that copy.
The copy is valid JavaScript, and root `main.js` remains untouched.

```text
$ npm run size -- .audit/inflated-main.js
.audit/inflated-main.js raw: 439426 bytes; budget 330000 bytes; OVER by 109426 bytes
.audit/inflated-main.js gzip (level 9): 197803 bytes; budget 100000 bytes; OVER by 97803 bytes
Exit status: 1
```

Separate CLI tests reject a gzip breach below the raw budget, accept the raw
boundary, reject one additional raw byte, and reject missing or empty builds.

## Large v2 document

Run `npm run size:data`. The frozen NPR fixture and workload are described in
[`tests/fixtures/persistence/README.md`](../tests/fixtures/persistence/README.md).
It contains 50 feeds, 2,000 history entries, 200 distinct saved episodes,
and 721 complete episode copies across downloads, Local files, playlists,
favorites, queue, and current episode. The production parser and v2 codec
validate it without warnings or dropped content.

The document is 5,593,476 compact UTF-8 bytes and 5,813,212 bytes in Obsidian's
two-space JSON format. Five generations produced identical sizes, with zero
errors and zero-byte ranges. The 1,500,000-byte goal is advisory. This workload
exceeds it by 4,313,212 bytes. No persistence budget or schema change is added.

| Collection                 | Compact bytes | data.json bytes |
| -------------------------- | ------------: | --------------: |
| savedFeeds                 |         42655 |           45611 |
| podNotes                   |         24712 |           28218 |
| playedEpisodes             |        450118 |          552124 |
| favorites                  |        732138 |          745579 |
| queue                      |        138946 |          141667 |
| playlists                  |       1389129 |         1421767 |
| downloadedEpisodes         |       1405250 |         1436606 |
| localFiles                 |       1403950 |         1434791 |
| currentEpisode             |          5377 |            5455 |
| Other settings and framing |          1201 |            1394 |

Identical repeated snapshots occupy 2,279,712 compact bytes. Description and
content JSON strings occupy 4,252,002 bytes across all copies. These diagnostics
overlap and do not promise removable savings. NPR publishes identical
description and content here; both fields remain intact.

Adding the real RSS guid as a hypothetical `podnotesGuid` field to every copy
adds 38,934 compact bytes and 46,540 two-space JSON bytes. Of that overhead,
17,334 compact bytes occur on identical repeated snapshots. The baseline has
no `podnotesGuid` field. An additive candidate comparison refuses existing
value changes, array changes, and collection membership changes.

The CLI prints every top-level collection and setting. Field rows plus a
separate framing row must equal the serialized document exactly. CI appends
both reports to the Test run's step summary.

## Real Obsidian write counts

Obsidian 1.13.7, Linux under Xvfb, isolated vault `podnotes-ci-size-budgets`.
The vault initially had no feeds or history. It links this worktree's root
production bundle. No shared dev vault was used.

```bash
npm run start:e2e-obsidian
npm run count:writes -- start
# Observe an idle window, or perform an awaited scenario.
npm run count:writes -- report
npm run count:writes -- stop
npm run obsidian:e2e -- dev:errors
npm run stop:e2e-obsidian
```

One 60-second idle observation recorded zero attempted writes. For the large
fixture, temporary runtime settings were passed through `saveSettingsStrict`.
The recorder observed one attempt, one completion, zero failures, and zero
in-flight writes. Its 5,813,212-byte count equaled the actual file size.
The persisted file retained 50 feeds, 2,000 history entries, and 200 downloads.
An unrelated vault-file write recorded zero PodNotes writes.

The recorder was removed, the original settings and on-disk document were
restored, and the fixture files were removed. Obsidian reported no captured
runtime errors. The isolated instance stopped successfully.

These counts cover this renderer's adapter writes to the exact PodNotes
`data.json` path. They exclude startup before installation, external sync
writers, and separate feed caches. Reloading the plugin invalidates a run.
One earlier observation was discarded because the plugin instance changed.

Obsidian's `writeJson` catches adapter failures. The recorder therefore wraps
the adapter's exact-path write and observes its rejection directly, rather
than treating a fulfilled `saveData` call as disk success. Propagating those
failures into PodNotes persistence is a follow-up for PERS1.
