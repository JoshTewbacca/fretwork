# ADR-004: Overall data model

Status: proposed. The full schema lives in docs/01-data-model.md; this records the decisions
and why.

## Decisions

1. **Content-addressed blob store.** All binaries keyed by SHA-256, referenced by hash from
   metadata. Consequences: dedupe for free (same tab fetched twice, soundfont shared),
   eviction detection is a key diff (ADR-003), transport is `GET /blob/{hash}` with trivial
   cache semantics, and integrity is verifiable. Cost: a GC pass for unreferenced blobs
   (run on library removals; simple mark-and-sweep over known hash fields).

2. **Append-only practice-event log as the source of truth**, with `PassageReviewState` as a
   rebuildable fold. Consequences: scheduler bugs are fixable retroactively (ADR-001),
   backup/sync is union-by-id with no conflict logic (ADR-003), and stats/streaks/practice
   log are queries over events rather than more mutable state. Cost: a fold cache and an
   index on `(songId, ts)`; negligible at one user's data volume (a heavy year ≈ tens of
   thousands of events).

3. **Original tab immutable; corrections stored beside it** (re-exported GP7 blob +
   base-hash). A source re-fetch can never destroy local edits; a base-hash mismatch is
   surfaced, not merged silently.

4. **Two-file audio bundles** (`backing.opus` + `guitar.opus`). The four playback modes come
   from mixing these two elements (full mix = both at once), so the phone stores ~4 MB per
   song, not 6 stems (~40 MB), and no third "full mix" file is needed.

5. **IndexedDB, not SQLite/WASM.** Every access pattern is key lookup or small index scan;
   WASM SQLite adds payload, OPFS/COOP-COEP header complications on static Vercel hosting,
   and a second persistence layer to reason about during eviction — for no query we
   actually need. Revisit only if the practice-analytics queries in M2 become real SQL.

6. **Desktop mirrors, phone owns.** SQLite on the desktop is bookkeeping for ingest (queue,
   matches, bundles) plus a passive mirror of practice events. The phone's IndexedDB is the
   authoritative library; the desktop's job is to fill it and back it up.
