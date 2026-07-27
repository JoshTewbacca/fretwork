# alphaTab 1.8.4 integration notes (verified against live docs, 2026-07-27)

Everything below was read from alphatab.net docs pages or the published 1.8.4 npm package,
not from model memory. Items marked VERIFY are the few gaps to confirm against the shipped
`.d.ts` when integration starts.

## Player modes

`settings.player.playerMode` (enum `alphaTab.PlayerMode`):

- `Disabled` — default.
- `EnabledAutomatic` — picks a mode automatically.
- `EnabledSynthesizer` — alphaSynth MIDI synthesis; requires a soundfont.
- `EnabledBackingTrack` — plays audio embedded in the input file (GP8 files can embed audio + sync points).
- `EnabledExternalMedia` — alphaTab renders/moves the cursor while *we* own the audio element; sync via sync points. This is the mode for Milestone 3.

## Sync point data model (the part the brief said to verify)

Sync points live **on the score model, per master bar**, Guitar Pro-style:

- `MasterBar.syncPoints: Automation[] | undefined` — "the sync points for this master bar to
  synchronize the alphaTab time axis with the external backing track audio."
- `MasterBar.addSyncPoint(syncPoint: Automation): void`
- `Automation` fields: `type: AutomationType` (SyncPoint), `ratioPosition: number` (relative
  position within the bar), `value: number`, `syncPointValue: SyncPointData | undefined`,
  `isLinear`, `text`, `isVisible`.
- `SyncPointData` fields:
  - `barOccurence: number` — which repeat pass this point applies to (0 = first time the bar
    is played, 1 = second, …). This is how repeats/jumps are handled.
  - `millisecondOffset: number` — position in the external audio, in ms.
- After mutating sync points in the model, call `api.updateSyncPoints(): void`
  (on `AlphaTabApiBase`, since 1.6.0) to push them into the player.

Internally alphaTab flattens these into `alphaTab.synth.BackingTrackSyncPoint`:
`masterBarIndex`, `masterBarOccurence`, `synthTick`, `synthTime`, `synthBpm`,
`syncTime` (external-media ms), `syncBpm` ("the BPM the song will have virtually after this
sync point to align the external media time axis with the synthesizer's"). Between two sync
points alignment is therefore a **piecewise-linear virtual-tempo warp** — exactly the
interpolation model ADR-002 assumes. Without any sync points the two time axes map linearly.

## External media integration (Milestone 3 playback path)

From the Audio & Video Sync guide, verbatim shapes:

```ts
settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia;

const handler: alphaTab.synth.IExternalMediaHandler = {
  get backingTrackDuration() { /* ms */ },
  get playbackRate() { ... },
  set playbackRate(v) { ... },
  get masterVolume() { ... },
  set masterVolume(v) { ... },
  seekTo(time) { ... },   // ms
  play() { ... },
  pause() { ... },
};

(api.player!.output as alphaTab.synth.IExternalMediaSynthOutput).handler = handler;

// we drive position (called from timeupdate/rAF off the audio element):
(api.player!.output as alphaTab.synth.IExternalMediaSynthOutput)
  .updatePosition((audio.currentTime / audio.playbackRate) * 1000);
```

Note from the 1.6 design epic (#1961): in external-media mode alphaTab's own transport APIs
step back — play/pause/volume are ours; `tickPosition` / `timePosition` and cursor scrolling
remain functional. Speed control in this mode = `audio.playbackRate` on our elements (which
iOS Safari supports, with pitch preservation on by default) — *not* lossless like synth mode.

## Playback / player API surface (Milestone 0)

Events on `AlphaTabApi`:
- `playerReady`, `playerStateChanged`, `playerPositionChanged` (current position changed —
  drive the practice engine off this, never a wall clock), `playedBeatChanged`,
  `playerFinished`, `midiEventsPlayed`, `soundFontLoaded`, `playbackRangeChanged`.

Transport & controls:
- `playbackSpeed` (percentage), `isLooping`, `countInVolume`, `metronomeVolume`,
  `masterVolume`, `tickPosition` / `timePosition` (seek in ticks / ms).
- Loop region: `playbackRange: PlaybackRange | null` with `{ startTick, endTick }` in MIDI
  ticks; `null` = whole song; `applyPlaybackRangeFromHighlight` exists.
- Per-track: `changeTrackMute(tracks, mute)`, `changeTrackSolo(tracks, solo)`,
  `changeTrackVolume(tracks, volume)`, `changeTrackTranspositionPitch(tracks, semitones)`.
- Soundfont: `loadSoundFont(data)`, `loadSoundFontFromUrl(url)`.
- `exportAudio(options, ...)` exists (offline render) — not needed in v1 but useful later.

## Soundfont finding (changes §7.4 of the brief)

The npm package `@coderline/alphatab@1.8.4` ships `dist/soundfont/sonivox.sf2` (1.35 MB) and
`sonivox.sf3` (977 kB). A usable general-MIDI font is therefore ~1 MB, not 30–150 MB.
Decision: bundle `sonivox.sf3`, cache it in the service worker precache, done. A
higher-quality guitar-focused SF2 becomes an optional, lazy-loaded upgrade later, only if the
synth guitar sound grates.

## VERIFY at implementation time (small, listed so subagents don't guess)

- Exact `AutomationType` enum member name for sync points (page referenced but not fetched).
- Whether `PlayerMode.EnabledBackingTrack` requires the audio to be embedded in the file, or
  can be fed a blob (if the latter, M3 could use it instead of `EnabledExternalMedia`;
  external media is the safe default since we need two parallel audio elements anyway).
- GP7 export class name for persisting local tab corrections (`Gp7Exporter` believed to exist
  since 1.4 — confirm in `.d.ts`; fallback plan in ADR/data model if absent).
- `settings.core.enableLazyLoading` / partial-render settings names for long scores.
- iOS-specific guidance page (`platform/ios` docs) for audio-unlock behaviour with alphaSynth.
