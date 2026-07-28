// The tuner panel of the player sheet.
//
// What makes it worth building rather than reaching for a separate app: it
// already knows what the song is tuned to. alphaTab gives us the loaded
// staff's tuning, so a drop-D or Eb song tunes you to itself instead of to a
// generic E standard you would then have to correct by hand.

import { useEffect, useRef, useState } from 'preact/hooks'
import {
  detectPitchHz,
  matchChromatic,
  matchToTuning,
  medianHz,
  noteName,
} from './pitch'
import './tuner.css'

/** Within this many cents a string is called in tune. */
const IN_TUNE_CENTS = 5

/** Analysis passes a string must stay in tune before it counts as done.
 *  At the interval below that is roughly three quarters of a second. */
const HOLD_FRAMES = 15

/** How many readings the median smooths over. */
const SMOOTHING = 6

/**
 * Analyse every Nth frame. YIN is a million multiply-adds a pass, and a string
 * does not change pitch fast enough to justify running it sixty times a second
 * on a phone that is also rendering a score.
 */
const FRAME_INTERVAL = 3

/** Cents at the far end of the meter. */
const METER_RANGE = 50

type MicState = 'idle' | 'starting' | 'listening' | 'denied' | 'unsupported'

export interface TunerProps {
  /** MIDI numbers, top tab line first. Empty when no score is loaded. */
  tuning: readonly number[]
  tuningName: string
}

interface Reading {
  midi: number
  cents: number
  stringIndex: number | null
}

export function Tuner({ tuning, tuningName }: TunerProps) {
  const [micState, setMicState] = useState<MicState>('idle')
  const [reading, setReading] = useState<Reading | null>(null)
  const [tuned, setTuned] = useState<Set<number>>(new Set())

  // Kept in refs: the animation loop reads them every frame and must not
  // re-subscribe or restart the mic when they change.
  const recent = useRef<number[]>([])
  const holding = useRef<{ stringIndex: number; frames: number } | null>(null)
  const tuningRef = useRef(tuning)
  tuningRef.current = tuning

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setMicState('unsupported')
      return
    }

    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false

    setMicState('starting')
    void (async () => {
      try {
        // The processing a browser applies to speech destroys pitch, so every
        // bit of it is turned off.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        if (cancelled) return
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 2048
        context.createMediaStreamSource(stream).connect(analyser)

        const samples = new Float32Array(analyser.fftSize)
        setMicState('listening')
        let frameCount = 0

        // Only re-render when the displayed value actually changes: the last
        // frame's is kept so a held note does not restate itself sixty times.
        const publish = (next: Reading | null) => {
          setReading((prev) => {
            if (prev === null && next === null) return prev
            if (
              prev !== null &&
              next !== null &&
              prev.midi === next.midi &&
              prev.stringIndex === next.stringIndex &&
              Math.round(prev.cents) === Math.round(next.cents)
            ) {
              return prev
            }
            return next
          })
        }

        const tick = () => {
          frame = requestAnimationFrame(tick)
          if (frameCount++ % FRAME_INTERVAL !== 0) return
          analyser.getFloatTimeDomainData(samples)
          const hz = detectPitchHz(samples, context!.sampleRate)

          if (hz === null) {
            // Decay rather than clear, so the display survives the gap
            // between one pluck and the next.
            recent.current = recent.current.slice(1)
            if (recent.current.length === 0) {
              publish(null)
              holding.current = null
            }
            return
          }

          recent.current = [...recent.current, hz].slice(-SMOOTHING)
          const smoothed = medianHz(recent.current)
          if (smoothed === null) return

          const active = tuningRef.current
          const match = active.length > 0 ? matchToTuning(smoothed, active) : null
          if (match) {
            publish({
              midi: match.targetMidi,
              cents: match.cents,
              stringIndex: match.stringIndex,
            })
            trackHold(match.stringIndex, match.cents)
          } else {
            const chromatic = matchChromatic(smoothed)
            publish({ midi: chromatic.targetMidi, cents: chromatic.cents, stringIndex: null })
            holding.current = null
          }
        }

        const trackHold = (stringIndex: number, cents: number) => {
          if (Math.abs(cents) > IN_TUNE_CENTS) {
            holding.current = null
            return
          }
          const held = holding.current
          if (held?.stringIndex === stringIndex) {
            held.frames += 1
            if (held.frames >= HOLD_FRAMES) {
              setTuned((prev) => (prev.has(stringIndex) ? prev : new Set(prev).add(stringIndex)))
            }
          } else {
            holding.current = { stringIndex, frames: 1 }
          }
        }

        frame = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setMicState('denied')
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      for (const track of stream?.getTracks() ?? []) track.stop()
      void context?.close()
    }
  }, [])

  if (micState === 'unsupported') {
    return (
      <>
        <h3 class="sheet__title">Tuner</h3>
        <p class="sheet__sub">This browser will not give the page a microphone.</p>
      </>
    )
  }

  if (micState === 'denied') {
    return (
      <>
        <h3 class="sheet__title">Tuner</h3>
        <p class="sheet__sub">
          The tuner needs the microphone. Allow it for this site in your browser settings, then
          open this panel again.
        </p>
      </>
    )
  }

  const cents = reading?.cents ?? 0
  const inTune = reading !== null && Math.abs(cents) <= IN_TUNE_CENTS
  const needle = Math.max(-1, Math.min(1, cents / METER_RANGE))

  return (
    <>
      <div class="tuner__header">
        <span class="legend">Tuner</span>
        <span class="tuner__tuning-name">{tuningName || 'Chromatic'}</span>
      </div>

      <div class={inTune ? 'tuner__display is-in-tune' : 'tuner__display'}>
        <div class="tuner__note">{reading ? noteName(reading.midi) : '—'}</div>
        <div class="tuner__cents">
          {reading === null
            ? micState === 'listening'
              ? 'Play a string'
              : 'Starting…'
            : inTune
              ? 'In tune'
              : `${cents > 0 ? '+' : ''}${Math.round(cents)} cents`}
        </div>
      </div>

      <div class="tuner__meter" aria-hidden>
        <span class="tuner__meter-track" />
        <span class="tuner__meter-centre" />
        {reading && (
          <span
            class={inTune ? 'tuner__meter-needle is-in-tune' : 'tuner__meter-needle'}
            style={{ left: `${50 + needle * 50}%` }}
          />
        )}
      </div>
      <div class="tuner__meter-scale">
        <span>flat</span>
        <span>sharp</span>
      </div>

      {tuning.length > 0 && (
        <div class="tuner__strings">
          {/* Lowest string first: the order you actually tune in. */}
          {tuning
            .map((midi, stringIndex) => ({ midi, stringIndex }))
            .reverse()
            .map(({ midi, stringIndex }) => {
              const isActive = reading?.stringIndex === stringIndex
              const isDone = tuned.has(stringIndex)
              return (
                <span
                  key={stringIndex}
                  class={[
                    'tuner__string',
                    isActive ? 'is-active' : '',
                    isDone ? 'is-done' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {noteName(midi)}
                </span>
              )
            })}
        </div>
      )}
    </>
  )
}
