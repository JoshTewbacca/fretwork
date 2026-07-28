import { describe, expect, it } from 'vitest'
import {
  MERGE_JACCARD,
  findKernels,
  findMergeTarget,
  findParents,
  isKernelOf,
  jaccard,
  mergeRanges,
  shouldMerge,
} from '../passageGeometry.ts'
import type { Passage } from '../../../core/types.ts'

function passage(id: string, startBar: number, endBar: number, over: Partial<Passage> = {}): Passage {
  return {
    id,
    songId: 'song-1',
    trackIndex: 0,
    startBar,
    endBar,
    origin: 'user',
    status: 'active',
    createdAt: 0,
    ...over,
  }
}

describe('jaccard', () => {
  it('is 1 for identical ranges', () => {
    expect(jaccard({ startBar: 4, endBar: 8 }, { startBar: 4, endBar: 8 })).toBe(1)
  })

  it('is 0 for disjoint ranges', () => {
    expect(jaccard({ startBar: 0, endBar: 3 }, { startBar: 4, endBar: 7 })).toBe(0)
  })

  it('is 0 for adjacent but non-overlapping ranges', () => {
    expect(jaccard({ startBar: 0, endBar: 3 }, { startBar: 4, endBar: 4 })).toBe(0)
  })

  it('measures partial overlap', () => {
    // bars 2..5 and 4..7: intersection 2, union 6
    expect(jaccard({ startBar: 2, endBar: 5 }, { startBar: 4, endBar: 7 })).toBeCloseTo(2 / 6, 5)
  })
})

describe('shouldMerge', () => {
  it('merges heavily overlapping ranges', () => {
    expect(shouldMerge({ startBar: 4, endBar: 11 }, { startBar: 4, endBar: 10 })).toBe(true)
  })

  it('keeps lightly overlapping ranges separate', () => {
    const j = jaccard({ startBar: 0, endBar: 9 }, { startBar: 8, endBar: 17 })
    expect(j).toBeLessThan(MERGE_JACCARD)
    expect(shouldMerge({ startBar: 0, endBar: 9 }, { startBar: 8, endBar: 17 })).toBe(false)
  })

  it('extends to cover both ranges when merging', () => {
    expect(mergeRanges({ startBar: 4, endBar: 10 }, { startBar: 6, endBar: 14 })).toEqual({
      startBar: 4,
      endBar: 14,
    })
  })
})

describe('kernel and parent detection', () => {
  it('treats a short lick inside a long passage as a kernel', () => {
    expect(isKernelOf({ startBar: 10, endBar: 12 }, { startBar: 4, endBar: 20 })).toBe(true)
  })

  it('rejects a kernel that is too long to be one', () => {
    expect(isKernelOf({ startBar: 4, endBar: 12 }, { startBar: 4, endBar: 20 })).toBe(false)
  })

  it('rejects a parent that is not substantially longer', () => {
    expect(isKernelOf({ startBar: 4, endBar: 6 }, { startBar: 4, endBar: 8 })).toBe(false)
  })

  it('rejects a range that escapes the parent', () => {
    expect(isKernelOf({ startBar: 18, endBar: 21 }, { startBar: 4, endBar: 20 })).toBe(false)
  })

  it('finds parents and kernels among a passage set', () => {
    const kernel = passage('k', 10, 12)
    const parent = passage('p', 4, 20)
    const unrelated = passage('u', 40, 44)
    const all = [kernel, parent, unrelated]

    expect(findParents(kernel, all).map((p) => p.id)).toEqual(['p'])
    expect(findKernels(parent, all).map((p) => p.id)).toEqual(['k'])
  })

  it('ignores retired passages when looking for relatives', () => {
    const kernel = passage('k', 10, 12)
    const parent = passage('p', 4, 20, { status: 'retired' })
    expect(findParents(kernel, [kernel, parent])).toHaveLength(0)
  })
})

describe('findMergeTarget', () => {
  const existing = [passage('a', 4, 11), passage('b', 40, 48)]

  it('finds an overlapping passage on the same track', () => {
    expect(findMergeTarget({ startBar: 4, endBar: 10 }, existing, 'song-1', 0)?.id).toBe('a')
  })

  it('does not merge across tracks', () => {
    expect(findMergeTarget({ startBar: 4, endBar: 10 }, existing, 'song-1', 1)).toBeNull()
  })

  it('does not merge across songs', () => {
    expect(findMergeTarget({ startBar: 4, endBar: 10 }, existing, 'song-2', 0)).toBeNull()
  })

  it('returns null when nothing overlaps enough', () => {
    expect(findMergeTarget({ startBar: 100, endBar: 104 }, existing, 'song-1', 0)).toBeNull()
  })
})
