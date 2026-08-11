// Playing along to the real recording.
//
// In EnabledExternalMedia mode alphaTab renders and moves the cursor while we
// own the audio entirely: play, pause, seek, volume and rate are ours, and we
// feed alphaTab the position so it knows where in the score that audio time
// lands (via the sync points from syncPoints.ts).
//
// Two elements rather than one because stem separation gives us the backing and
// the guitar as separate files, and the interesting modes are combinations of
// the two. Before separation has run a bundle has only the full mix, which
// arrives as `backingUrl` alone.

import * as alphaTab from '@coderline/alphatab'

/**
 * - `synth`   - alphaTab's own synthesiser, no recording involved.
 * - `full`    - the whole recording.
 * - `backing`  - the recording with the guitar removed. Needs stems.
 * - `guitar`  - the isolated guitar, to hear how it should sound. Needs stems.
 */
export type AudioMode = 'synth' | 'full' | 'backing' | 'guitar'

export interface AudioSources {
  /** Everything but the guitar once stems exist; the full mix before that. */
  backingUrl: string
  /** The isolated guitar. Absent until separation has run. */
  guitarUrl?: string
  durationMs: number
}

/** Per-element gain for each mode. */
const MIX: Record<Exclude<AudioMode, 'synth'>, { backing: number; guitar: number }> = {
  full: { backing: 1, guitar: 1 },
  backing: { backing: 1, guitar: 0 },
  guitar: { backing: 0, guitar: 1 },
}

/**
 * Which modes this bundle can offer. Without a guitar stem `backing` and
 * `guitar` are indistinguishable from `full`, so they are not offered rather
 * than being offered and quietly doing nothing.
 */
export function availableModes(sources: AudioSources | null): AudioMode[] {
  if (!sources) return ['synth']
  if (!sources.guitarUrl) return ['synth', 'full']
  return ['synth', 'full', 'backing', 'guitar']
}

/**
 * Past this much drift between the two elements, nudge the guitar back onto the
 * backing. Below it, leave them alone: correcting constantly is audible, and two
 * elements started together stay close enough for practice.
 */
const MAX_DRIFT_MS = 45

export interface ExternalMediaController {
  readonly handler: alphaTab.synth.IExternalMediaHandler
  /** Change which stems are audible. Does not stop playback. */
  setMode(mode: Exclude<AudioMode, 'synth'>): void
  destroy(): void
}

/**
 * Build the controller and the handler alphaTab talks to.
 *
 * `onPosition` receives the audio position in milliseconds and is expected to
 * forward it to alphaTab's output; the store wires that up, because only it
 * holds the api reference. `onProblem` receives anything the elements refuse to
 * do, which the store turns into a message: a failure here is otherwise
 * invisible, since alphaTab believes it is playing either way.
 */
export function createExternalMedia(
  sources: AudioSources,
  initialMode: Exclude<AudioMode, 'synth'>,
  onPosition: (ms: number) => void,
  onProblem: (message: string) => void = () => {},
): ExternalMediaController {
  const backing = createElement(sources.backingUrl)
  const guitar = sources.guitarUrl ? createElement(sources.guitarUrl) : null

  for (const element of [backing, guitar]) {
    if (!element) continue
    element.addEventListener('error', () => onProblem(describeMediaError(element)))
  }

  /**
   * Start one element, reporting a refusal rather than dropping it. The call
   * itself is synchronous, so this stays inside the user gesture that iOS
   * requires; only the outcome is awaited.
   */
  function start(element: HTMLAudioElement) {
    element.play().catch((err: unknown) => {
      const name = err instanceof Error ? err.name : ''
      onProblem(
        name === 'NotAllowedError'
          ? 'This device would not start the recording without a tap. Press play again.'
          : `The recording would not start: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }

  let mode = initialMode
  let masterVolume = 1
  let frame = 0

  function applyVolumes() {
    const mix = MIX[mode]
    backing.volume = clamp01(masterVolume * mix.backing)
    if (guitar) guitar.volume = clamp01(masterVolume * mix.guitar)
  }

  function pump() {
    frame = requestAnimationFrame(pump)
    // Keep the guitar with the backing. The backing element is the clock: it is
    // the one that always exists.
    if (guitar && !guitar.paused) {
      const drift = (guitar.currentTime - backing.currentTime) * 1000
      if (Math.abs(drift) > MAX_DRIFT_MS) guitar.currentTime = backing.currentTime
    }
    // Documented shape from alphaTab's audio-sync guide (see
    // docs/03-alphatab-notes.md). At rate 1 the division is a no-op; it is kept
    // as documented rather than second-guessed, and is the first thing to
    // revisit if the cursor drifts at speeds other than 100%.
    onPosition((backing.currentTime / (backing.playbackRate || 1)) * 1000)
  }

  function startPump() {
    if (frame === 0) frame = requestAnimationFrame(pump)
  }

  function stopPump() {
    if (frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    // One final position so the cursor lands exactly where the audio stopped
    // rather than one frame behind it.
    onPosition((backing.currentTime / (backing.playbackRate || 1)) * 1000)
  }

  applyVolumes()

  const handler: alphaTab.synth.IExternalMediaHandler = {
    get backingTrackDuration() {
      // Prefer the element's own idea once it has metadata: the manifest value
      // is what the encoder reported and the two can differ by a few ms.
      const measured = backing.duration
      return Number.isFinite(measured) && measured > 0 ? measured * 1000 : sources.durationMs
    },
    get playbackRate() {
      return backing.playbackRate
    },
    set playbackRate(value: number) {
      const rate = Math.max(0.25, Math.min(2, value))
      backing.playbackRate = rate
      if (guitar) guitar.playbackRate = rate
    },
    get masterVolume() {
      return masterVolume
    },
    set masterVolume(value: number) {
      masterVolume = clamp01(value)
      applyVolumes()
    },
    seekTo(timeMs: number) {
      const seconds = Math.max(0, timeMs / 1000)
      backing.currentTime = seconds
      if (guitar) guitar.currentTime = seconds
      onPosition(timeMs)
    },
    play() {
      // Both elements are started in the same task so they begin together;
      // whatever drift survives that is what the pump corrects.
      start(backing)
      if (guitar) start(guitar)
      startPump()
    },
    pause() {
      backing.pause()
      if (guitar) guitar.pause()
      stopPump()
    },
  }

  return {
    handler,
    setMode(next) {
      mode = next
      applyVolumes()
    },
    destroy() {
      stopPump()
      for (const element of [backing, guitar]) {
        if (!element) continue
        element.pause()
        element.removeAttribute('src')
        element.load()
      }
    },
  }
}

/**
 * What the element could not do, in words worth showing. MEDIA_ERR_SRC_NOT
 * SUPPORTED is the one to expect on a phone: the file decoded on the desktop
 * that built it, and this browser will not take it.
 */
function describeMediaError(element: HTMLAudioElement): string {
  const code = element.error?.code
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return 'This device cannot play the downloaded recording. Rebuild the bundle as AAC on the desktop, or use Synth.'
  }
  if (code === MediaError.MEDIA_ERR_DECODE) {
    return 'The downloaded recording is damaged. Download it from the desktop again.'
  }
  return `The recording could not be loaded${element.error?.message ? `: ${element.error.message}` : '.'}`
}

function createElement(url: string): HTMLAudioElement {
  const element = new Audio()
  element.src = url
  element.preload = 'auto'
  // Nothing here should duck to a ringtone or restart on its own.
  element.loop = false
  return element
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
