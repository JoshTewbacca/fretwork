# Fretwork — milestone plan

Working name kept as **Fretwork** (no better candidate worth a rename discussion).

Plan approved by the owner on 2026-07-27, with these confirmations:
- **Target device: iPhone 14, iOS 26.5.2** — performance and storage budgets are set against
  this hardware.
- **Tailscale is not yet set up**; installing it on desktop + phone is part of M1 (see below).
- **Library is small and hand-curated** (owner adds songs one by one). The matcher can favour
  precision over recall, and the 4 GB default storage budget is far above realistic use.
- Repo is **public on GitHub** (portfolio). Hard rule: no fetched tabs, no audio, no ingest
  database, no media paths in the repo — code and docs only, enforced via .gitignore.

## Stack (confirmed at review)

- **PWA**: Vite + TypeScript + **Preact** (+ `@preact/signals`), plain CSS. Rationale:
  alphaTab is DOM-imperative so the framework only runs the shell around it; Preact keeps
  the bundle small for iOS Safari; React idioms are the ones Sonnet subagents produce most
  reliably, which is a stated cost lever. No Tailwind, no component library — the UI surface
  is small and bespoke.
- **Storage**: IndexedDB via `idb` (tiny, typed).
- **SW/PWA**: `vite-plugin-pwa` (Workbox) with a precached shell + `sonivox.sf3`.
- **Desktop ingest**: Python 3.11 venv at `A:\Songsterr\ingest\.venv` (local drive, not
  cloud-synced), FastAPI + uvicorn for the LAN API, `mutagen`, `demucs` (CUDA torch),
  `ffmpeg` CLI for mixdown/opus, madmom optional with librosa fallback.
- **Hosting**: Vercel free tier, static output only; no serverless functions anticipated
  (the only backend is the desktop, which Vercel never talks to).

## Milestone 0 — core player

Scope: brief §6 M0. Architecture notes: player state machine and cursor sync are Opus-owned;
alphaTab does the heavy lifting (verified API surface in docs/03-alphatab-notes.md). Synth
backing = `changeTrackMute` on the user's track; lossless tempo via `playbackSpeed`; loop
via `playbackRange`; count-in via `countInVolume`; pitch/capo via
`changeTrackTranspositionPitch` + rendering settings.

