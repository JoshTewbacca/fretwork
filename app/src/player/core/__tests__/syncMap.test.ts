import { describe, expect, it } from 'vitest'
import type { SyncAnchor, SyncMap } from '../../../core/types.ts'
import { hasAnchors, normaliseAnchors, syncQualityLabel } from '../syncMap.ts'

const BAR_COUNT = 96

function anchor(overrides: Partial<SyncAnchor> = {}): SyncAnchor {
  return {
    masterBarIndex: 0,
    barOccurence: 0,
    ratioPosition: 0,
    audioMs: 0,
    source: 'auto',
    ...overrides,
  }
}

describe('normaliseAnchors', () => {
  it('sorts by bar then occurrence', () => {
    const result = normaliseAnchors(
      [
        anchor({ masterBarIndex: 8, audioMs: 16_000 }),
        anchor({ masterBarIndex: 0, audioMs: 1000 }),
        anchor({ masterBarIndex: 4, audioMs: 8000 }),
      ],
      BAR_COUNT,
    )
    expect(result.map((a) => a.masterBarIndex)).toEqual([0, 4, 8])
  })

  it('keeps the repeat passes of one bar as separate anchors', () => {
    // barOccurence is how ADR-002 handles repeats: the same bar sits at two
    // different places in the audio.
    const result = normaliseAnchors(
      [
        anchor({ masterBarIndex: 4, barOccurence: 1, audioMs: 40_000 }),
        anchor({ masterBarIndex: 4, barOccurence: 0, audioMs: 8000 }),
      ],
      BAR_COUNT,
    )
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.audioMs)).toEqual([8000, 40_000])
  })

  it('lets a user anchor win its slot regardless of order', () => {
    const auto = anchor({ masterBarIndex: 4, audioMs: 8000, source: 'auto' })
    const user = anchor({ masterBarIndex: 4, audioMs: 8250, source: 'user' })

    expect(normaliseAnchors([auto, user], BAR_COUNT)[0].audioMs).toBe(8250)
    expect(normaliseAnchors([user, auto], BAR_COUNT)[0].audioMs).toBe(8250)
  })

  it('drops anchors pointing outside the score', () => {
    const result = normaliseAnchors(
      [
        anchor({ masterBarIndex: -1 }),
        anchor({ masterBarIndex: BAR_COUNT }),
        anchor({ masterBarIndex: BAR_COUNT + 40 }),
        anchor({ masterBarIndex: 5, audioMs: 9000 }),
      ],
      BAR_COUNT,
    )
    expect(result).toHaveLength(1)
    expect(result[0].masterBarIndex).toBe(5)
  })

  it('drops anchors with an unusable audio position', () => {
    // A bad anchor is worse than a missing one: alphaTab warps the whole time
    // axis to reach it.
    const result = normaliseAnchors(
      [
        anchor({ masterBarIndex: 1, audioMs: -500 }),
        anchor({ masterBarIndex: 2, audioMs: Number.NaN }),
        anchor({ masterBarIndex: 3, audioMs: Number.POSITIVE_INFINITY }),
        anchor({ masterBarIndex: 4, audioMs: 8000 }),
      ],
      BAR_COUNT,
    )
    expect(result).toHaveLength(1)
    expect(result[0].masterBarIndex).toBe(4)
  })

  it('drops non-integer bar and occurrence values', () => {
    const result = normaliseAnchors(
      [
        anchor({ masterBarIndex: 2.5 }),
        anchor({ masterBarIndex: 3, barOccurence: 1.5 }),
        anchor({ masterBarIndex: 3, barOccurence: -1 }),
      ],
      BAR_COUNT,
    )
    expect(result).toEqual([])
  })

  it('returns an empty list for an empty input', () => {
    expect(normaliseAnchors([], BAR_COUNT)).toEqual([])
  })

  it('drops everything when the score has no bars', () => {
    expect(normaliseAnchors([anchor()], 0)).toEqual([])
  })
})

function syncMap(overrides: Partial<SyncMap> = {}): SyncMap {
  return { version: 1, points: [anchor()], confidence: 0.5, status: 'auto', ...overrides }
}

describe('hasAnchors', () => {
  it('is false for a missing or empty map', () => {
    expect(hasAnchors(undefined)).toBe(false)
    expect(hasAnchors(syncMap({ points: [] }))).toBe(false)
  })

  it('is true once the audio is positioned', () => {
    expect(hasAnchors(syncMap())).toBe(true)
  })
})

describe('syncQualityLabel', () => {
  it('distinguishes a start-only map from one that needs real checking', () => {
    expect(syncQualityLabel(syncMap({ status: 'needs-review' }))).toBe(
      'Start aligned, tempo unchecked',
    )
    expect(
      syncQualityLabel(
        syncMap({ status: 'needs-review', points: [anchor(), anchor({ masterBarIndex: 8 })] }),
      ),
    ).toBe('Needs checking')
  })

  it('names the verified and automatic cases', () => {
    expect(syncQualityLabel(syncMap({ status: 'user-verified' }))).toBe('Aligned by you')
    expect(syncQualityLabel(syncMap({ status: 'auto' }))).toBe('Aligned automatically')
  })

  it('reports an unaligned map', () => {
    expect(syncQualityLabel(undefined)).toBe('Not aligned')
    expect(syncQualityLabel(syncMap({ points: [] }))).toBe('Not aligned')
  })
})
