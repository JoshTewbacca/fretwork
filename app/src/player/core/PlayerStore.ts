// PlayerStore: the single state machine between the UI and alphaTab.
// UI components bind to the signals and call the methods; nothing outside
// this directory touches AlphaTabApi directly.
//
// alphaTab API usage in this file is verified against docs/03-alphatab-notes.md.

import * as alphaTab from '@coderline/alphatab'
import { signal, computed, type ReadonlySignal, type Signal } from '@preact/signals'

export type TransportState = 'stopped' | 'playing' | 'paused'

/**
 * Which staves are drawn. 'default' lets alphaTab decide per track.
 * Note: alphaTab 1.8.4 has no left-handed rendering option, so the brief's
 * left-handed requirement is not implementable at this version.
 */
export type StaveProfileName = 'default' | 'scoreTab' | 'tab' | 'score'

export interface TrackViewModel {
  index: number
  name: string
  isGuitar: boolean
  mute: boolean
  solo: boolean
  /** 0..1, alphaTab default 1 */
  volume: number
  transpositionPitch: number
  capo: number
}

export interface LoopRegion {
  startBar: number
  endBar: number
}

export interface PlayerStore {
  // --- state (bind, do not mutate) ---
  readonly scoreLoaded: ReadonlySignal<boolean>
  readonly playerReady: ReadonlySignal<boolean>
  readonly transport: ReadonlySignal<TransportState>
  readonly currentTick: ReadonlySignal<number>
  readonly currentTimeMs: ReadonlySignal<number>
  readonly endTimeMs: ReadonlySignal<number>
  readonly speedPct: ReadonlySignal<number>
  readonly loop: ReadonlySignal<LoopRegion | null>
  readonly countInEnabled: ReadonlySignal<boolean>
  readonly metronomeEnabled: ReadonlySignal<boolean>
  readonly tracks: ReadonlySignal<TrackViewModel[]>
  readonly renderedTrackIndexes: ReadonlySignal<number[]>
  readonly scoreTitle: ReadonlySignal<string>
  readonly scoreArtist: ReadonlySignal<string>
  readonly error: ReadonlySignal<string | null>
  /** true once the audio context was unlocked by a user gesture */
  readonly audioUnlocked: ReadonlySignal<boolean>
  /** Zero-based master bar index of the beat currently being played. */
  readonly currentBarIndex: ReadonlySignal<number>
  readonly barCount: ReadonlySignal<number>
  readonly staveProfile: ReadonlySignal<StaveProfileName>
  readonly zoomPct: ReadonlySignal<number>
  /** The track the user plays; muted when backing mode is on. */
  readonly playerTrackIndex: ReadonlySignal<number>
  /** Synth backing track: the user's own part is muted, the rest plays. */
  readonly backingMode: ReadonlySignal<boolean>

  // --- methods ---
  loadScore(data: ArrayBuffer | Uint8Array): void
  playPause(): void
  stop(): void
  seekToTick(tick: number): void
  setSpeedPct(pct: number): void
  setLoop(region: LoopRegion | null): void
  /**
   * Turn looping off and on without losing the region. Re-enabling restores the
   * last region used; if there is none, it falls back to the current bar.
   */
  setLoopEnabled(enabled: boolean): void
  setCountIn(enabled: boolean): void
  setMetronome(enabled: boolean): void
  setTrackMute(trackIndex: number, mute: boolean): void
  setTrackSolo(trackIndex: number, solo: boolean): void
  setTrackVolume(trackIndex: number, volume: number): void
  setTrackTransposition(trackIndex: number, semitones: number): void
  /** Capo fret for a track; affects rendering and playback. */
  setTrackCapo(trackIndex: number, fret: number): void
  /** Which tracks are rendered as notation (the mixer affects audio for all). */
  setRenderedTracks(trackIndexes: number[]): void
  setStaveProfile(profile: StaveProfileName): void
  setZoomPct(pct: number): void
  setPlayerTrack(trackIndex: number): void
  setBackingMode(enabled: boolean): void
  /** Loop the bar currently under the cursor. */
  loopCurrentBar(): void
  /** Adopt a range the user selected by dragging across the score. */
  loopFromSelection(): void
  destroy(): void

  /** Escape hatch for Opus-owned integration code only (sync points, editor). */
  readonly api: alphaTab.AlphaTabApi
}

export interface PlayerStoreOptions {
  /** URL for the soundfont; defaults to the bundled sonivox.sf3 asset URL. */
  soundFontUrl: string
}

const GUITAR_MIDI_PROGRAMS = new Set([24, 25, 26, 27, 28, 29, 30, 31])

