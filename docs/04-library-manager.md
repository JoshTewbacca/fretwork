# Library manager — desktop app for purchased tabs and audio

Planned 2026-08-02. Implements the ownership model in
[ADR-006](adr/ADR-006-library-ownership-and-sync.md).

The gap this closes: tabs bought as files have no route into the library. The PWA can search
the two free archives (ADR-005) and import a file through the phone's file picker, and that
is the whole of it. A `.gp` bought from mySongBook on the desktop sits in a folder doing
nothing. The same is true of any recording bought for a backing track, except worse, because
the audio half of the pipeline already exists and has no interface.

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
is possible, and mySongBook most likely ships exactly that format.

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

The piece that makes purchased tabs usable. Everything else is additive.

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

- A `.gp` dropped on the manager appears on the phone after one sync, renders, and plays.
- The existing phone library pushes up with ids preserved: practice history, passages and
  review state stay attached to every song afterwards (verified against the practice log,
  not just the library list).
- Editing `favourite`, `tags` and `defaultTrackIndex` on the phone, then syncing twice,
  leaves all three unchanged.
- Renaming a song on the desktop, then syncing, updates the phone.
- Archiving a song on the desktop hides it from the library and leaves its events intact —
  `GET /events/since/0` still returns them.
- Wipe IndexedDB entirely, sync, and the library comes back playable. This is ADR-003's
  catastrophic-eviction path, tested deliberately rather than discovered in the field.

## Slice 2 — store lookup

Search a title across mySongBook and the two free archives already integrated, show price,
format and availability side by side, and deep-link to the product page. A local ledger
records what was bought, where, and for how much, so the same tab is not paid for twice.

Scope was set at lookup and deep-link. **Purchases are not automated and paid files are not
fetched.** This is the same line ADR-005 drew when it dropped Songsterr: a store's paid
catalogue is the product being sold, and a tool that reaches past the checkout into it is
circumvention, not integration. Deep-linking to the page where the money is paid is
integration.

Musicnotes was considered and excluded. It sells PDFs, PDFs cannot drive the player, and the
only thing it would contribute is a weak "an official version exists somewhere" signal in
exchange for another scraper to maintain.

**Check mySongBook's robots.txt before writing any scraper.** gtptabs turned out to disallow
`/search/` for all agents, which was found late. If mySongBook does the same, the feature
degrades to constructing a search URL and opening it in the browser — less useful, still
worth having, and a fraction of the code.

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

**Buy one cheap mySongBook tab before slice 1 is built.** It answers three questions at once
that are otherwise all assumptions: what format actually lands on disk, whether the file is
account-locked or watermarked in a way only Guitar Pro opens, and whether alphaTab renders it
cleanly. If it turns out the files are not plainly readable, the drop-zone design survives
but the store-lookup slice loses most of its point, and it is far better to learn that for a
few dollars than after the pipeline is built around it.

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

Roughly 3 Sonnet task-runs (desktop endpoints and schema, manager window, store lookup) plus
Opus for the sync merge, the migration push and the ownership rules. Comparable to M1 in
size. Slice 1 alone is most of the value; slices 2 and 3 are independently deferrable and
neither blocks the other.
