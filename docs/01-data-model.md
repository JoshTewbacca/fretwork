# Data model

One schema, designed before any code. TypeScript shapes are authoritative for the PWA;
the desktop service mirrors the relevant subset in SQLite and emits the manifest the phone
consumes. All IDs are ULIDs unless stated. All timestamps are Unix ms.

## Design rules

1. **Blobs are content-addressed.** Every binary (tab file, opus file, soundfont) is stored
   once in a `blobs` store keyed by SHA-256, referenced by hash. Dedupe is free, integrity
   checking is free, eviction detection is a key-existence check.
2. **Practice history is an append-only event log.** Events are facts; all mutable practice
   state (passage scheduling, streaks, stats) is derived and can be rebuilt from the log.
   Append-only logs sync trivially (union by event id) between phone and desktop backup.
3. **The tab file is immutable; corrections are stored beside it**, so a re-fetch of the same
   source tab never destroys local edits.

## PWA entities (IndexedDB, database `fretwork`)

```ts
// store: songs (key: id)
interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  source: { sourceId: 'songsterr' | 'gprotab' | 'gtptabs' | 'file' | 'musescore';
            externalId?: string; url?: string };
  tabBlobHash: string;            // original fetched .gp/.gpx/MusicXML file
  tabFormat: 'gp3'|'gp4'|'gp5'|'gpx'|'gp'|'musicxml';
  correctedTabBlobHash?: string;  // GP7 re-export after local corrections (see below)
  correctionsBaseHash?: string;   // tabBlobHash the corrections were made against
  defaultTrackIndex: number;      // the guitar part the user plays
  targetTempoBpm: number;         // score tempo, cached for display/ramp math
  audioBundleId?: string;         // present iff hasBackingTrack
  favourite: boolean;
  tags: string[];
  addedAt: number; lastPlayedAt?: number;
}

// store: audioBundles (key: id)
interface AudioBundle {
  id: string;
  songId: string;
  backingBlobHash: string;        // backing.opus  (everything minus guitar)
  guitarBlobHash: string;         // guitar.opus   (isolated guitar)
  durationMs: number;
  encodeBitrateKbps: number;      // 64–96
  sourceAudioFingerprint: string; // hash of the desktop source file (re-ingest detection)
  demucsModel: 'htdemucs_6s';
  syncMap: SyncMap;               // see ADR-002
  createdAt: number;
}

// Sync points, storage form (ADR-002). Applied to alphaTab at load time by building
// Automation objects on master bars, then api.updateSyncPoints().
interface SyncMap {
  version: 1;
  points: SyncAnchor[];
  beatGrid?: { timesMs: number[]; downbeatIdx: number[] }; // raw tracker output, kept for the editor
  confidence: number;             // 0..1, from ingest
  status: 'auto' | 'user-verified' | 'needs-review';
}
interface SyncAnchor {
  masterBarIndex: number;
  barOccurence: number;           // alphaTab spelling
  ratioPosition: number;          // 0 = bar start; anchors are bar-start only in v1
  audioMs: number;
  source: 'auto' | 'user';
}

// store: passages (key: id) — the unit of practice scheduling (ADR-001)
interface Passage {
  id: string;
  songId: string;
  trackIndex: number;
  startBar: number; endBar: number;   // masterBar indexes, inclusive
  label?: string;                      // "solo 2nd half"
  origin: 'user' | 'suggested';
  status: 'candidate' | 'active' | 'retired';
  createdAt: number;
}

// store: reviewState (key: passageId) — derived from events, persisted as a cache
interface PassageReviewState {
  passageId: string;
  phase: 'acquisition' | 'consolidation' | 'maintenance';
  masteredTempoPct: number;   // highest tempo % with a clean block, 30–125
  reviewTempoPct: number;     // tempo the next block will run at
  ease: number;               // 1.3–2.8
  intervalDays: number;
  dueAt: number;
  reps: number; lapses: number;
  consecutiveEasy: number;    // two in maintenance unlock overspeed review
  consecutiveLapses: number;  // two drop the passage back to acquisition
  lastReviewedAt?: number;
  rebuiltFromEventId: string; // last event folded into this state (for incremental rebuild)
}

// store: events (key: id, indexes: by-ts, by-passageId) — append-only
type PracticeEvent =
  | { id: string; ts: number; type: 'session_start' | 'session_end' }
  | { id: string; ts: number; type: 'playthrough'; songId: string; trackIndex: number;
      tempoPct: number; mode: PlayMode; durationMs: number }
  | { id: string; ts: number; type: 'loop_block'; songId: string; passageId?: string;
      startBar: number; endBar: number; tempoPct: number; reps: number;
      cleanReps: number; durationMs: number }
  | { id: string; ts: number; type: 'review_result'; passageId: string;
      tempoPct: number; grade: 'fail' | 'hard' | 'good' | 'easy' }
  | { id: string; ts: number; type: 'passage_marked' | 'passage_retired'; passageId: string };

type PlayMode = 'synth' | 'real-backing' | 'real-full' | 'guitar-only';
// 'real-full' is backing.opus + guitar.opus played simultaneously — no third file needed.

// store: setlists (key: id)
interface Setlist { id: string; name: string; songIds: string[];
                    kind: 'setlist' | 'practice-group'; createdAt: number }

// store: blobs (key: sha256 hex)
interface BlobRecord { hash: string; bytes: Blob; size: number;
                       kind: 'tab' | 'audio' | 'soundfont'; refAddedAt: number }

// store: assetState (key: `${kind}:${hash}`) — offline bookkeeping (ADR-003)
interface AssetState { key: string; state: 'absent'|'queued'|'downloading'|'cached'|'evicted';
                       lastVerifiedAt?: number; failCount: number }

// store: kv — settings, storage budget, desktop endpoint config, schema version
```

