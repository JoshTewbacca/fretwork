// PlayerStore: the single state machine between the UI and alphaTab.
// UI components bind to the signals and call the methods; nothing outside
// this directory touches AlphaTabApi directly.
//
// alphaTab API usage in this file is verified against docs/03-alphatab-notes.md.

import * as alphaTab from '@coderline/alphatab'
import { signal, computed, type ReadonlySignal, type Signal } from '@preact/signals'
import { DEFAULT_ZOOM_PCT, clampZoom } from './zoom'
import type { SyncMap } from '../../core/types'
import { applySyncMap, clearSyncPoints } from './syncPoints'
import {
  availableModes,
  createExternalMedia,
  type AudioMode,
  type AudioSources,
  type ExternalMediaController,
} from './externalMedia'

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
  /** String tuning as MIDI numbers, top tab line first. Empty for non-fretted
   *  instruments. Drives the tuner, which tunes to the song rather than to a
   *  generic E standard. */
  tuning: number[]
  /** e.g. "Drop D". Empty when the file names no tuning. */
  tuningName: string
}

export interface LoopRegion {
  startBar: number
  endBar: number
}

/** A named part of the song, as marked in the file: Intro, Verse, Chorus. */
export interface SongSection {
  /** Zero-based, inclusive. */
  startBar: number
  endBar: number
  label: string
}

/** A note the user tapped, flattened so the UI never touches alphaTab types. */
export interface SelectedNoteViewModel {
  fret: number
  /** alphaTab's 1-based string number. */
  string: number
  stringCount: number
  /** 1-based, for display. */
  barNumber: number
  trackIndex: number
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
  /**
   * Tempo in force at the current bar, already scaled by the speed setting -
   * the BPM you would set a metronome to right now, not what the file was
   * written at. Replaces the notation tempo band, which is not drawn.
   */
  readonly currentTempoBpm: ReadonlySignal<number>
  /** Which audio the user is playing along to. 'synth' when no bundle is loaded. */
  readonly audioMode: ReadonlySignal<AudioMode>
  /** Modes this song can offer, given whether it has a bundle and stems. */
  readonly availableAudioModes: ReadonlySignal<AudioMode[]>
  /** The loaded bundle's sync map, for reporting how well it will track. */
  readonly syncMap: ReadonlySignal<SyncMap | null>
  /** Named sections of the song, in order. Empty when the file marks none. */
  readonly sections: ReadonlySignal<SongSection[]>
  /** The section containing the playhead, or null. */
  readonly currentSection: ReadonlySignal<SongSection | null>
  readonly staveProfile: ReadonlySignal<StaveProfileName>
  /** True when a standard-notation stave is drawn above the tab. */
  readonly notationVisible: ReadonlySignal<boolean>
  /** False renders only the track being played, which keeps the tab large. */
  readonly showAllTracks: ReadonlySignal<boolean>
  readonly zoomPct: ReadonlySignal<number>
  /** The track the user plays; muted when backing mode is on. */
  readonly playerTrackIndex: ReadonlySignal<number>
  /** Synth backing track: the user's own part is muted, the rest plays. */
  readonly backingMode: ReadonlySignal<boolean>
  /** The note the user tapped in the score, or null. */
  readonly selectedNote: ReadonlySignal<SelectedNoteViewModel | null>
  /** True once the score has been edited and not yet saved. */
  readonly hasUnsavedCorrections: ReadonlySignal<boolean>

  // --- methods ---
  loadScore(data: ArrayBuffer | Uint8Array): void
  playPause(): void
  stop(): void
  seekToTick(tick: number): void
  /** Jump to the start of a zero-based bar. Used by the bar rail. */
  seekToBar(barIndex: number): void
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
  /**
   * Attach (or clear) the real recording for the loaded song. Passing null
   * returns the player to synth-only. Safe to call before or after the score
   * loads; the sync map is applied once a score is present.
   */
  setAudioSources(sources: AudioSources | null, syncMap: SyncMap | null): void
  /** Switch between the synth and the recording's stems. */
  setAudioMode(mode: AudioMode): void
  setStaveProfile(profile: StaveProfileName): void
  /** Show or hide the standard-notation stave, keeping the tab either way. */
  setNotationVisible(visible: boolean): void
  /** Render every track, or only the one being played. */
  setShowAllTracks(enabled: boolean): void
  setZoomPct(pct: number): void
  setPlayerTrack(trackIndex: number): void
  setBackingMode(enabled: boolean): void
  clearNoteSelection(): void
  /** Correct the tapped note's fret. Re-renders and regenerates playback. */
  setSelectedNoteFret(fret: number): void
  /** Move the tapped note to another string, bounded by the staff tuning. */
  setSelectedNoteString(stringNumber: number): void
  /**
   * Serialise the current (possibly corrected) score as a Guitar Pro 7 file,
   * so corrections can be persisted alongside the untouched original.
   */
  exportCorrectedScore(): Uint8Array | null
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
  /** Initial stave profile. Defaults to 'tab': notation is opt-in. */
  staveProfile?: StaveProfileName
  /** Initial zoom percentage. */
  zoomPct?: number
  /** Render every track rather than only the one being played. */
  showAllTracks?: boolean
}

