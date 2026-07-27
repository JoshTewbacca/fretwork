# Delegation map

Policy per brief §9. Opus retains: §8 designs (done — ADRs 001–004), architecture and data
model, player state machine + cursor/audio sync, practice scheduler, iOS storage/audio
strategy, integration and review of everything below. Every delegated task gets a written
spec; the summaries here are the spec skeletons that will be expanded to full specs at spawn
time. No two parallel agents touch the same files. No paid APIs anywhere.

## Standing instructions included in every subagent spec

- TypeScript strict; no new dependencies without listing them in the task output.
- Do not touch files outside the listed paths.
- alphaTab work: read docs/03-alphatab-notes.md first and the live docs for anything beyond
  it; do not code alphaTab calls from memory.
- Python: never bare `python`; use the venv interpreter at `ingest\.venv\Scripts\python.exe`.
- No emojis anywhere. Plain, professional copy.
- Tests scaled to the change; list what you ran.

## Milestone 0 (Sonnet, parallel where file-disjoint)

| # | Task | Contract essentials | Paths |
|---|---|---|---|
| 0.1 | App shell + routing + theming | Screens: Player, Library (stub), Settings. Preact + signals, no router lib if a 20-line hash router suffices. | `app/src/shell/**` |
| 0.2 | IndexedDB layer | Implement stores from docs/01-data-model.md via `idb`; typed repository functions + blob store with hash keys + GC sweep; unit tests with fake-indexeddb. | `app/src/db/**` |
| 0.3 | File import | File picker + drag/drop (desktop browser) for .gp3/4/5/x/.gp/MusicXML → blob store → Song record; format sniffing; error surface for corrupt files. | `app/src/import/**` |
| 0.4 | Player controls UI | Dumb components bound to a `PlayerStore` interface Opus provides: transport, speed, loop UI, track mixer (solo/mute/vol), count-in, capo/transpose, left-handed toggle, track switcher. No alphaTab calls in components. | `app/src/player/ui/**` |
| 0.5 | SW + PWA manifest + install flow | vite-plugin-pwa; precache shell + sonivox.sf3; iOS meta tags; storage persist() request on first run; A2HS instructions screen. | `app/vite.config.ts`, `app/src/pwa/**` |

Opus (not delegated): `app/src/player/core/**` — alphaTab bootstrap, PlayerStore state
machine, cursor scroll strategy, audio unlock/interruption handling, note-correction editor
core, integration of 0.1–0.5.

## Milestone 1

| # | Task | Contract essentials | Paths |
|---|---|---|---|
| 1.1 | `TabSource` adapters | Interface from brief §5. Songsterr adapter: endpoint shapes studied from public reference implementations; polite rate limit (1 req/1.5s + jittered backoff), local response cache keyed by URL hash, never re-fetch a held tab. GProTab/gtptabs adapters behind same interface. | `app/src/sources/**` |
| 1.2 | Library UI | Browse/filter/sort/favourites/recent; setlists CRUD; storage-cost per row; states from `AssetState` (ADR-003) rendered as row badges. | `app/src/library/**` |
| 1.3 | Desktop scanner + matcher | Walk media folder, mutagen tags, DRM detect (.m4p + FairPlay atoms) → report only; normalization (case, punctuation, feat., remaster/live suffixes) + token-set ratio; ≥0.90 auto, else review queue. SQLite per docs/01-data-model.md. Unit tests on a fixture set of nasty titles. | `ingest/src/scan/**` |
| 1.4 | Desktop API | FastAPI: /health /manifest /blob/{hash} /review-queue /review/{id} /events/backup /events/since/{id}; binds LAN+tailnet only; streaming blob responses; no auth v1. | `ingest/src/api/**` |
| 1.5 | Review queue UI (PWA) | List pending matches (song ↔ audio candidates + confidence), confirm/reject → POST. | `app/src/review/**` |

Opus: download queue + ADR-003 state machine (`app/src/offline/**`), event mirror client.

## Milestone 2

| # | Task | Contract essentials | Paths |
|---|---|---|---|
| 2.1 | Practice UI | Ramp controls, review-block screen (rep counter, clean/not-yet buttons, grade display), passage marking UI on the score, candidate-suggestion sheet. Binds to Opus `PracticeStore`. | `app/src/practice/ui/**` |
| 2.2 | Log & stats | Practice log, streaks, per-song time — pure queries over events store; charts as plain SVG sparklines. | `app/src/stats/**` |
| 2.3 | Scheduler test suite | Given ADR-001 as spec: table-driven tests for phase transitions, lapse handling, nesting propagation, session builder — against the Opus-written fold. | `app/src/practice/core/*.test.ts` |

Opus: `app/src/practice/core/**` — the ADR-001 fold, session builder, loop telemetry.

## Milestone 3

| # | Task | Contract essentials | Paths |
|---|---|---|---|
| 3.1 | Demucs wrapper + job queue | htdemucs_6s, `--segment` from config (default 7), OOM catch → step down 7→5→3 → per-job persist; resumable via `jobs` table; CUDA preflight fails loudly; per-song timing logged. | `ingest/src/separate/**` |
| 3.2 | Mixdown + encode | ffmpeg: sum 5 stems → backing.opus, guitar stem → guitar.opus, 64–96 kbps config; loudness-normalize both to same LUFS; duration sanity check vs source. | `ingest/src/mix/**` |
| 3.3 | Beat-track + auto-sync | ADR-002 §auto-generation as spec: madmom optional / librosa fallback, lead-in cross-correlation, anchor emission, confidence, performed-order unrolling provided by Opus as a library function. | `ingest/src/sync/**` |
| 3.4 | PWA bundle plumbing | Bundle download/attach, four-mode toggle UI, dual `<audio>` element manager (create, gain via element volume, seek both, keep in lockstep). Handler wiring to alphaTab stays with Opus. | `app/src/audio/**` |

Opus: `IExternalMediaHandler` integration, SyncMap→Automation application, mode-switch
position preservation.

## Milestone 4

| # | Task | Contract essentials | Paths |
|---|---|---|---|
| 4.1 | Sync timeline UI | Anchor timeline with waveform-less bar ruler, drag-to-adjust with ms readout, user/auto colour coding. | `app/src/syncedit/ui/**` |
| 4.2 | Tap capture | Tap surface with latency-compensated timestamping (audio clock, touch offset calibration screen). | `app/src/syncedit/tap/**` |

Opus: merge/rescale semantics (ADR-002), preview loop.

## Explicitly not delegated, ever

Anything touching: scheduling math, sync-point merge logic, the PlayerStore state machine,
storage-eviction recovery, or cross-milestone refactors.
