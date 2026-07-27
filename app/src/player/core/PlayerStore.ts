// PlayerStore: the single state machine between the UI and alphaTab.
// UI components bind to the signals and call the methods; nothing outside
// this directory touches AlphaTabApi directly.
//
// alphaTab API usage in this file is verified against docs/03-alphatab-notes.md.

import * as alphaTab from '@coderline/alphatab'
import { signal, computed, type ReadonlySignal, type Signal } from '@preact/signals'

export type TransportState = 'stopped' | 'playing' | 'paused'

export interface TrackViewModel {
  index: number
  name: string
  isGuitar: boolean
  mute: boolean
  solo: boolean
  /** 0..1, alphaTab default 1 */
  volume: number
  transpositionPitch: number
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

  // --- methods ---
  loadScore(data: ArrayBuffer | Uint8Array): void
  playPause(): void
  stop(): void
  seekToTick(tick: number): void
  setSpeedPct(pct: number): void
  setLoop(region: LoopRegion | null): void
  setCountIn(enabled: boolean): void
  setMetronome(enabled: boolean): void
  setTrackMute(trackIndex: number, mute: boolean): void
  setTrackSolo(trackIndex: number, solo: boolean): void
  setTrackVolume(trackIndex: number, volume: number): void
  setTrackTransposition(trackIndex: number, semitones: number): void
  /** Which tracks are rendered as notation (the mixer affects audio for all). */
  setRenderedTracks(trackIndexes: number[]): void
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
    tracks.value = score.tracks.map((t) => ({
      index: t.index,
      name: t.name,
      isGuitar: GUITAR_MIDI_PROGRAMS.has(t.playbackInfo.program),
      mute: false,
      solo: false,
      volume: 1,
      transpositionPitch: 0,
    }))
    renderedTrackIndexes.value = score.tracks.map((t) => t.index)
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
        loop.value = null
        api.isLooping = false
        api.playbackRange = null
        return
      }
      const ticks = barRangeToTicks(region)
      if (!ticks) return
      loop.value = region
      api.isLooping = true
      api.playbackRange = ticks as alphaTab.synth.PlaybackRange
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

    setRenderedTracks(trackIndexes) {
      const score = api.score
      if (!score) return
      const selected = score.tracks.filter((t) => trackIndexes.includes(t.index))
      if (selected.length === 0) return
      renderedTrackIndexes.value = selected.map((t) => t.index)
      api.renderTracks(selected)
    },

    destroy() {
      api.destroy()
    },
  }

  return store
}