const GUITAR_MIDI_PROGRAMS = new Set([24, 25, 26, 27, 28, 29, 30, 31])

/** Notation drawn inside the canvas that the app chrome already shows, or that
 *  only costs space on a phone. */
const HIDDEN_NOTATION_ELEMENTS = [
  alphaTab.NotationElement.ScoreTitle,
  alphaTab.NotationElement.ScoreSubTitle,
  alphaTab.NotationElement.ScoreArtist,
  alphaTab.NotationElement.ScoreAlbum,
  alphaTab.NotationElement.ScoreWords,
  alphaTab.NotationElement.ScoreMusic,
  alphaTab.NotationElement.ScoreWordsAndMusic,
  alphaTab.NotationElement.ScoreCopyright,
  // The rotated track name down the left edge. It costs a column on every
  // system to repeat what the app bar already says.
  alphaTab.NotationElement.TrackNames,
  // The tempo band. A file whose first bar carries both a score tempo and a
  // tempo automation draws both markers at the same x and they overlap into
  // an unreadable smear; and each change costs a tall band above the staff.
  // The dock shows the tempo in force instead, which also tracks the speed
  // setting rather than only stating what the file was written at.
  alphaTab.NotationElement.EffectTempo,
]

const STAVE_PROFILE_MAP: Record<StaveProfileName, alphaTab.StaveProfile> = {
  default: alphaTab.StaveProfile.Default,
  scoreTab: alphaTab.StaveProfile.ScoreTab,
  tab: alphaTab.StaveProfile.Tab,
  score: alphaTab.StaveProfile.Score,
}

/**
 * Render the score warm-on-dark instead of alphaTab's black-on-white default,
 * so the score field belongs to the app rather than sitting in it as a white
 * rectangle. Values mirror the --color-paper / --color-bone tokens in
 * src/index.css; keep them in step.
 */
function applyDarkNotationTheme(settings: alphaTab.Settings): void {
  const { Color } = alphaTab.model
  const resources = settings.display.resources
  const bone = (alpha: number) => new Color(0xed, 0xe6, 0xd6, alpha)

  resources.mainGlyphColor = bone(0xff)
  resources.secondaryGlyphColor = bone(0x9e)
  resources.scoreInfoColor = bone(0xcc)
  resources.staffLineColor = bone(0x4d)
  resources.barSeparatorColor = bone(0x82)
  // Bar numbers are navigation, not notation: amber ties them to the playhead
  // and the bar rail rather than alphaTab's default red.
  resources.barNumberColor = new Color(0xf0, 0xa9, 0x3b, 0xcc)
  // Fret numbers are the whole point of the screen, so they get a size of
  // their own rather than inheriting the notation-scaled default.
  resources.tablatureFont.size = 15
}

/**
 * Reclaim the horizontal space alphaTab reserves for a printed page. The
 * defaults are page-sized and, because padding is divided by the zoom scale,
 * they cost the same rendered pixels however far you zoom in: 35px on each
 * side is nearly a fifth of a 390px phone.
 *
 * stretchForce below 1 tightens the spacing between beats without shrinking
 * anything, so more bars fit per system. That is worth more than it sounds:
 * every system repeats the TAB clef, so fewer systems means less of the page
 * spent saying "TAB".
 */
function applyPhoneLayout(settings: alphaTab.Settings): void {
  settings.display.padding = [6, 10]
  settings.display.systemLabelPaddingRight = 0
  settings.display.accoladeBarPaddingRight = 0
  settings.display.firstStaffPaddingLeft = 2
  settings.display.staffPaddingLeft = 0
  settings.display.stretchForce = 0.8
}

/**
 * Dim the "TAB" clef that alphaTab draws at the head of every system.
 *
 * It cannot be hidden: the renderer adds it unconditionally for the first bar
 * of each staff and the styles API only exposes colour, not visibility. Drawn
 * at full strength it competes with the fret numbers on every line for no
 * information; at a third of that it reads as a quiet gutter mark, which is
 * all it needs to be.
 */