Acceptance (brief's, made measurable):
- 5-minute multi-track `.gp5` loads to first rendered bar < 3 s on the target iPhone
  (measured via `performance.mark`, reported in a debug panel).
- Cursor drift vs audio: after 5 min of continuous playback, cursor-to-audio offset < 50 ms
  (test: metronome-only track, audible tick vs highlighted beat; plus automated check that
  cursor position derives only from player events, never `Date.now`).
- Scroll during playback at 60 fps ± jank budget on iOS Safari (visual check + Safari
  timeline on the Mac-less workflow: `about:inspect` is unavailable, so use alphaTab's own
  render stats + on-device FPS overlay).
- Speed 25–125%, loop, per-track solo/mute/volume, count-in, transposition, capo,
  track switcher, tap-to-seek, file import (.gp3/4/5/x/.gp, MusicXML), and a
  first-pass note-correction editor all function offline after install.
  **Left-handed rendering is dropped from M0**: alphaTab 1.8.4 provides no such option
  (evidence and rejected workarounds in docs/03-alphatab-notes.md). Everything else in the
  brief's M0 control list is implemented.
- iOS audio unlock: first tap starts audio reliably; phone call interruption and headphone
  unplug pause cleanly and resume without reload.

Cost estimate: 5 Sonnet task-runs (shell UI, import + file handling, settings/controls UI,
IndexedDB plumbing, SW/manifest) ≈ 500k–1M tokens each ballpark; Opus retains player core +
integration (~40% of milestone effort). Largest milestone; est. 30–40% of total project
agent spend.

## Milestone 1 — library and ingest

Scope: brief §6 M1. `TabSource` interface + Songsterr adapter (rate-limited, cached,
guardrails per §5) + GProTab/gtptabs adapters + file import already from M0; library views;
setlists; desktop scanner (mutagen tag read, DRM skip-and-report) + fuzzy matcher
(normalized artist/title token distance; auto ≥ 0.90, review queue below) + manifest/API;
PWA review queue screen; practice-event backup.

Acceptance:
- Search → add → offline playback round-trip works with network then airplane mode.
- Ingest run over the real media folder produces a report (matched / no-audio / DRM-skipped)
  with zero unhandled exceptions; low-confidence matches appear in the PWA review queue and
  resolve from the phone.
- Desktop unreachable ⇒ library fully browsable/playable; reachable ⇒ queued downloads
  drain automatically (ADR-003 behaviours demonstrable).

M1 also includes **Tailscale setup** (not previously installed): install on the Windows
desktop and the iPhone, join both to one tailnet, bind the ingest API to the tailnet + LAN
interfaces, and record both URLs in the PWA settings screen. This is configuration work done
with the owner (Tailscale login is interactive), documented in `ingest/SETUP.md`; no agent
budget beyond writing the doc.

Cost: 4–5 Sonnet tasks (adapters+cache, scanner+matcher, desktop API, library UI, review UI).
est. 20–25% of spend.

## Milestone 2 — practice intelligence

Scope: ADR-001 implemented. Scheduler fold + session builder are Opus-owned; UI (ramp
controls, review blocks, practice log, session screen) delegated against specs; loop
telemetry feeds candidate passages.

Acceptance:
- Ramp: loop a passage at 60%, mark clean reps, tempo steps per configured curve; state
  persists across app restarts.
- Scheduling: passages move acquisition → consolidation → maintenance per ADR-001 table in a
  scripted simulation (unit-tested fold, deterministic given an event stream).
- Session builder produces a 20-minute plan honouring due-ness and kernel-before-parent.
- Practice log renders per-song/per-session time from events only (delete the fold cache,
  rebuild, identical output).

Cost: 3 Sonnet tasks (practice UI screens, log/stats views, tests for the fold given a spec
of cases). Scheduler itself is Opus. est. 15–20% of spend.

## Milestone 3 — real-audio play-along

Scope: Demucs pipeline (segment-size config, OOM step-down retry, resumable `jobs` queue),
mixdown to `backing.opus`/`guitar.opus` (ffmpeg, 64–96 kbps), beat-tracking → auto SyncMap
(ADR-002), bundle download in PWA, external-media playback path
(`EnabledExternalMedia` + `IExternalMediaHandler` over two `<audio>` elements), four-mode
toggle with graceful fallback to synth when no bundle exists.

Acceptance:
- Batch of 10 real songs ingests unattended on the 1660 Super without OOM (auto segment
  step-down proven by log), timing logged per song (no asserted numbers).
- A steady-tempo song plays with real backing and the cursor stays visually locked
  bar-accurate for the full song; a rubato song is correctly flagged `needs-review`.
- Synth/real-backing/real-full/guitar-only toggle mid-song without position loss.
- Songs without bundles behave exactly as M0 (this is the normal case).

Cost: 4 Sonnet tasks (Demucs wrapper+queue, mixdown/encode, beat-track+alignment per ADR-002
spec, PWA bundle+audio-element plumbing). Opus: external-media handler integration + sync
application. est. 20% of spend.

## Milestone 4 — sync point editor

Scope: ADR-002 editor semantics. Tap-along capture (tap = bar start while audio plays),
timeline with drag-to-adjust, rescale-between-user-anchors merge, preview loop using the
real playback engine, persist to SyncMap (`user-verified`).

Acceptance:
- A live/rubato recording that auto-sync failed on becomes cursor-locked after one
  tap-through pass plus ≤ 5 manual nudges.
- Edits survive restart; re-running auto-generation never overwrites user anchors.

Cost: 2 Sonnet tasks (timeline UI to spec, tap capture) + Opus merge/preview logic.
est. 10% of spend.

## Sequencing gate

M0 ships to the phone and gets real practice use before M1 starts (the brief's bar: better
than Songsterr as a player, or nothing else matters). Each later milestone ends with a week
of real use before the next begins — the practice-intelligence design especially will need
tuning contact with reality, and the event-log architecture makes retuning safe.