export function createPlayerStore(
  element: HTMLElement,
  options: PlayerStoreOptions,
): PlayerStore {
  const settings = new alphaTab.Settings()
  // The alphatab-vite plugin copies the Bravura files to public/font/; the
  // automatic detection resolves to the pre-bundled dep URL in dev, which 404s.
  settings.core.fontDirectory = '/font/'
  settings.core.enableLazyLoading = true
  settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
  settings.player.enableCursor = true
  settings.player.enableUserInteraction = true
  settings.display.scale = 0.9

  const api = new alphaTab.AlphaTabApi(element, settings)

  const scoreLoaded = signal(false)
  const playerReady = signal(false)
  const transport: Signal<TransportState> = signal('stopped')
  const currentTick = signal(0)
  const currentTimeMs = signal(0)
  const endTimeMs = signal(0)
  const speedPct = signal(100)
  const loop: Signal<LoopRegion | null> = signal(null)
  const countInEnabled = signal(false)
  const metronomeEnabled = signal(false)
  const tracks: Signal<TrackViewModel[]> = signal([])
  const renderedTrackIndexes: Signal<number[]> = signal([])
  const error: Signal<string | null> = signal(null)
  const audioUnlocked = signal(false)
  const currentBarIndex = signal(0)
  const barCount = signal(0)
  const staveProfile: Signal<StaveProfileName> = signal('default')
  const zoomPct = signal(90)
  const playerTrackIndex = signal(0)
  const backingMode = signal(false)
  // Last region the user looped, kept so the loop toggle is non-destructive.
  let lastLoopRegion: LoopRegion | null = null

  const scoreTitle = computed(() => (scoreLoaded.value ? (api.score?.title ?? '') : ''))
  const scoreArtist = computed(() => (scoreLoaded.value ? (api.score?.artist ?? '') : ''))

  api.soundFontLoaded.on(() => {
    // no state needed beyond playerReady; kept for debug logging hooks later
  })
  void api.loadSoundFontFromUrl(options.soundFontUrl, false)

  api.error.on((e) => {
    error.value = String(e.message ?? e)
  })

  api.scoreLoaded.on((score) => {
    scoreLoaded.value = true
    loop.value = null
    lastLoopRegion = null
    backingMode.value = false
    currentBarIndex.value = 0
    barCount.value = score.masterBars.length
    tracks.value = score.tracks.map((t) => ({
      index: t.index,
      // Not every file names its tracks; never render a blank row.
      name: t.name?.trim() || `Track ${t.index + 1}`,
      isGuitar: GUITAR_MIDI_PROGRAMS.has(t.playbackInfo.program),
      mute: false,
      solo: false,
      volume: 1,
      transpositionPitch: 0,
      capo: t.staves[0]?.capo ?? 0,
    }))
    renderedTrackIndexes.value = score.tracks.map((t) => t.index)
    // Default the "your part" selection to the first guitar track.
    const firstGuitar = tracks.value.find((t) => t.isGuitar)
    playerTrackIndex.value = firstGuitar ? firstGuitar.index : 0
  })

  api.playedBeatChanged.on((beat) => {
    currentBarIndex.value = beat.voice.bar.index
  })

  api.playerReady.on(() => {
    playerReady.value = true
  })

  api.playerStateChanged.on((args) => {
    transport.value =
      args.state === alphaTab.synth.PlayerState.Playing
        ? 'playing'
        : args.stopped
          ? 'stopped'
          : 'paused'
  })

  // Cursor/practice timing derives from player position events only (audio
  // clock domain). Never from wall-clock timers - see brief section 7.1.
  api.playerPositionChanged.on((args) => {
    currentTick.value = args.currentTick
    currentTimeMs.value = args.currentTime
    endTimeMs.value = args.endTime
  })

  api.playerFinished.on(() => {
    transport.value = 'stopped'
  })

  function barRangeToTicks(region: LoopRegion): { startTick: number; endTick: number } | null {
    const cache = api.tickCache
    if (!cache) return null
    let startTick: number | null = null
    let endTick: number | null = null
    // First occurrence of each bar; masterBars are sorted by time.
    for (const mb of cache.masterBars) {
      const idx = mb.masterBar.index
      if (idx === region.startBar && startTick === null) startTick = mb.start
      if (idx === region.endBar && endTick === null) endTick = mb.end
      if (startTick !== null && endTick !== null) break
    }
    if (startTick === null || endTick === null) return null
    return { startTick, endTick }
  }

  const store: PlayerStore = {
    scoreLoaded,
    playerReady,
    transport,
    currentTick,
    currentTimeMs,
    endTimeMs,
    speedPct,
    loop,
    countInEnabled,
    metronomeEnabled,
    tracks,
    renderedTrackIndexes,
    scoreTitle,
    scoreArtist,
    error,
    audioUnlocked,
    currentBarIndex,
    barCount,
    staveProfile,
    zoomPct,
    playerTrackIndex,
    backingMode,
    api,

    loadScore(data) {
      error.value = null
      scoreLoaded.value = false
      const ok = api.load(data)
      if (!ok) error.value = 'The file could not be read as a tab.'
    },

    playPause() {
      audioUnlocked.value = true // any transport action is a user gesture
      api.playPause()
    },

    stop() {
      api.stop()
    },

    seekToTick(tick) {
      api.tickPosition = tick
    },

    setSpeedPct(pct) {
      const clamped = Math.min(125, Math.max(25, Math.round(pct)))
      speedPct.value = clamped
      api.playbackSpeed = clamped / 100
    },

    setLoop(region) {
      if (region === null) {
        // Remember it so toggling loop off and on again returns to the same
        // passage instead of jumping to wherever the cursor happens to be.
        if (loop.value) lastLoopRegion = loop.value
        loop.value = null
        api.isLooping = false
        api.playbackRange = null
        return
      }
      const ticks = barRangeToTicks(region)
      if (!ticks) return
      loop.value = region
      lastLoopRegion = region
      api.isLooping = true
      api.playbackRange = ticks as alphaTab.synth.PlaybackRange
    },

    setLoopEnabled(enabled) {
      if (!enabled) {
        store.setLoop(null)
        return
      }
      if (lastLoopRegion) store.setLoop(lastLoopRegion)
      else store.loopCurrentBar()
    },

    setCountIn(enabled) {
      countInEnabled.value = enabled
      api.countInVolume = enabled ? 1 : 0
    },

    setMetronome(enabled) {
      metronomeEnabled.value = enabled
      api.metronomeVolume = enabled ? 1 : 0
    },

    setTrackMute(trackIndex, mute) {
      const t = api.score?.tracks[trackIndex]
      if (!t) return
      api.changeTrackMute([t], mute)
      tracks.value = tracks.value.map((tv) => (tv.index === trackIndex ? { ...tv, mute } : tv))
    },

    setTrackSolo(trackIndex, solo) {
      const t = api.score?.tracks[trackIndex]
      if (!t) return
      api.changeTrackSolo([t], solo)
      tracks.value = tracks.value.map((tv) => (tv.index === trackIndex ? { ...tv, solo } : tv))
    },

    setTrackVolume(trackIndex, volume) {
      const t = api.score?.tracks[trackIndex]
      if (!t) return
      api.changeTrackVolume([t], volume)
      tracks.value = tracks.value.map((tv) =>
        tv.index === trackIndex ? { ...tv, volume } : tv,
      )
    },

    setTrackTransposition(trackIndex, semitones) {
      const t = api.score?.tracks[trackIndex]
      if (!t) return
      api.changeTrackTranspositionPitch([t], semitones)
      tracks.value = tracks.value.map((tv) =>
        tv.index === trackIndex ? { ...tv, transpositionPitch: semitones } : tv,
      )
    },

    setTrackCapo(trackIndex, fret) {
      const t = api.score?.tracks[trackIndex]
      if (!t) return
      const clamped = Math.min(12, Math.max(0, Math.round(fret)))
      for (const staff of t.staves) staff.capo = clamped
      tracks.value = tracks.value.map((tv) =>
        tv.index === trackIndex ? { ...tv, capo: clamped } : tv,
      )
      api.render()
    },

    setRenderedTracks(trackIndexes) {
      const score = api.score
      if (!score) return
      const selected = score.tracks.filter((t) => trackIndexes.includes(t.index))
      if (selected.length === 0) return
      renderedTrackIndexes.value = selected.map((t) => t.index)
      api.renderTracks(selected)
    },

    setStaveProfile(profile) {
      staveProfile.value = profile
      const map: Record<StaveProfileName, alphaTab.StaveProfile> = {
        default: alphaTab.StaveProfile.Default,
        scoreTab: alphaTab.StaveProfile.ScoreTab,
        tab: alphaTab.StaveProfile.Tab,
        score: alphaTab.StaveProfile.Score,
      }
      api.settings.display.staveProfile = map[profile]
      api.updateSettings()
      api.render()
    },

    setZoomPct(pct) {
      const clamped = Math.min(180, Math.max(50, Math.round(pct)))
      zoomPct.value = clamped
      api.settings.display.scale = clamped / 100
      api.updateSettings()
      api.render()
    },

    setPlayerTrack(trackIndex) {
      const previous = playerTrackIndex.value
      playerTrackIndex.value = trackIndex
      // Move the backing-track mute with the selection.
      if (backingMode.value) {
        store.setTrackMute(previous, false)
        store.setTrackMute(trackIndex, true)
      }
    },

    setBackingMode(enabled) {
      backingMode.value = enabled
      store.setTrackMute(playerTrackIndex.value, enabled)
    },

    loopCurrentBar() {
      const bar = currentBarIndex.value
      store.setLoop({ startBar: bar, endBar: bar })
    },

    loopFromSelection() {
      api.applyPlaybackRangeFromHighlight()
      api.isLooping = true
      const range = api.playbackRange
      if (!range) return
      // Reflect the adopted range in bar terms for the UI.
      const cache = api.tickCache
      if (!cache) return
      let startBar: number | null = null
      let endBar: number | null = null
      for (const mb of cache.masterBars) {
        if (startBar === null && mb.end > range.startTick) startBar = mb.masterBar.index
        if (mb.start < range.endTick) endBar = mb.masterBar.index
      }
      if (startBar !== null && endBar !== null) {
        loop.value = { startBar, endBar }
      }
    },

    destroy() {
      api.destroy()
    },
  }

  return store
}
