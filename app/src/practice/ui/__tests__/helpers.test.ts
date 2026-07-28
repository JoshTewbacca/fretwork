import { describe, expect, it } from 'vitest'
import type { Passage, PassageReviewState } from '../../../core/types.ts'
import { createInitialState } from '../../core/scheduler.ts'
import {
  dueRows,
  formatShortDate,
  gradeExplanation,
  gradeWord,
  groupBySong,
  passageLabel,
  phaseLabel,
} from '../helpers.ts'

const NOW = 1_700_000_000_000

function passage(overrides: Partial<Passage> = {}): Passage {
  return {
    id: 'p1',
    songId: 's1',
    trackIndex: 0,
    startBar: 4,
    endBar: 7,
    origin: 'user',
    status: 'active',
    createdAt: NOW,
    ...overrides,
  }
}

function state(overrides: Partial<PassageReviewState> = {}): PassageReviewState {
  return { ...createInitialState('p1', 60, NOW), ...overrides }
}

describe('passageLabel', () => {
  it('uses the passage label when present', () => {
    expect(passageLabel(passage({ label: 'Bridge run' }))).toBe('Bridge run')
  })

  it('falls back to a 1-based bar range', () => {
    expect(passageLabel(passage({ startBar: 4, endBar: 7 }))).toBe('Bars 5 to 8')
  })

  it('falls back to a single bar when the range is one bar', () => {
    expect(passageLabel(passage({ startBar: 4, endBar: 4 }))).toBe('Bar 5')
  })
})

describe('phaseLabel', () => {
  it('translates the raw enum into plain words', () => {
    expect(phaseLabel('acquisition')).toBe('Learning')
    expect(phaseLabel('consolidation')).toBe('Consolidating')
    expect(phaseLabel('maintenance')).toBe('Maintaining')
  })
})

describe('gradeWord and gradeExplanation', () => {
  it('gives a plain word and explanation for every grade', () => {
    expect(gradeWord('easy')).toBe('Easy')
    expect(gradeExplanation('easy')).toBe('Clean from the first repetition.')

    expect(gradeWord('good')).toBe('Good')
    expect(gradeExplanation('good')).toBe('Clean within the first few repetitions.')

    expect(gradeWord('hard')).toBe('Hard')
    expect(gradeExplanation('hard')).toBe('It took a while to get a clean run.')

    expect(gradeWord('fail')).toBe('Fail')
    expect(gradeExplanation('fail')).toBe('No clean run this time; the tempo will step back.')
  })
})

describe('dueRows', () => {
  it('excludes passages with no state, retired passages, and not-yet-due passages', () => {
    const due = passage({ id: 'due', status: 'active' })
    const retired = passage({ id: 'retired', status: 'retired' })
    const notDue = passage({ id: 'not-due', status: 'active' })
    const noState = passage({ id: 'no-state', status: 'active' })

    const states = new Map<string, PassageReviewState>([
      ['due', state({ passageId: 'due', dueAt: NOW - 1000 })],
      ['retired', state({ passageId: 'retired', dueAt: NOW - 1000 })],
      ['not-due', state({ passageId: 'not-due', dueAt: NOW + 1000 })],
    ])

    const rows = dueRows([due, retired, notDue, noState], states, NOW)
    expect(rows.map((r) => r.passage.id)).toEqual(['due'])
  })

  it('sorts most overdue first', () => {
    const a = passage({ id: 'a' })
    const b = passage({ id: 'b' })

    const states = new Map<string, PassageReviewState>([
      ['a', state({ passageId: 'a', dueAt: NOW - 1000, intervalDays: 2 })],
      ['b', state({ passageId: 'b', dueAt: NOW - 5 * 24 * 60 * 60 * 1000, intervalDays: 2 })],
    ])

    const rows = dueRows([a, b], states, NOW)
    expect(rows.map((r) => r.passage.id)).toEqual(['b', 'a'])
  })

  it('includes a passage exactly at its due time', () => {
    const a = passage({ id: 'a' })
    const states = new Map<string, PassageReviewState>([
      ['a', state({ passageId: 'a', dueAt: NOW })],
    ])
    expect(dueRows([a], states, NOW).map((r) => r.passage.id)).toEqual(['a'])
  })
})

describe('groupBySong', () => {
  it('groups passages by song id, preserving first-seen order', () => {
    const p1 = passage({ id: 'p1', songId: 'song-b' })
    const p2 = passage({ id: 'p2', songId: 'song-a' })
    const p3 = passage({ id: 'p3', songId: 'song-b' })

    const groups = groupBySong([p1, p2, p3])
    expect(groups.map(([songId]) => songId)).toEqual(['song-b', 'song-a'])
    expect(groups.find(([songId]) => songId === 'song-b')?.[1].map((p) => p.id)).toEqual([
      'p1',
      'p3',
    ])
  })
})

describe('formatShortDate', () => {
  it('formats a timestamp as a short local date string', () => {
    const formatted = formatShortDate(NOW)
    expect(typeof formatted).toBe('string')
    expect(formatted.length).toBeGreaterThan(0)
  })
})
