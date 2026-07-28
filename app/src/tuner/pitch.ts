// Pitch detection and note maths for the tuner.
//
// Pure and DOM-free so it can be unit tested against synthesised waveforms.
// The algorithm is YIN (de Cheveigné & Kawahara 2002): a difference function,
// normalised cumulatively so the first dip below a threshold is the period,
// then parabolic interpolation for sub-sample accuracy. Chosen over plain
// autocorrelation because a guitar's first harmonic is often louder than its
// fundamental through a phone mic, and plain autocorrelation answers an octave
// high when that happens.

/** Below this RMS the input is treated as silence rather than guessed at. */
const MIN_RMS = 0.008

/** YIN's absolute threshold. Lower is stricter. */
const DEFAULT_THRESHOLD = 0.12

/**
 * Search range in Hz. The low end sits under a 7-string's B0 and the high end
 * above a fretted note high on the first string; narrowing it this far is also
 * what keeps the detector from reporting octaves that no guitar can produce.
 */
const MIN_HZ = 55
const MAX_HZ = 700

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

/** Signed distance in cents from `hz` to `targetHz`; negative is flat. */
export function centsBetween(hz: number, targetHz: number): number {
  return 1200 * Math.log2(hz / targetHz)
}

/** Scientific pitch name for a MIDI number, e.g. 40 -> "E2". */
export function noteName(midi: number): string {
  const rounded = Math.round(midi)
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

/**
 * Estimate the fundamental frequency of `samples`, or null when the input is
 * too quiet or has no clear period.
 */
export function detectPitchHz(
  samples: Float32Array,
  sampleRate: number,
  threshold: number = DEFAULT_THRESHOLD,
): number | null {
  const window = Math.floor(samples.length / 2)
  if (window < 2) return null

  let energy = 0
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i]
  if (Math.sqrt(energy / samples.length) < MIN_RMS) return null

  const minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ))
  const maxTau = Math.min(window - 1, Math.ceil(sampleRate / MIN_HZ))
  if (maxTau <= minTau) return null

  // Squared difference between the signal and itself delayed by tau.
  const diff = new Float32Array(maxTau + 1)
  for (let tau = minTau; tau <= maxTau; tau++) {
    let total = 0
    for (let i = 0; i < window; i++) {
      const delta = samples[i] - samples[i + tau]
      total += delta * delta
    }
    diff[tau] = total
  }

  // Cumulative mean normalisation. Without it the difference function is
  // always smallest at tau = 0 and the period never stands out.
  const normalised = new Float32Array(maxTau + 1)
  let running = 0
  for (let tau = minTau; tau <= maxTau; tau++) {
    running += diff[tau]
    normalised[tau] = running === 0 ? 1 : (diff[tau] * (tau - minTau + 1)) / running
  }

  // First dip below the threshold, walked down to its local minimum. Taking
  // the first rather than the smallest is what avoids octave errors: a true
  // period's multiples also dip, and they come later.
  let tauEstimate = -1
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (normalised[tau] < threshold) {
      while (tau + 1 <= maxTau && normalised[tau + 1] < normalised[tau]) tau++
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate === -1) return null

  return sampleRate / parabolicMinimum(normalised, tauEstimate, minTau, maxTau)
}

/** Refine an integer minimum to sub-sample accuracy through its neighbours. */
function parabolicMinimum(
  values: Float32Array,
  tau: number,
  minTau: number,
  maxTau: number,
): number {
  if (tau <= minTau || tau >= maxTau) return tau
  const before = values[tau - 1]
  const at = values[tau]
  const after = values[tau + 1]
  const divisor = 2 * (2 * at - after - before)
  if (divisor === 0) return tau
  return tau + (after - before) / divisor
}

export interface TuningMatch {
  /** Index into the tuning array. 0 is the top tab line, the highest string. */
  stringIndex: number
  targetMidi: number
  /** Signed cents from the target; negative is flat. */
  cents: number
}

/**
 * Half the interval between adjacent strings, which are a fourth (500 cents)
 * apart at the closest. Beyond this the pitch belongs to a different string
 * and reporting it against this one would be a lie.
 */
const MAX_MATCH_CENTS = 250

/** Nearest string of `tuning` (MIDI numbers) to `hz`, or null if none is close. */
export function matchToTuning(hz: number, tuning: readonly number[]): TuningMatch | null {
  let best: TuningMatch | null = null
  for (let stringIndex = 0; stringIndex < tuning.length; stringIndex++) {
    const targetMidi = tuning[stringIndex]
    const cents = centsBetween(hz, midiToHz(targetMidi))
    if (best === null || Math.abs(cents) < Math.abs(best.cents)) {
      best = { stringIndex, targetMidi, cents }
    }
  }
  if (best === null || Math.abs(best.cents) > MAX_MATCH_CENTS) return null
  return best
}

/** Nearest chromatic note, for when no tuning is known. */
export function matchChromatic(hz: number): { targetMidi: number; cents: number } {
  const targetMidi = Math.round(hzToMidi(hz))
  return { targetMidi, cents: centsBetween(hz, midiToHz(targetMidi)) }
}

/**
 * Median of the recent readings. A plucked string's pitch wobbles as it decays
 * and a single frame can land anywhere; the median discards the outliers
 * without the lag an average would add.
 */
export function medianHz(readings: readonly number[]): number | null {
  if (readings.length === 0) return null
  const sorted = [...readings].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
