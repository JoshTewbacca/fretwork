import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../LibraryList.tsx'

const NOW = 1_700_000_000_000

describe('formatRelativeTime', () => {
  it('returns "Never" when there is no timestamp', () => {
    expect(formatRelativeTime(undefined, NOW)).toBe('Never')
  })

  it('returns "Just now" for very recent timestamps', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('Just now')
  })

  it('formats minutes, hours, and days ago', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago')
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3 hours ago')
    expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe('2 days ago')
  })

  it('uses singular units at exactly one', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1 minute ago')
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1 hour ago')
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('1 day ago')
  })

  it('formats months and years for older timestamps', () => {
    expect(formatRelativeTime(NOW - 60 * 24 * 60 * 60_000, NOW)).toBe('2 months ago')
    expect(formatRelativeTime(NOW - 400 * 24 * 60 * 60_000, NOW)).toBe('1 year ago')
  })
})
