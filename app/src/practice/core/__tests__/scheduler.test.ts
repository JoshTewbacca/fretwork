import { describe, expect, it } from 'vitest'
import {
  ACQUISITION_CEILING,
  DAY_MS,
  DEFAULT_RAMP_STEP,
  EASE_MIN,
  FAIL_TEMPO_DROP,
  MAX_INTERVAL_DAYS,
  OVERSPEED_TEMPO_PCT,
  applyReview,
  createInitialState,
  isRetirementCandidate,
  overdueFactor,
} from '../scheduler.ts'
import { deriveGrade } from '../grading.ts'
import type { PassageReviewState } from '../../../core/types.ts'

const NOW = 1_700_000_000_000

function stateAt(overrides: Partial<PassageReviewState>): PassageReviewState {
  return { ...createInitialState('p1', 60, NOW), ...overrides }
}

describe('deriveGrade', () => {
  it('grades no clean repetition as fail', () => {
    expect(deriveGrade([false, false, false])).toBe('fail')
  })

  it('grades the first two clean as easy', () => {
    expect(deriveGrade([true, true, false])).toBe('easy')
  })

  it('grades two clean within the early window as good', () => {
    expect(deriveGrade([false, true, false, true, false])).toBe('good')
  })

  it('grades a late single clean as hard', () => {
    expect(deriveGrade([false, false, false, false, false, false, true])).toBe('hard')
  })

  it('does not call a single early clean easy', () => {
    expect(deriveGrade([true, false, false])).not.toBe('easy')
  })
})

describe('acquisition phase', () => {
  it('steps tempo up and waits two days after a good block', () => {
    const s = stateAt({ reviewTempoPct: 60 })
    const next = applyReview(s, { grade: 'good', tempoPct: 60, now: NOW })

    expect(next.phase).toBe('acquisition')
    expect(next.reviewTempoPct).toBe(60 + DEFAULT_RAMP_STEP)
    expect(next.intervalDays).toBe(2)
    expect(next.dueAt).toBe(NOW + 2 * DAY_MS)
    // A clean block at 60 proves mastery at 60.
    expect(next.masteredTempoPct).toBe(60)
  })

  it('steps tempo down and retries tomorrow after a fail', () => {
    const s = stateAt({ reviewTempoPct: 72 })
    const next = applyReview(s, { grade: 'fail', tempoPct: 72, now: NOW })

    expect(next.reviewTempoPct).toBe(72 - FAIL_TEMPO_DROP)
    expect(next.intervalDays).toBe(1)
    // Failing during acquisition is normal, not a lapse.
    expect(next.phase).toBe('acquisition')
    expect(next.lapses).toBe(0)
  })

  it('holds tempo after a hard block', () => {
    const s = stateAt({ reviewTempoPct: 68 })
    const next = applyReview(s, { grade: 'hard', tempoPct: 68, now: NOW })

    expect(next.reviewTempoPct).toBe(68)
    expect(next.intervalDays).toBe(1)
  })

  it('does not let intervals grow while below full tempo', () => {
    let s = stateAt({ reviewTempoPct: 60 })
    for (let i = 0; i < 5; i++) {
      s = applyReview(s, { grade: 'good', tempoPct: s.reviewTempoPct, now: NOW })
      if (s.phase !== 'acquisition') break
      expect(s.intervalDays).toBeLessThanOrEqual(2)
    }
  })

  it('promotes to consolidation once 90 percent is mastered', () => {
    const s = stateAt({ reviewTempoPct: ACQUISITION_CEILING })
    const next = applyReview(s, {
      grade: 'good',
      tempoPct: ACQUISITION_CEILING,
      now: NOW,
    })

    expect(next.phase).toBe('consolidation')
    expect(next.reviewTempoPct).toBeGreaterThanOrEqual(96)
  })
})

