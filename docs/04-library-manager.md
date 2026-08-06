# Library manager — desktop app for tab files and audio

Planned 2026-08-02. Slice 1 built 2026-08-06. Implements the ownership model in
[ADR-006](adr/ADR-006-library-ownership-and-sync.md).

The gap this closes: a tab file on the desktop has no route into the library. The PWA can
search the two free archives (ADR-005) and import a file through the phone's file picker,
and that is the whole of it — anything on the desktop sits in a folder doing nothing. The
same is true of any recording meant for a backing track, except worse, because the audio
half of the pipeline already exists and has no interface at all.

**This was originally framed around bought tabs, and that framing was wrong.** See
"mySongBook does not sell files" below: no paid source of importable Guitar Pro files was
found. The manager is unaffected — it never cared where a file came from — but the store
integration that was to be slice 2 mostly evaporated, and this document has been corrected
rather than quietly reworded.

The stronger reason for the work was always the second one: `/manifest` could not describe a
library, so ADR-003's promise to rebuild after catastrophic eviction could not be kept. That
reason is untouched by any of this.

## Shape

One local web UI, served by the FastAPI app already in
[ingest/](../ingest/src/fretwork_ingest/api.py), wrapped in a pywebview window.

The window is what was asked for and is how it will be used day to day: drag a file on, it
lands in the library. Serving that UI over HTTP rather than building it into a native widget
toolkit costs nothing extra — the HTTP service is already running, already has the database
open, already serves the phone — and it means the same screen is reachable from the phone
over the tailnet without building it twice.

pywebview over Tauri: the service is Python, so pywebview adds one dependency and no second
toolchain. Tauri would add Rust and a separate build pipeline to a project whose stated cost
policy is to keep moving parts down.

### Parse dropped files with alphaTab, not a Python parser

The obvious implementation is a Python tab parser, and the obvious Python tab parser is
PyGuitarPro, which reads gp3/gp4/gp5 and does not read the GP6/7+ container formats. `.gp`
and `.gpx` are zip archives with a `score.gpif` XML document inside, so a hand-rolled reader
is possible — but it would be a second format implementation to keep in step with alphaTab's,
for formats the player already reads.

Better answer: the desktop UI is a web page in a browser engine, and alphaTab is already
vendored, already reads every format the player supports, and is already trusted because it
is what renders the score. Parse the dropped file client-side in the manager window, send
metadata and bytes to the API together.

One parser for the whole project, no second format implementation to keep in step with
alphaTab's, and no risk that the desktop accepts a file the player then cannot open. Whatever
alphaTab cannot read is rejected at the drop zone, which is the correct place to find out.

A user-editable confirm form sits behind it regardless: extracted titles from tab files are
frequently wrong or blank, the library is small and hand-curated, and typing an artist name
occasionally is not the bottleneck.

## Slice 1 — tab drop and phone sync

**Status: built 2026-08-06** (commits `7b471e2`, `ceb6b18`, `ff425ef`). Everything else is
additive.

| Work | Owner |
|---|---|
| `songs` table, blob/song write endpoints, `GET /library` | Sonnet, against ADR-006 |
| Manager window: drop zone, alphaTab parse, confirm form, song list | Sonnet |
| PWA library sync and the field-ownership merge | Opus |
| One-time push of the existing phone library | Opus |

The merge is Opus-owned for the same reason the practice fold was: a subagent writing both
the merge and its tests against one misreading of the ownership table produces a green suite
that silently overwrites practice state.

**Acceptance**

Verified against a running pair (dev server on localhost against the ingest service, which
works because that origin is already in the CORS list and an http page may call an http
desktop). Results read out of IndexedDB rather than off the screen.

- [x] A file dropped on the manager appears on the phone after one sync, with its tab
      downloaded. Verified with MusicXML written for the purpose.
- [x] A phone-originated song pushes up with its ULID and `added_at` preserved, so practice
      history stays attached and a migrated library keeps its real dates.
- [x] Editing `favourite`, `tags`, `lastPlayedAt`, corrections and `defaultTrackIndex` on the
      phone, then syncing a desktop-side rename, leaves all of them unchanged. Track index
      stayed on 3 while the desktop said 0 — the failure the seed-once category exists for.
- [x] Renaming on the desktop updates the phone.
- [x] Archiving hides the song from the library screen, keeps the row resolvable by name, and
      leaves practice events intact.
- [ ] The phone itself. Needs Tailscale (below); everything above was verified on a desktop
      browser against localhost.
- [ ] Wipe IndexedDB entirely, sync, and the library comes back **playable**. The rebuild path
      works; "playable" additionally needs a real Guitar Pro file, which waits on a source.
      This is ADR-003's catastrophic-eviction path and should be tested deliberately rather
      than discovered in the field.

## mySongBook does not sell files

