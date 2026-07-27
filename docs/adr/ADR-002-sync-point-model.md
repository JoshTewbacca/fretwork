# ADR-002: Sync-point data model and interpolation

Status: proposed. Depends on verified alphaTab behaviour in docs/03-alphatab-notes.md.

## What alphaTab gives us (verified)

Sync points are `Automation`s on `MasterBar` (`syncPointValue: SyncPointData
{ barOccurence, millisecondOffset }`), flattened by alphaTab into `BackingTrackSyncPoint`s
that carry a computed `syncBpm` — i.e. **between consecutive sync points alphaTab applies a
piecewise-linear virtual tempo** so the score axis and audio axis meet exactly at each
anchor. Without points the mapping is linear from 0. `api.updateSyncPoints()` pushes model
changes into the player. Our design leans on this instead of reimplementing any warping.

## Storage form

We do not persist alphaTab objects. `SyncMap` (see data model) stores plain
`SyncAnchor { masterBarIndex, barOccurence, ratioPosition: 0, audioMs, source }` plus the raw
beat grid from the tracker and a confidence/status field. At song load the player builds
Automations from anchors, attaches via `masterBar.addSyncPoint()`, calls
`api.updateSyncPoints()`. One direction of truth: SyncMap → alphaTab, never read back.

Anchors are **bar-start only** (`ratioPosition: 0`) in v1. Sub-bar anchors add editor
complexity for a correction the virtual-tempo interpolation already absorbs unless tempo
changes mid-bar drastically (rubato — which goes to the tap editor anyway).

## Repeats

The audio follows the *performed* order; alphaTab's `barOccurence` exists precisely for this.
The unrolled playback order (masterbar sequence with repeats/jumps expanded, obtainable from
the score's repeat structure) defines a sequence of (masterBarIndex, occurrence) slots; the
k-th performed bar maps to the k-th slot. Auto-generation works in performed-bar space and
emits (index, occurrence) pairs. Mismatch between performed-bar count and detected downbeat
count beyond ±4 bars ⇒ `status: 'needs-review'`, no auto anchors past the first verified
stretch. (Typical cause: the recording has an extra chorus the tab doesn't, or vice versa —
no algorithm should paper over that.)

## Auto-generation (desktop, Milestone 3)

1. Beat-track the **original mix** (not stems): madmom `DBNDownBeatTrackingProcessor`
   (downbeats + beats); fallback librosa `beat_track` (beats only, downbeats inferred from
   the tab's meter). madmom is a known-painful Windows install — the pipeline treats it as
   optional at runtime, not import time.
2. Estimate the lead-in offset: align the tab's expected bar-duration sequence (from its
   tempo map and time signatures) against detected downbeat intervals by cross-correlation;
   take the best-scoring start offset.
3. Emit anchors at: performed bar 1, every 8th performed bar, every tempo-change bar, the
   first bar after any detected gap/silence, and the final bar. Confidence = mean local
   alignment error mapped to 0..1; < 0.7 ⇒ `needs-review`.
4. Anchors ride in `SyncMap` inside the bundle manifest; the phone never runs DSP.

## Editor merge semantics (Milestone 4)

- User taps create/move anchors with `source: 'user'`. **User anchors are authoritative.**
- Setting a user anchor for (bar, occurrence) replaces any auto anchor for the same slot.
- Auto anchors *between* two user anchors are **rescaled, not deleted**: their `audioMs` is
  linearly remapped so the segment endpoints match the user anchors (the tracker's local
  spacing is usually right even when its absolute placement drifted).
- Auto anchors outside any user-anchored segment are left as-is.
- "Clear auto points" and "re-run from taps only" are explicit editor actions.
- Every edit updates `SyncMap.status` → `user-verified` once the user confirms playback.

## Interpolation between anchors

Delegated entirely to alphaTab's syncBpm mechanism. The editor's preview must therefore use
the same engine (play audio in `EnabledExternalMedia` mode and watch the cursor), so what the
user verifies is exactly what playback does. No bespoke interpolation code exists to drift
out of agreement with the player.
