import { describe, expect, it } from 'vitest'
import {
  centsBetween,
  detectPitchHz,
  matchChromatic,
  matchToTuning,
  medianHz,
  midiToHz,
  noteName,
} from '../pitch.ts'

const SAMPLE_RATE = 44100
const BUFFER = 2048

/** A tone with a few harmonics, which is closer to a plucked string than a
 *  pure sine and is where naive autocorrelation starts reporting octaves. */
function tone(hz: number, harmonics: number[] = [1, 0.5, 0.25]): Float32Array {
  const samples = new Float32Array(BUFFER)
  for (let i = 0; i < BUFFER; i++) {
    let value = 0
    for (let h = 0; h < harmonics.length; h++) {
      value += harmonics[h] * Math.sin((2 * Math.PI * hz * (h + 1) * i) / SAMPLE_RATE)
    }
    samples[i] = value * 0.3
  }
  return samples
}

// Standard tuning, top tab line first, as alphaTab reports it.
const STANDARD = [64, 59, 55, 50, 45, 40]

describe('detectPitchHz', () => {
  it('finds each open string of standard tuning within a cent', () => {
    for (const midi of STANDARD) {
      const target = midiToHz(midi)
      const detected = detectPitchHz(tone(target), SAMPLE_RATE)
      expect(detected).not.toBeNull()
      expect(Math.abs(centsBetween(detected!, target))).toBeLessThan(1)
    }
  })

  it('reports the fundamental, not the octave, when a harmonic is louder', () => {
    const target = midiToHz(40) // low E
    const detected = detectPitchHz(tone(target, [0.4, 1, 0.6]), SAMPLE_RATE)
    expect(detected).not.toBeNull()
    expect(Math.abs(centsBetween(detected!, target))).toBeLessThan(10)
  })

  it('returns null for silence rather than guessing', () => {
    expect(detectPitchHz(new Float32Array(BUFFER), SAMPLE_RATE)).toBeNull()
  })

  it('returns null for noise with no clear period', () => {
    const noise = new Float32Array(BUFFER)
    let seed = 1
    for (let i = 0; i < BUFFER; i++) {
      // Deterministic pseudo-random, so the test cannot flake.
      seed = (seed * 1103515245 + 12345) % 2147483648
      noise[i] = (seed / 2147483648) * 2 - 1
    }
    expect(detectPitchHz(noise, SAMPLE_RATE)).toBeNull()
  })

  it('tracks a string that is flat', () => {
    const target = midiToHz(40)
    const flat = target * Math.pow(2, -30 / 1200)
    const detected = detectPitchHz(tone(flat), SAMPLE_RATE)
    expect(detected).not.toBeNull()
    expect(centsBetween(detected!, target)).toBeCloseTo(-30, 0)
  })
})

describe('matchToTuning', () => {
  it('picks the string being played and reports how far off it is', () => {
    const sharpD = midiToHz(50) * Math.pow(2, 12 / 1200)
    const match = matchToTuning(sharpD, STANDARD)
    expect(match?.stringIndex).toBe(3)
    expect(match?.targetMidi).toBe(50)
    expect(match?.cents).toBeCloseTo(12, 0)
  })

  it('follows an altered tuning rather than assuming standard', () => {
    const dropD = [64, 59, 55, 50, 45, 38]
    const match = matchToTuning(midiToHz(38), dropD)
    expect(match?.stringIndex).toBe(5)
    expect(match?.targetMidi).toBe(38)
  })

  it('refuses a pitch outside the instrument, so rumble is not reported as a string', () => {
    // Strings sit a fourth apart at most, so anything the window rejects is
    // off the end of the neck rather than between two strings.
    expect(matchToTuning(midiToHz(33), STANDARD)).toBeNull()
    expect(matchToTuning(midiToHz(71), STANDARD)).toBeNull()
  })

  it('still matches a string that is badly out of tune', () => {
    const veryFlat = midiToHz(40) * Math.pow(2, -140 / 1200)
    const match = matchToTuning(veryFlat, STANDARD)
    expect(match?.targetMidi).toBe(40)
    expect(match?.cents).toBeCloseTo(-140, 0)
  })
})

describe('note helpers', () => {
  it('names notes in scientific pitch notation', () => {
    expect(noteName(40)).toBe('E2')
    expect(noteName(64)).toBe('E4')
    expect(noteName(69)).toBe('A4')
  })

  it('falls back to the nearest chromatic note', () => {
    const result = matchChromatic(midiToHz(45) * Math.pow(2, 8 / 1200))
    expect(result.targetMidi).toBe(45)
    expect(result.cents).toBeCloseTo(8, 0)
  })

  it('takes the median of recent readings', () => {
    expect(medianHz([100, 700, 101, 99, 100])).toBe(100)
    expect(medianHz([])).toBeNull()
  })
})