Checked 2026-08-06 against the live site, before any of slice 2 was built.
`mysongbook.com` now redirects to `guitar-pro.com`, and the catalogue lives under
`/tabs/artists/{id}-{slug}` and `/tabs/t/{id}-{slug}`.

- **There is no per-tab purchase.** Pricing is subscription only: $5 one month, $40 twelve
  months, $60 twenty-four months. Tab pages carry no add-to-cart; the only purchase control
  on one is "Buy Guitar Pro".
- **Scores cannot leave the app.** Their FAQ, verbatim: "you can't edit, export, or save the
  scores." Reading them requires Guitar Pro 8 or the mobile app *and* an internet
  connection. Audio tracks are computer-only.

So there is no file to import. Not a locked-down file — no file at all. This is the same
shape as the Songsterr finding in ADR-005: the catalogue is the product, and it is delivered
in a way that keeps it inside the vendor's player.

**Three of three.** Songsterr and Ultimate Guitar were already excluded on this reasoning;
Musicnotes sells PDFs, which cannot drive the player. No paid source of importable Guitar Pro
files has been found. Worth stating plainly rather than leaving as an open action: the two
free archives, file import, and the owner's own corrections may simply be the ceiling for
where tabs come from, and the practice-side features are where the remaining value is.

The catalogue browses fine without an account, which is the one thing that survives.

## Slice 2 — availability lookup (much reduced)

What is left once there is nothing to buy: tell the owner whether an official transcription
exists for a song, and link to it. Useful as a quality signal — an official version existing
says the song is worth transcribing carefully — and as a pointer for anyone who does hold a
subscription and wants to read it in Guitar Pro alongside practising in Fretwork.

No price comparison, no purchase ledger, no deep-link to a checkout that does not exist.
That is most of the original slice gone, and it should be honestly reprioritised below
slice 3 rather than carried at its old size.

**If it is built, check robots.txt first.** gtptabs turned out to disallow `/search/` for
all agents and that was found late. Failing that check, the feature degrades to constructing
a search URL and opening it in the browser — a fraction of the code, and most of the value
given how little is left.

Purchases are not automated and paid content is not fetched, unchanged from the original
scope and now largely moot.

## Slice 3 — audio side

A UI over the scan, match and bundle flow that already exists as CLI commands. The review
queue for low-confidence matches already has an endpoint and a PWA screen; this gives it a
desktop face where the files actually are.

Nothing new architecturally, which is why it is last despite being the most nearly finished.

## Prerequisites and unknowns

**Tailscale is still not set up, and it is now blocking.** ADR-003's revision established
that an HTTPS page cannot call `http://192.168.x.x:8765`, so Tailscale Serve and its real
certificate are the only supported transport. That gated audio bundles before; under ADR-006
it gates the catalogue. Slice 1 cannot be demonstrated end to end without it, and the setup
is interactive and has to be done by the owner — the steps are in
[ingest/SETUP.md](../ingest/SETUP.md) §8.

**~~Buy one cheap mySongBook tab to find out what lands on disk.~~** Answered for free by
reading the site (above): nothing lands on disk, because nothing is sold as a file. Left
struck through rather than deleted because it was the right question, and the cost of
answering it by reading rather than by buying is the only reason it cost nothing.

**No real Guitar Pro file has been through the pipeline yet.** Everything so far was verified
with MusicXML written for the purpose, plus a deliberately corrupt `.gp5` to check the
rejection path. alphaTab reads both formats in the player already, so this is a small risk,
but it is not zero and it is worth closing with the first real `.gp` that arrives — most
likely one downloaded from the free archives, which the phone can already fetch.

**Apple Music is not a source of backing tracks.** The owner's music library is an Apple
Music library, which is DRM streaming content; the scanner is built to list and skip exactly
that, and this project does not implement DRM circumvention. Backing tracks need DRM-free
files — Bandcamp, Amazon MP3, iTunes Store purchases, or CD rips.

**Repo hygiene.** The repo is public. Purchased tabs and audio must never be committed.
Cover is already good: `.gitignore` ignores `*.gp`, `*.gp3`, `*.gp4`, `*.gp5` and `*.gpx`
by extension anywhere in the tree, plus `blobs/`, `ingest/blobs/` and `ingest/*.db`. The gap
to watch is a new data directory holding anything those extension rules miss — MusicXML, a
purchase ledger with order numbers in it, a store-lookup cache — which needs its own rule in
the same commit that introduces the directory, not afterwards.

## Cost

Slice 1 was built by Opus throughout rather than delegated as planned, which cost more per
token than the table above assumed. Slice 3 is the mechanical one and is a genuine
delegation candidate; slice 2 has shrunk to the point where the question barely arises.

Slice 1 was most of the value, as expected. Slice 2 is now small and low-value and should be
sequenced last or dropped; slice 3 is the one with real work left in it.
