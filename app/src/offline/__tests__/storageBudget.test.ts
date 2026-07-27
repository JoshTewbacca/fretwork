import { describe, expect, it } from 'vitest'
import {
  CRITICAL_AT,
  WARN_AT,
  evaluateBudget,
  formatBytes,
} from '../storageBudget'

const GB = 1024 * 1024 * 1024

describe('formatBytes', () => {
  it('uses bytes below a kilobyte', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('uses megabytes in the normal range', () => {
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.0 MB')
  })

  it('uses gigabytes for large values', () => {
    expect(formatBytes(2 * GB)).toBe('2.00 GB')
  })
})

describe('evaluateBudget', () => {
  it('reports ok well below the warning threshold', () => {
    const b = evaluateBudget(1 * GB, 10 * GB)
    expect(b.level).toBe('ok')
    expect(b.message).toBeNull()
    expect(b.blockNewDownloads).toBe(false)
  })

  it('warns at the warning threshold', () => {
    const b = evaluateBudget(WARN_AT * 10 * GB, 10 * GB)
    expect(b.level).toBe('warning')
    expect(b.message).not.toBeNull()
    // A warning must not stop the user adding songs.
    expect(b.blockNewDownloads).toBe(false)
  })

  it('blocks new downloads at the critical threshold', () => {
    const b = evaluateBudget(CRITICAL_AT * 10 * GB, 10 * GB)
    expect(b.level).toBe('critical')
    expect(b.blockNewDownloads).toBe(true)
  })

  it('does not divide by zero when the quota is unknown', () => {
    const b = evaluateBudget(0, 0)
    expect(b.usedFraction).toBe(0)
    expect(b.level).toBe('ok')
  })
})