function dimTabClefs(score: alphaTab.model.Score): void {
  const { BarStyle, BarSubElement, Color } = alphaTab.model
  const dim = new Color(0xed, 0xe6, 0xd6, 0x59)
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        const style = bar.style ?? new BarStyle()
        style.colors.set(BarSubElement.GuitarTabsClef, dim)
        bar.style = style
      }
    }
  }
}

export function createPlayerStore(
  element: HTMLElement,
  options: PlayerStoreOptions,
): PlayerStore {
  const initialProfile: StaveProfileName = options.staveProfile ?? 'tab'
  const initialZoom = clampZoom(options.zoomPct ?? DEFAULT_ZOOM_PCT)
  const initialShowAllTracks = options.showAllTracks ?? false

  const settings = new alphaTab.Settings()
  // The alphatab-vite plugin copies the Bravura files to public/font/; the
  // automatic detection resolves to the pre-bundled dep URL in dev, which 404s.
  settings.core.fontDirectory = '/font/'
  settings.core.enableLazyLoading = true
  // Required for note-level hit detection, which the correction editor uses
  // to know which note was tapped (api.noteMouseDown only fires with this on).
  settings.core.includeNoteBounds = true
  settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
  settings.player.enableCursor = true
  settings.player.enableUserInteraction = true
  // Follow the cursor. alphaTab defaults scrollElement to "html,body", which
  // in this app never moves - the shell is a fixed 100dvh column and the score
  // element itself is the scroller - so without this the cursor simply walks
  // off the bottom of the screen and you scroll by hand while playing.
  //
  // OffScreen rather than Continuous: it only scrolls once the current system
  // would leave the viewport, so the tab holds still for a few systems and
  // then turns the page, instead of creeping on every system change.
  settings.player.scrollElement = element
  settings.player.scrollMode = alphaTab.ScrollMode.OffScreen
  // Leave a little headroom above the system being played rather than butting
  // it against the top edge.
  settings.player.scrollOffsetY = -16
  settings.display.scale = initialZoom / 100
  settings.display.staveProfile = STAVE_PROFILE_MAP[initialProfile]
  applyDarkNotationTheme(settings)
  applyPhoneLayout(settings)
  for (const notationElement of HIDDEN_NOTATION_ELEMENTS) {
    settings.notation.elements.set(notationElement, false)
  }

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
  // Tempo in force at each bar, resolved once at load. Built by carrying the
  // last automation forward, so seeking into the middle reports the right
  // tempo rather than only what the current bar happens to declare.
  const barTempos: Signal<number[]> = signal([])
  const sections: Signal<SongSection[]> = signal([])
  const audioMode: Signal<AudioMode> = signal('synth')
  const syncMap: Signal<SyncMap | null> = signal(null)
  const audioSources: Signal<AudioSources | null> = signal(null)
  // The live audio elements, kept out of any signal: the UI must not reach into
  // them, and replacing them is a side effect, not a state transition.
  let externalMedia: ExternalMediaController | null = null
  const staveProfile: Signal<StaveProfileName> = signal(initialProfile)
  const showAllTracks = signal(initialShowAllTracks)
  const zoomPct = signal(initialZoom)
  const playerTrackIndex = signal(0)
  const backingMode = signal(false)
  const selectedNote: Signal<SelectedNoteViewModel | null> = signal(null)
  const hasUnsavedCorrections = signal(false)
  // Last region the user looped, kept so the loop toggle is non-destructive.
  let lastLoopRegion: LoopRegion | null = null
  // The live alphaTab note behind selectedNote. Kept out of the signal so the
  // UI cannot reach into the score model.
  let selectedRawNote: alphaTab.model.Note | null = null

  function describeNote(note: alphaTab.model.Note): SelectedNoteViewModel {
    const staff = note.beat.voice.bar.staff
    return {
      fret: note.fret,
      string: note.string,
      stringCount: staff.tuning.length,
      barNumber: note.beat.voice.bar.index + 1,
      trackIndex: staff.track.index,
    }
  }

  /**
   * Re-render after a model edit. renderScore (rather than render) is required:
   * it regenerates the MIDI too, so playback reflects the corrected note
   * instead of continuing to play the original.
   */
  function applyScoreEdit() {
    const score = api.score
    if (!score) return
    hasUnsavedCorrections.value = true
    api.renderScore(score, renderedTrackIndexes.value)
    if (selectedRawNote) selectedNote.value = describeNote(selectedRawNote)
  }

  const scoreTitle = computed(() => (scoreLoaded.value ? (api.score?.title ?? '') : ''))
  const scoreArtist = computed(() => (scoreLoaded.value ? (api.score?.artist ?? '') : ''))
  const notationVisible = computed(
    () => staveProfile.value === 'scoreTab' || staveProfile.value === 'score',
  )
  const availableAudioModes = computed(() => availableModes(audioSources.value))

  /**
   * Push the score's sync points into the player. Only meaningful in external
   * media mode: in synth mode the points would warp alphaTab's own tempo to
   * chase an audio track that is not playing, so they are cleared instead.
   */
  function refreshSyncPoints() {
    const score = api.score
    if (!score) return
    const map = syncMap.value
    if (map && audioMode.value !== 'synth') applySyncMap(score, map)
    else clearSyncPoints(score)
    api.updateSyncPoints()
  }

  /** Hand alphaTab our audio, replacing the synth. */
  function attachExternalMedia(mode: Exclude<AudioMode, 'synth'>) {
    const sources = audioSources.value
    if (!sources) return

    externalMedia?.destroy()
    externalMedia = createExternalMedia(sources, mode, (ms) => {
      const output = api.player?.output as alphaTab.synth.IExternalMediaSynthOutput | undefined
      output?.updatePosition(ms)
    })

    // Changing playerMode makes alphaTab destroy the current player and build a
    // new one, so the handler can only be attached after updateSettings.
    api.settings.player.playerMode = alphaTab.PlayerMode.EnabledExternalMedia
    api.updateSettings()
    const output = api.player?.output as alphaTab.synth.IExternalMediaSynthOutput | undefined
    if (output) output.handler = externalMedia.handler
  }

  /** Give playback back to the synthesiser. */
  function attachSynth() {
    externalMedia?.destroy()
    externalMedia = null
    api.settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
    api.updateSettings()
    // The rebuilt synth starts with no soundfont, so it has to be loaded again
    // or the player is silent with no error.
    void api.loadSoundFontFromUrl(options.soundFontUrl, false)
  }

  const currentSection = computed(
    () =>
      sections.value.find(
        (section) =>
          currentBarIndex.value >= section.startBar && currentBarIndex.value <= section.endBar,
      ) ?? null,
  )
  const currentTempoBpm = computed(() => {
    const tempos = barTempos.value
    if (tempos.length === 0) return 0
    const base = tempos[Math.min(currentBarIndex.value, tempos.length - 1)]
    return Math.round((base * speedPct.value) / 100)
  })

  /**
   * Apply the current track-visibility rule. Rendering only the played track is
   * the default: it is what keeps the tab legible on a phone, since every extra
   * track costs a stave the user is not reading.
   */
  function applyRenderedTracks() {
    const score = api.score
    if (!score) return
    const selected = showAllTracks.value
      ? score.tracks
      : score.tracks.filter((t) => t.index === playerTrackIndex.value)
    if (selected.length === 0) return
    renderedTrackIndexes.value = selected.map((t) => t.index)
    api.renderTracks(selected)
  }

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
    selectedRawNote = null
    selectedNote.value = null
    hasUnsavedCorrections.value = false
    currentBarIndex.value = 0
    barCount.value = score.masterBars.length
    dimTabClefs(score)
    // Sections run from their own marker to the next one, so each is only
    // known once the following marker is found (or the song ends).
    const found: SongSection[] = []
    score.masterBars.forEach((masterBar, index) => {
      const marker = masterBar.section
      if (!marker) return
      const label = (marker.text || marker.marker || '').trim()
      if (!label) return
      const previous = found[found.length - 1]
      if (previous) previous.endBar = index - 1
      found.push({ startBar: index, endBar: score.masterBars.length - 1, label })
    })
    sections.value = found

    let tempo = score.tempo
    barTempos.value = score.masterBars.map((masterBar) => {
      const automations = masterBar.tempoAutomations
      if (automations.length > 0) tempo = automations[automations.length - 1].value
      return tempo
    })
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
      tuning: t.staves[0]?.tuning ?? [],
      tuningName: t.staves[0]?.tuningName ?? '',
    }))
    // Default the "your part" selection to the first guitar track, then render
    // to match: with showAllTracks off this is what makes the tab large.
    const firstGuitar = tracks.value.find((t) => t.isGuitar)
    playerTrackIndex.value = firstGuitar ? firstGuitar.index : 0
    applyRenderedTracks()
    // A freshly loaded score carries no sync points, so re-apply for the case
    // where a bundle was attached before the score arrived.
    refreshSyncPoints()
  })

  api.playedBeatChanged.on((beat) => {
    currentBarIndex.value = beat.voice.bar.index
  })

  // Requires settings.core.includeNoteBounds, set above.
  api.noteMouseDown.on((note) => {
    selectedRawNote = note
    selectedNote.value = describeNote(note)
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
    currentTempoBpm,
    audioMode,
    availableAudioModes,
    syncMap,
    sections,
    currentSection,
    staveProfile,
    notationVisible,
    showAllTracks,
    zoomPct,
    playerTrackIndex,
    backingMode,
    selectedNote,
    hasUnsavedCorrections,
    api,

    loadScore(data) {
      error.value = null
      scoreLoaded.value = false
      // Drop the previous song's recording before loading the next one, so a
      // song switch can never leave the wrong audio attached. The caller
      // re-attaches the new song's bundle once it has one.
      if (audioSources.value !== null) store.setAudioSources(null, null)
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

    seekToBar(barIndex) {
      const clamped = Math.min(Math.max(0, Math.round(barIndex)), Math.max(0, barCount.value - 1))
      const ticks = barRangeToTicks({ startBar: clamped, endBar: clamped })
      if (!ticks) return
      api.tickPosition = ticks.startTick
      currentBarIndex.value = clamped
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

    setAudioSources(sources, map) {
      audioSources.value = sources
      syncMap.value = map
      if (sources === null) {
        // Nothing to play along to: fall back rather than leaving the player
        // pointed at audio that no longer exists.
        if (audioMode.value !== 'synth') store.setAudioMode('synth')
        else refreshSyncPoints()
        return
      }
      // Re-attach if we were already on the recording, so swapping songs does
      // not silently keep the previous one's audio.
      if (audioMode.value !== 'synth') {
        attachExternalMedia(audioMode.value)
      }
      refreshSyncPoints()
    },

    setAudioMode(mode) {
      if (!availableAudioModes.value.includes(mode)) return
      if (mode === audioMode.value) return

      const wasExternal = audioMode.value !== 'synth'
      audioMode.value = mode

      if (mode === 'synth') {
        attachSynth()
      } else if (wasExternal && externalMedia) {
        // Already on the recording: this is only a change of which stems are
        // audible, so do not rebuild the player and lose the position.
        externalMedia.setMode(mode)
      } else {
        attachExternalMedia(mode)
      }
      refreshSyncPoints()
    },

    setStaveProfile(profile) {
      if (staveProfile.value === profile) return
      staveProfile.value = profile
      api.settings.display.staveProfile = STAVE_PROFILE_MAP[profile]
      api.updateSettings()
      api.render()
    },

    setNotationVisible(visible) {
      store.setStaveProfile(visible ? 'scoreTab' : 'tab')
    },

    setShowAllTracks(enabled) {
      if (showAllTracks.value === enabled) return
      showAllTracks.value = enabled
      applyRenderedTracks()
    },

    setZoomPct(pct) {
      const clamped = clampZoom(pct)
      if (zoomPct.value === clamped) return
      zoomPct.value = clamped
      api.settings.display.scale = clamped / 100
      api.updateSettings()
      api.render()
    },

    setPlayerTrack(trackIndex) {
      const previous = playerTrackIndex.value
      if (previous === trackIndex) return
      playerTrackIndex.value = trackIndex
      // Move the backing-track mute with the selection.
      if (backingMode.value) {
        store.setTrackMute(previous, false)
        store.setTrackMute(trackIndex, true)
      }
      // When only the played part is drawn, changing part changes the score.
      if (!showAllTracks.value) applyRenderedTracks()
    },

    setBackingMode(enabled) {
      backingMode.value = enabled
      store.setTrackMute(playerTrackIndex.value, enabled)
    },

    clearNoteSelection() {
      selectedRawNote = null
      selectedNote.value = null
    },

    setSelectedNoteFret(fret) {
      const note = selectedRawNote
      if (!note) return
      const clamped = Math.min(36, Math.max(0, Math.round(fret)))
      if (note.fret === clamped) return
      note.fret = clamped
      applyScoreEdit()
    },

    setSelectedNoteString(stringNumber) {
      const note = selectedRawNote
      if (!note) return
      const count = note.beat.voice.bar.staff.tuning.length
      const clamped = Math.min(count, Math.max(1, Math.round(stringNumber)))
      if (note.string === clamped) return
      note.string = clamped
      applyScoreEdit()
    },

    exportCorrectedScore() {
      const score = api.score
      if (!score) return null
      const exporter = new alphaTab.exporter.Gp7Exporter()
      return exporter.export(score, api.settings)
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
      externalMedia?.destroy()
      externalMedia = null
      api.destroy()
    },
  }

  return store
}
