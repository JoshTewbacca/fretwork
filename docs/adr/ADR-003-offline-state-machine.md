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
(2 s timeout) on app launch, on `visibilitychange` to visible, and before any queued
download. The base URL is a setting with two entries (LAN URL, Tailscale URL); probe LAN
first, then Tailscale. No cloud fallback exists, by design.

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
