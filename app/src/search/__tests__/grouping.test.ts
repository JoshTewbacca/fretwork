import { describe, expect, it } from 'vitest'
import type { TabSearchResult, TabQualitySignals } from '../../sources/types.ts'
import { groupResults, normaliseArtist, normaliseTitle, scoreResult } from '../grouping.ts'

function result(
  overrides: Partial<TabSearchResult> & Pick<TabSearchResult, 'title' | 'artist'>,
): TabSearchResult {
  return {
    sourceId: 'gprotab',
    externalId: `/${overrides.title}/${overrides.version ?? '1'}`,
    url: 'https://example.test/tab',
    ...overrides,
  }
}

function signals(downloads: number, format?: string): TabQualitySignals {
  return format === undefined ? { downloads } : { downloads, format }
}

describe('normaliseArtist', () => {
  it('collapses the three ways the archives write a leading article', () => {
    const forms = ['The Eagles', 'Eagles (The)', 'Eagles, The', 'eagles']
    const normalised = forms.map(normaliseArtist)

    expect(new Set(normalised).size).toBe(1)
    expect(normalised[0]).toBe('eagles')
  })

  it('ignores punctuation and case differences', () => {
    expect(normaliseArtist("Guns N' Roses")).toBe(normaliseArtist('guns n roses'))
  })
})

describe('normaliseTitle', () => {
  it('ignores casing and punctuation', () => {
    expect(normaliseTitle('Master Of Puppets')).toBe(normaliseTitle('master of puppets'))
    expect(normaliseTitle("Don't Cry")).toBe(normaliseTitle('dont cry'))
  })
})

describe('scoreResult', () => {
  it('ranks more downloads higher', () => {
    const popular = result({ title: 'X', artist: 'A', signals: signals(100_000) })
    const obscure = result({ title: 'X', artist: 'A', signals: signals(100) })

    expect(scoreResult(popular)).toBeGreaterThan(scoreResult(obscure))
  })

  it('lets a large download gap outweigh format', () => {
    // The same song on the two archives: 103,009 downloads vs 13,076. Format
    // is a weak proxy for care taken, so an 8x popularity gap still wins.
    const busy = result({ title: 'X', artist: 'A', signals: signals(103_009, 'gp3') })
    const quiet = result({ title: 'X', artist: 'A', signals: signals(13_076, 'gp5') })

    expect(scoreResult(busy)).toBeGreaterThan(scoreResult(quiet))
  })

  it('compresses downloads so the gap between sources stays bounded', () => {
    // Without compression a 100x difference in site traffic would dwarf every
    // other term; on a log scale it is worth less than the partial penalty.
    const busy = result({ title: 'X', artist: 'A', signals: signals(103_009) })
    const quiet = result({ title: 'X', artist: 'A', signals: signals(1_030) })

    expect(scoreResult(busy) - scoreResult(quiet)).toBeLessThan(40)
  })

  it('prefers a later format when downloads are comparable', () => {
    const gp5 = result({ title: 'X', artist: 'A', signals: signals(1000, 'gp5') })
    const gp3 = result({ title: 'X', artist: 'A', signals: signals(1000, 'gp3') })

    expect(scoreResult(gp5)).toBeGreaterThan(scoreResult(gp3))
  })

  it('ranks a partial transcription below a complete one however popular it is', () => {
    const intro = result({
      title: 'X',
      artist: 'A',
      version: 'Intro',
      signals: signals(500_000),
    })
    const complete = result({ title: 'X', artist: 'A', signals: signals(1_000) })

    expect(scoreResult(complete)).toBeGreaterThan(scoreResult(intro))
  })

  it('penalises a different arrangement less hard than a partial', () => {
    const live = result({ title: 'X', artist: 'A', version: 'Live', signals: signals(1000) })
    const solo = result({ title: 'X', artist: 'A', version: 'Solo', signals: signals(1000) })
    const studio = result({ title: 'X', artist: 'A', signals: signals(1000) })

    expect(scoreResult(studio)).toBeGreaterThan(scoreResult(live))
    expect(scoreResult(live)).toBeGreaterThan(scoreResult(solo))
  })

  it('discounts a perfect rating that only one person voted on', () => {
    const oneVote = result({
      title: 'X',
      artist: 'A',
      signals: { downloads: 1000, ratingValue: 5, ratingVotes: 1 },
    })
    const manyVotes = result({
      title: 'X',
      artist: 'A',
      signals: { downloads: 1000, ratingValue: 5, ratingVotes: 40 },
    })

    expect(scoreResult(manyVotes)).toBeGreaterThan(scoreResult(oneVote))
  })
})

