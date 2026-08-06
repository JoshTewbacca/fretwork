# ADR-006: Library ownership and desktop sync

Status: **accepted and implemented 2026-08-06**. Raised when tab files bought as files
needed a route into the library, which the architecture had no path for.

**Note on the trigger, added 2026-08-06.** The prompt for this ADR was mySongBook, which
turned out not to sell files at all — it is subscription-only and its scores cannot be
exported (evidence in [04-library-manager.md](../04-library-manager.md)). The decision below
is unaffected and was implemented as written. Two reasons it still stands: the manager never
cared where a file came from, so file import from any source is served identically; and the
stronger argument was always the third one in the context below, which has nothing to do
with buying anything.

## Context

The desktop service has no concept of a song. [api.py](../../ingest/src/fretwork_ingest/api.py)
says so in its own header: "the desktop schema has no `songs` table (song metadata lives in
the PWA's IndexedDB) — the desktop only knows a song_id once a match links it to a
fingerprint." Everything the phone knows about its library lives in IndexedDB and nowhere
else.

Three things follow from that, and the third is the one that forces this decision.

**1. A tab file on the desktop cannot reach the phone.** Tabs enter the library through the
PWA only: the Edge-function search added in ADR-005, or the local file picker. A `.gp`
sitting in a folder on the desktop has no route in at all. The phone would have to be the
thing that imports it, which defeats the point of working at a desk.

**2. `/manifest` describes audio, not a library.** It is built from `matches` rows, so a song
appears in it only once a recording has been matched to that song id. The milestone plan is
explicit that songs without bundles are "the normal case", which means the manifest today
describes a minority of the library by design.

**3. ADR-003's disaster path cannot actually run.** ADR-003 commits to this: on catastrophic
eviction, "the app rebuilds the library from the desktop manifest and the practice-event
mirror." Checked against what `/manifest` returns — `song_id`, `fingerprint`,
`match_status`, `confidence`, the matched recording's tags, and bundles — there is no
`tabBlobHash`, no `tabFormat`, no song title or artist of its own, no `defaultTrackIndex`,
no `targetTempoBpm`. A rebuild from this produces song ids with audio attached and no way to
render or play any of them.

That is not a gap in the new feature. It is an existing promise the system cannot keep, and
the fix for it and the fix for desktop-side files are the same fix. This is the reason that
survived the trigger turning out to be wrong, and in hindsight it was always the stronger of
the two.

## Decision

**The desktop holds the durable catalogue. The phone may originate songs, and pushes them
up.**

This is deliberately not the two-way merge that was considered and rejected. There is no
merge algorithm here because there are no conflicts to resolve: a song originates in exactly
one place, carries a ULID from birth that is never reassigned, and every field has exactly
one owner. What makes it survivable is the ownership split, not reconciliation.

### Schema

```sql
-- The catalogue. Mirrors the PWA's Song (app/src/core/types.ts) for the fields
-- the desktop owns; deliberately does not mirror the ones it does not.
CREATE TABLE songs (
  id TEXT PRIMARY KEY,               -- ULID, generated wherever the song originated
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  source_id TEXT NOT NULL,           -- 'purchased' | 'gprotab' | 'guitarprotabs' | 'file' | ...
  source_external_id TEXT,
  source_url TEXT,
  tab_blob_hash TEXT NOT NULL,       -- sha256, resolvable via GET /blob/{hash}
  tab_format TEXT NOT NULL,          -- gp3|gp4|gp5|gpx|gp|musicxml
  default_track_index INTEGER,       -- seed value only; see ownership table
  target_tempo_bpm INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL        -- drives incremental sync
);
```

`SourceId` gains `'purchased'`. Per the header on
[app/src/core/types.ts](../../app/src/core/types.ts), that change lands in
[01-data-model.md](../01-data-model.md) at the same time.

### Field ownership

Three categories, not two. The third is where this would otherwise go wrong.

