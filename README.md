# Fretwork

A personal guitar practice app: a tab player in the spirit of Songsterr, extended with
practice intelligence (auto speed ramp, per-bar trouble tracking, spaced repetition over
musical passages) and real-audio play-along with the guitar stem removed. It runs as an
installed PWA on iPhone; heavy audio processing (Demucs stem separation, beat tracking)
runs on a desktop machine that serves the phone over LAN/Tailscale.

This is a single-user personal tool, not a product. It is public as a portfolio piece.
No tablature or audio content is stored in this repository, and the app does not
redistribute any content it ingests.

## Architecture

```
Windows desktop (Python)                          iPhone (installed PWA)
  fetch tab -> .gp file                             alphaTab renderer + player
  scan local media, tag-read                        practice engine + scheduler
  fuzzy-match audio <-> tab          -- LAN/ -->    library, search, setlists
  Demucs htdemucs_6s -> stems         Tailscale     offline cache (IndexedDB)
  mixdown: backing.opus + guitar.opus               sync-point tap editor
  beat-track -> sync points
  HTTP API: manifest + blobs
```

- **PWA**: TypeScript, Vite, Preact, alphaTab 1.8.4 (rendering + alphaSynth playback),
  IndexedDB via `idb`, Workbox service worker. Hosted as static files.
- **Ingest**: Python 3.11, FastAPI, mutagen, Demucs (CUDA), ffmpeg, madmom/librosa.

## Repository layout

- `docs/` — milestone plan, data model, ADRs (spaced-repetition model, sync-point model,
  offline state machine), delegation map, verified alphaTab integration notes
- `app/` — the PWA
- `ingest/` — the desktop ingest service and LAN API

## Running and deploying

The PWA is a static build. From `app/`:

- `npm run dev` — local dev server
- `npm test` — unit tests
- `npm run build` — production build into `app/dist`

Deployment targets Vercel's free tier with `app/` as the project root
(`app/vercel.json` holds the build and cache-header configuration). The
notation font and soundfont are copied into `public/` by the alphaTab Vite
plugin at build time, so they are generated rather than committed.

Live: https://fretwork-kappa.vercel.app

## Status

Planning complete and approved; Milestone 0 (core player) in progress. See
[docs/README.md](docs/README.md) for the plan and
[docs/00-milestone-plan.md](docs/00-milestone-plan.md) for acceptance criteria.