describe('groupResults', () => {
  it('collapses versions of one song into a single group, best first', () => {
    const results = [
      result({ title: 'Master Of Puppets', artist: 'Metallica', version: '2', signals: signals(14_028) }),
      result({ title: 'Master of puppets', artist: 'Metallica', signals: signals(103_009) }),
      result({ title: 'Master Of Puppets', artist: 'Metallica', version: '5', signals: signals(17_703) }),
    ]

    const groups = groupResults(results)

    expect(groups).toHaveLength(1)
    expect(groups[0].versions).toHaveLength(3)
    expect(groups[0].versions[0].version).toBeUndefined()
    expect(groups[0].versions[1].version).toBe('5')
    expect(groups[0].versions[2].version).toBe('2')
  })

  it('groups the same song across two sources', () => {
    const results = [
      result({
        sourceId: 'gprotab',
        title: 'Shimmer',
        artist: 'Fuel',
        signals: signals(2_000, 'gp3'),
      }),
      result({
        sourceId: 'guitarprotabs',
        externalId: '/f/fuel/shimmer_1/',
        title: 'Shimmer',
        artist: 'Fuel',
        signals: signals(1_843, 'gp3'),
      }),
    ]

    const groups = groupResults(results)

    expect(groups).toHaveLength(1)
    expect(groups[0].versions.map((v) => v.sourceId)).toEqual(['gprotab', 'guitarprotabs'])
  })

  it('keeps different songs by the same artist apart', () => {
    const groups = groupResults([
      result({ title: 'One', artist: 'Metallica' }),
      result({ title: 'Fade To Black', artist: 'Metallica' }),
    ])

    expect(groups).toHaveLength(2)
  })

  it('keeps the same song title by different artists apart', () => {
    const groups = groupResults([
      result({ title: 'No Way', artist: 'Korn' }),
      result({ title: 'No Way', artist: 'Pearl Jam' }),
    ])

    expect(groups).toHaveLength(2)
  })

  it('orders groups by their best version, so the strongest song leads', () => {
    const groups = groupResults([
      result({ title: 'Obscure', artist: 'A', signals: signals(50) }),
      result({ title: 'Popular', artist: 'B', signals: signals(90_000) }),
    ])

    expect(groups.map((g) => g.title)).toEqual(['Popular', 'Obscure'])
  })

  it('preserves source order when nothing distinguishes two results', () => {
    const groups = groupResults([
      result({ title: 'First', artist: 'A' }),
      result({ title: 'Second', artist: 'B' }),
    ])

    expect(groups.map((g) => g.title)).toEqual(['First', 'Second'])
  })

  it('labels the group from its best version, dropping the version marker', () => {
    const groups = groupResults([
      result({ title: 'Shimmer', artist: 'Fuel', version: 'Intro', signals: signals(9_000) }),
      result({ title: 'shimmer', artist: 'Fuel', signals: signals(1_843) }),
    ])

    expect(groups[0].title).toBe('shimmer')
    expect(groups[0].versions[0].version).toBeUndefined()
  })

  it('returns an empty array for no results', () => {
    expect(groupResults([])).toEqual([])
  })
})