describe('maintenance phase', () => {
  const maintenance = stateAt({
    phase: 'maintenance',
    masteredTempoPct: 100,
    reviewTempoPct: 100,
    intervalDays: 3,
    ease: 2.2,
  })

  it('multiplies the interval by ease', () => {
    const next = applyReview(maintenance, { grade: 'good', tempoPct: 100, now: NOW })
    expect(next.intervalDays).toBe(Math.round(3 * 2.2))
  })

  it('caps the interval so nothing vanishes for a whole quarter', () => {
    const long = { ...maintenance, intervalDays: 50, ease: 2.8 }
    const next = applyReview(long, { grade: 'easy', tempoPct: 100, now: NOW })
    expect(next.intervalDays).toBe(MAX_INTERVAL_DAYS)
  })

  it('unlocks overspeed review after two consecutive easy grades', () => {
    const first = applyReview(maintenance, { grade: 'easy', tempoPct: 100, now: NOW })
    expect(first.reviewTempoPct).toBe(100)

    const second = applyReview(first, { grade: 'easy', tempoPct: 100, now: NOW })
    expect(second.consecutiveEasy).toBe(2)
    expect(second.reviewTempoPct).toBe(OVERSPEED_TEMPO_PCT)
  })

  it('resets the easy streak on a harder grade', () => {
    const first = applyReview(maintenance, { grade: 'easy', tempoPct: 100, now: NOW })
    const second = applyReview(first, { grade: 'hard', tempoPct: 100, now: NOW })
    expect(second.consecutiveEasy).toBe(0)
    expect(second.reviewTempoPct).toBe(100)
  })
})

describe('lapses', () => {
  const maintenance = stateAt({
    phase: 'maintenance',
    masteredTempoPct: 100,
    reviewTempoPct: 100,
    intervalDays: 30,
    ease: 2.2,
  })

  it('steps back rather than resetting, because relearning is fast', () => {
    const next = applyReview(maintenance, { grade: 'fail', tempoPct: 100, now: NOW })

    expect(next.phase).toBe('consolidation')
    expect(next.masteredTempoPct).toBe(90)
    expect(next.intervalDays).toBe(2)
    expect(next.ease).toBeCloseTo(2.0, 5)
    expect(next.lapses).toBe(1)
  })

  it('drops to acquisition after two lapses in a row', () => {
    const once = applyReview(maintenance, { grade: 'fail', tempoPct: 100, now: NOW })
    const twice = applyReview(once, { grade: 'fail', tempoPct: 90, now: NOW })

    expect(twice.phase).toBe('acquisition')
    expect(twice.masteredTempoPct).toBe(70)
    expect(twice.consecutiveLapses).toBe(2)
  })

  it('clears the lapse streak after a clean review', () => {
    const lapsed = applyReview(maintenance, { grade: 'fail', tempoPct: 100, now: NOW })
    const recovered = applyReview(lapsed, { grade: 'good', tempoPct: 96, now: NOW })
    expect(recovered.consecutiveLapses).toBe(0)
  })

  it('never drives ease below the floor', () => {
    let s = { ...maintenance, ease: EASE_MIN }
    s = applyReview(s, { grade: 'fail', tempoPct: 100, now: NOW })
    expect(s.ease).toBeGreaterThanOrEqual(EASE_MIN)
  })
})

describe('retirement and ordering helpers', () => {
  it('offers retirement only when well established', () => {
    expect(
      isRetirementCandidate(stateAt({ intervalDays: MAX_INTERVAL_DAYS, ease: 2.6 })),
    ).toBe(true)
    expect(isRetirementCandidate(stateAt({ intervalDays: 20, ease: 2.6 }))).toBe(false)
  })

  it('scores overdue relative to the passage interval', () => {
    const s = stateAt({ dueAt: NOW - 4 * DAY_MS, intervalDays: 2 })
    expect(overdueFactor(s, NOW)).toBeCloseTo(2, 5)
    expect(overdueFactor(stateAt({ dueAt: NOW + DAY_MS }), NOW)).toBe(0)
  })
})
