// Groups search results from every source into one row per song, with the
// competing transcriptions ranked underneath it.
//
// Pure and dependency-free so the ranking can be unit-tested against fixed
// inputs - the store owns the fetching, this owns the judgement.

import type { TabSearchResult } from '../sources/types.ts'

export interface SongGroup {
  /** Stable key for list rendering: normalised artist + normalised title. */
  key: string
  /** Display title, taken from the highest-ranked version. */
  title: string
  /** Display artist, taken from the highest-ranked version. */
  artist: string
  /** Every transcription of this song, best first. Never empty. */
  versions: TabSearchResult[]
}

/**
 * Version markers that mean "not the whole song". Ranked below complete
 * transcriptions regardless of how popular they are, because a 40,000
 * download intro tab is still an intro tab.
 */
const PARTIAL_MARKERS = [
  'intro',
  'outro',
  'solo',
  'riff',
  'lick',
  'excerpt',
  'medley',
  'lesson',
  'part',
  'interlude',
  'fragment',
]

/**
 * Version markers that mean "a different arrangement of the song". Not
 * penalised as hard as a partial: they are complete, just not the recording
 * the play-along would be matched against.
 */
const ARRANGEMENT_MARKERS = [
  'live',
  'acoustic',
  'cover',
  'fingerstyle',
  'bass',
  'drum',
  'unplugged',
  'demo',
  'remix',
  'karaoke',
]

/** Later formats carry articulation that gp3 physically cannot represent. */
const FORMAT_RANK: Record<string, number> = {
  gp3: 0,
  gp4: 3,
  gp5: 5,
  gpx: 6,
  gp: 6,
}

/**
 * Strips leading articles and non-alphanumerics so that "The Eagles",
 * "Eagles (The)" and "Eagles, The" collapse to one key. The comma and
 * parenthesis forms are guitarprotabs conventions; gprotab writes the plain
 * form, and the two catalogues have to line up for grouping to work at all.
 */
export function normaliseArtist(artist: string): string {
  let value = artist.trim().toLowerCase()

  const comma = /^(.*?),\s*(the|a|an)$/.exec(value)
  if (comma) value = `${comma[2]} ${comma[1]}`

  const parenthesised = /^(.*?)\s*\((the|a|an)\)$/.exec(value)
  if (parenthesised) value = `${parenthesised[2]} ${parenthesised[1]}`

  value = value.replace(/^(the|a|an)\s+/, '')
  return value.replace(/[^a-z0-9]/g, '')
}

/** Case- and punctuation-insensitive title key. */
export function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function markerPenalty(version: string | undefined): number {
  if (version === undefined) return 0
  const value = version.toLowerCase()
  if (PARTIAL_MARKERS.some((marker) => value.includes(marker))) return 40
  if (ARRANGEMENT_MARKERS.some((marker) => value.includes(marker))) return 15
  return 0
}

/**
 * Ranks one transcription against its siblings. Higher is better.
 *
 * Download counts are the dominant term, compressed logarithmically because
 * they are not comparable across sources on a linear scale - the two archives
 * have very different traffic, so a raw comparison would rank the busier site
 * first every time. Compression narrows that bias without pretending to
 * remove it: the counts are still uncalibrated between sources, which is why
 * every version's own number is shown in the UI rather than only the verdict.
 *
 * Format and rating are deliberately weaker terms that settle near-ties
 * rather than overturn a large popularity gap - a .gp5 export of a lazy
 * transcription is still a lazy transcription.
 *
 * A result with no signals at all scores 0 plus its penalties, so it sorts
 * below anything we know something about but still above known-partial tabs.
 */
export function scoreResult(result: TabSearchResult): number {
  const signals = result.signals ?? {}
  let score = 0

  if (signals.downloads !== undefined && signals.downloads > 0) {
    score += Math.log10(signals.downloads + 1) * 10
  }

  if (signals.format !== undefined) {
    score += FORMAT_RANK[signals.format] ?? 0
  }

  // A 5/5 from one vote is noise; weight the mean by how many votes back it.
  if (signals.ratingValue !== undefined && signals.ratingVotes !== undefined) {
    const confidence = Math.min(signals.ratingVotes, 10) / 10
    score += signals.ratingValue * confidence * 2
  }

  return score - markerPenalty(result.version)
}

/**
 * Groups results by song and ranks the versions within each group. Groups are
 * ordered by their best version's score, so the most credible song row leads
 * the list. Ties break on the original result order, which preserves each
 * source's own relevance ranking for queries where nothing else separates
 * the candidates.
 */
export function groupResults(results: TabSearchResult[]): SongGroup[] {
  const groups = new Map<string, { group: SongGroup; order: number }>()

  results.forEach((result, index) => {
    const key = `${normaliseArtist(result.artist)}|${normaliseTitle(result.title)}`
    const existing = groups.get(key)
    if (existing) {
      existing.group.versions.push(result)
      return
    }
    groups.set(key, {
      order: index,
      group: { key, title: result.title, artist: result.artist, versions: [result] },
    })
  })

  const ordered = [...groups.values()]

  for (const { group } of ordered) {
    group.versions.sort((a, b) => {
      const diff = scoreResult(b) - scoreResult(a)
      if (diff !== 0) return diff
      return results.indexOf(a) - results.indexOf(b)
    })
    // The best version decides how the song is labelled: it carries the
    // cleanest casing and the base title with no version marker attached.
    group.title = group.versions[0].title
    group.artist = group.versions[0].artist
  }

  ordered.sort((a, b) => {
    const diff = scoreResult(b.group.versions[0]) - scoreResult(a.group.versions[0])
    if (diff !== 0) return diff
    return a.order - b.order
  })

  return ordered.map(({ group }) => group)
}