**Local tab corrections.** v1 approach: edit the loaded score via alphaTab's model, re-export
to GP7 (`correctedTabBlobHash`), keep the original untouched. If a source update replaces the
original tab, `correctionsBaseHash` no longer matches and the app shows "corrections were made
against an older revision" instead of silently mixing versions. (If GP7 export turns out not
to exist in 1.8.4 — see VERIFY list — fallback is an edit-op list `{trackIndex, barIndex,
beatIndex, op, payload}[]` replayed after load; same two fields, different payload.)

## Desktop entities (SQLite, `ingest/fretwork.db`)

```sql
-- discovered audio files
CREATE TABLE source_audio (
  fingerprint TEXT PRIMARY KEY,        -- sha256 of file bytes
  path TEXT NOT NULL, artist TEXT, title TEXT, album TEXT, duration_ms INTEGER,
  drm_protected INTEGER NOT NULL DEFAULT 0,   -- .m4p etc: listed, never processed
  scanned_at INTEGER NOT NULL
);

-- audio<->tab matches with confidence (ADR: never silent best-guess).
-- Note: a recording-variant disagreement (tab says studio, audio says live or
-- acoustic) is capped below the auto threshold, because a different take has
-- different timing and would never line up in play-along mode.
CREATE TABLE matches (
  song_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  confidence REAL NOT NULL,            -- 0..1 from normalized artist/title distance
  status TEXT NOT NULL,                -- 'auto' (>=0.90) | 'pending-review' | 'confirmed' | 'rejected'
  PRIMARY KEY (song_id, fingerprint)
);

-- resumable processing queue (Demucs OOM/crash must not restart the batch)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, song_id TEXT NOT NULL,
  stage TEXT NOT NULL,   -- 'queued'|'separating'|'mixing'|'encoding'|'beat-tracking'|'done'|'failed'
  attempts INTEGER NOT NULL DEFAULT 0, segment_size INTEGER,  -- per-job override after OOM
  error TEXT, updated_at INTEGER NOT NULL
);

CREATE TABLE bundles (
  id TEXT PRIMARY KEY, song_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  backing_path TEXT, guitar_path TEXT, duration_ms INTEGER,
  sync_map_json TEXT, created_at INTEGER NOT NULL
);
```

The desktop HTTP API (LAN / Tailscale) serves:
`GET /health`, `GET /manifest` (songs + bundle ids + hashes), `GET /blob/{hash}`,
`GET /review-queue`, `POST /review/{songId}` (confirm/reject match from the PWA),
`POST /events/backup` (append-only practice-event mirror), `GET /events/since/{id}`.
No auth beyond being on the LAN/tailnet in v1; it binds to the tailnet/LAN interface only.

**Pending change — desktop `songs` table and catalogue sync.**
[ADR-006](adr/ADR-006-library-ownership-and-sync.md) adds a `songs` table to the desktop
schema, a `'purchased'` member to `Song.source.sourceId`, and four endpoints
(`GET /library`, `POST /blob`, `POST /songs`, `DELETE /songs/{id}`), deprecating
`GET /manifest` in place rather than changing its shape. The schema and field-ownership
rules are specified in that ADR; this document is updated to match when the code lands, so
that until then it continues to describe what the desktop actually stores.

## Why not SQLite/WASM on the phone

The brief allows it if justified; it is not justified. Every query pattern above is key
lookup or index scan over at most a few thousand rows; the event log is append + range scan.
IndexedDB via the `idb` wrapper covers this with zero WASM payload, zero COOP/COEP header
requirements (which Vercel static hosting makes awkward for OPFS-backed SQLite), and one
fewer moving part in the eviction story.
