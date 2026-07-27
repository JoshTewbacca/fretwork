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

## Formerly-VERIFY items — resolved against the installed 1.8.4 `.d.ts` (2026-07-27)

- `AutomationType.SyncPoint = 4`. (Quirk: `AutomationType.Bank` is also `4` in the enum —
  always construct sync points explicitly, never infer type from the numeric value.)
- `PlayerMode` members confirmed: `Disabled=0, EnabledAutomatic=1, EnabledSynthesizer=2,
  EnabledBackingTrack=3, EnabledExternalMedia=4`. A `BackingTrack` class exists on the data
  model holding "the data of the raw audio file", so a blob *can* be attached
  programmatically for `EnabledBackingTrack`. We still use `EnabledExternalMedia` for M3
  because full-mix mode needs two parallel audio elements (backing + guitar) under our
  control; `EnabledBackingTrack` remains a fallback option for single-file playback.
- `Gp7Exporter extends ScoreExporter { writeScore(score) }` exists — the corrected-tab
  persistence path in the data model is viable as designed.
- `CoreSettings.enableLazyLoading: boolean` exists; `renderFinished` semantics under lazy
  loading documented on the event (partial images render on demand via
  `IScoreRenderer.partialLayoutFinished` / `partialRenderFinished`).

Still open (check during M0 implementation, low risk): iOS audio-unlock specifics with
alphaSynth (`platform/ios` docs page) — handled defensively in the player core regardless.

## Second verification pass (M0 controls, 2026-07-27)

- `StaveProfile` enum: `Default=0, ScoreTab=1, Score=2, Tab=3, TabMixed=4`. Set via
  `settings.display.staveProfile`, then `api.updateSettings()` and `api.render()`.
- `api.applyPlaybackRangeFromHighlight()` adopts a range the user selected by dragging over
  the score — this is the cheap path to "loop this passage" without building a custom
  selection system. `api.clearSelection()` exists for custom handle-based selection later.
- Capo and transposition live on `Staff`: `capo`, `transpositionPitch` (render + playback)
  and `displayTranspositionPitch` (render only). Settings-level equivalents exist as
  `settings.display.transpositionPitches[]` / `displayTranspositionPitches[]`.
- `api.playedBeatChanged` yields a `Beat`; the master bar index is `beat.voice.bar.index`,
  which is how the practice engine will locate the current bar.

### Not available: left-handed rendering

**alphaTab 1.8.4 has no left-handed rendering support.** A search for "handed" across the
entire shipped type definitions returns zero matches, and there is no string-order or
mirroring option on `DisplaySettings`. The brief lists left-handed rendering in the M0
feature set; it cannot be built at this version.

Rejected workaround: a CSS `transform: scaleX(-1)` on the score container mirrors the
glyphs, fret numbers and text along with the staff, producing unreadable output.

Options if this matters to the owner: raise it upstream with alphaTab, or reverse string
order in a fork of the tab renderer (a large change, disproportionate for a single-user app
whose owner has not said they play left-handed). Deferred pending a decision.