| Field | Owner | Sync behaviour |
|---|---|---|
| `title`, `artist`, `album` | Desktop | Overwritten on every sync |
| `source`, `tabBlobHash`, `tabFormat` | Desktop | Overwritten on every sync |
| `targetTempoBpm` | Desktop | Overwritten — it is derived from the tab file |
| `audioBundleId` | Desktop | Overwritten — bundles are produced desktop-side |
| `defaultTrackIndex` | **Seed-once** | Written only when the song is new to the phone |
| `favourite`, `tags`, `lastPlayedAt` | Phone | Desktop never sends these |
| `correctedTabBlobHash`, `correctionsBaseHash` | Phone | Desktop never sends these |

`defaultTrackIndex` is the field that breaks a naive two-category model. The desktop can
make a reasonable guess when a file is dropped, but the real answer is "the part I actually
play", and that is discovered on the phone during practice. Overwriting it on every sync
would silently reset the player's track selection; refusing to ever set it would leave new
songs with no sensible default. It is seeded once and then belongs to the phone.

Local tab corrections are phone-owned and never transmitted in v1. Design rule 3 in
[01-data-model.md](../01-data-model.md) already says the tab file is immutable and
corrections live beside it, so a desktop overwrite of `tabBlobHash` leaves
`correctionsBaseHash` mismatched and the existing "corrections were made against an older
revision" path handles it. That path already exists; this decision does not need a new one.

### Deletion never destroys practice history

Deleting a song on the desktop sets `archived = 1`. The manifest keeps returning it; the
phone hides it from the library and stops queueing its blobs, but keeps its passages,
review state and events.

This falls directly out of ADR-003 principle 1 — "losing audio is an inconvenience; losing
practice history is unacceptable". A sync that can hard-delete rows is a sync that can
destroy months of practice data because of a mistyped click in a desktop window, and no
amount of confirmation dialog makes that an acceptable failure mode.

### API surface

```
GET    /library            -> the full catalogue, each song with its bundles
POST   /blob               -> raw bytes; server computes the sha256 and returns it
POST   /songs              -> upsert one song record by id (idempotent)
DELETE /songs/{id}         -> archive (never a row delete)
```

`GET /manifest` is left exactly as it is and marked deprecated. It is not versioned or
extended in place: the phone can be running a service-worker-cached build from before this
change (ADR-003 uses skip-waiting-on-reload, so a stale build is normal, not exceptional),
and a stale build parsing a changed `/manifest` is a broken library screen with no error
message. A new endpoint costs one route and cannot break a build that has never heard of it.

`POST /blob` computes the hash from the received bytes rather than trusting a
client-supplied one, and caps the request body. The blob store is content-addressed
([01-data-model.md](../01-data-model.md) design rule 1) and a store where the key is not
provably the hash of the value is not content-addressed at all.

### Migration of the existing phone library

No dedicated endpoint. The one-time push is the phone calling `POST /blob` then `POST /songs`
once per song it already holds, **reusing its existing ULIDs**. Passages, review state and
events are all keyed by those ids, so preserving them is what keeps practice history
attached. Re-running the push is harmless because both endpoints are idempotent.

## Consequences

- **The desktop becomes a prerequisite for adding songs, but never for practising them.**
  ADR-003 principle 3 is preserved unchanged: everything already in the library plays with
  the desktop switched off.
- **Tailscale moves from prerequisite-for-audio to prerequisite-for-the-library.** ADR-003's
  2026-07-27 revision already found that an HTTPS page cannot call a plain LAN address, so
  Tailscale Serve is the only supported transport. It is still not set up. That was
  tolerable when it gated audio bundles; it now gates the catalogue, and this work cannot be
  finished without it.
- **The phone stays a valid entry point.** ADR-005's Edge-function search is untouched and
  still works anywhere without the desktop awake; a song added that way simply uploads when
  the desktop is next reachable. Losing that would have been a real regression, since
  searching for a tab is something done away from the desk.
- **ADR-003's catastrophic-eviction path becomes true.** `GET /library` plus
  `GET /events/since/0` reconstructs a playable library, which is what that ADR always
  claimed and could not do.
- **The API now accepts writes that create library content.** It remains unauthenticated and
  tailnet-only, which is the documented v1 trust boundary, but the header comment in
  `api.py` describing a read-oriented service stops being accurate and must be rewritten
  rather than left to mislead.
- **Storage cost on the phone is unchanged in practice.** Tab files are tens to hundreds of
  KB; the 4 GB budget in ADR-003 is dominated by audio and is not affected by carrying the
  full catalogue.
