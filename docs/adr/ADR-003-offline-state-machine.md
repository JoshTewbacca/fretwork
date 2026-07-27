# ADR-003: Offline/online state machine

Status: proposed.

## Principles

1. **Metadata and practice data are never evictable-by-design**: they are small, live in
   IndexedDB, and practice events are additionally mirrored to the desktop whenever it is
   reachable. Losing audio is an inconvenience; losing practice history is unacceptable.
2. **The library list always renders**, from the songs/assetState stores, regardless of
   connectivity or eviction. Missing assets show as states on the row, never as absent rows.
3. The **desktop is a cache-filler, not a dependency**: every feature except "download new
   things" and "review ingest matches" works with the desktop unreachable.

## Connectivity states

`desktopLink: 'reachable' | 'unreachable' | 'checking'` — probed via `GET /health`
(3 s timeout) on app launch, on `visibilitychange` to visible, and before any queued
download. The base URL is a setting with two entries (LAN URL, Tailscale URL).
No cloud fallback exists, by design.

**Revised 2026-07-27 — Tailscale is probed first, and a plain LAN address usually cannot
work at all.** The original ordering above (LAN first) was written before the hosting model
was settled. The PWA is served over HTTPS from Vercel, and browsers block mixed content, so
an HTTPS page cannot call `http://192.168.x.x:8765`. A LAN entry is therefore only usable if
the desktop serves HTTPS with a certificate the phone trusts, which a self-signed
certificate is not. Tailscale Serve issues a real certificate for the machine's `*.ts.net`
name, so it is the supported path and is probed first; the LAN field remains for the case
where the owner terminates TLS locally, and the settings screen warns whenever an `http://`
URL is entered.

Consequence worth stating plainly: **Tailscale setup is a prerequisite for every desktop
feature** (audio bundles, ingest review), not the convenience it was described as in the
milestone plan. Tabs, search, playback and practice all continue to work without it.

## Per-asset states

`AssetState.state`: `absent → queued → downloading → cached → evicted → queued …`
- `cached` is claimed only after the blob write completes and a readback of the key succeeds.
- Downloads are hash-addressed (`GET /blob/{hash}`), resume-safe (re-request is idempotent),
  and run at most 2 in parallel with exponential backoff on failure (`failCount`).

## Eviction: detection and recovery

iOS can evict IndexedDB despite `navigator.storage.persist()` — persist() (requested at
first launch, logged if denied) lowers the odds; it does not eliminate them.

- **Fast sweep on launch**: `getAllKeys()` on the blob store diffed against every hash
  referenced by songs/audioBundles/soundfont settings. Missing hash ⇒ mark `evicted`.
  (Key-existence only; no checksumming on the hot path.)
- **Lazy verification**: any read miss at use time also flips state to `evicted`.
- **Recovery**: evicted assets auto-requeue when `desktopLink = reachable`; the UI shows one
  banner ("N songs need re-download, connect to home network") rather than per-song errors.
- **Catastrophic eviction** (database gone): the app rebuilds the library from the desktop
  manifest and the practice-event mirror (`GET /events/since/0`). This is the disaster path
  that makes rule 1 work; it is tested deliberately, not discovered in the field.

## Storage budget

`navigator.storage.estimate()` on launch and after every bundle download. Soft budget
default 4 GB (configurable): at 80% the add-to-library flow warns; at 95% it requires
removing bundles first (tab files and practice data are exempt — they are small and
irreplaceable respectively). Per-song cost shown in the library ("4.1 MB").

## Practice-event mirroring

Outbound queue: events since `lastBackedUpEventId` POST to `/events/backup` whenever the
desktop is reachable (batched, at most once per minute). Inbound on rebuild only. Conflict
handling: none needed — events are append-only, immutable, unioned by id (single user,
single phone; the desktop never writes events).

## Service worker

- Precache: app shell + `sonivox.sf3` (~1 MB) — the player must boot offline.
- IndexedDB, not Cache Storage, for tabs/audio (blob store already handles integrity).
- SW updates use standard skip-waiting-on-reload; no custom update UI in v1.
