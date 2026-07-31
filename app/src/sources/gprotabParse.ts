// Pure, dependency-free parsing helpers for the gprotab.net HTML source.
// No network access happens here - see app/api/tabs/search.ts and
// app/api/tabs/download.ts for the serverless functions that fetch the
// HTML/binary and call into these helpers (the api/ functions duplicate the
// small pieces they need, since app/tsconfig.app.json only covers src/ and
// api/ must remain independently compilable - see the note in those files).

import type { TabQualitySignals, TabSearchResult } from './types.ts'
import { splitVersion } from './versionSplit.ts'

/** Origin of the upstream tab archive this source scrapes. */
export const GPROTAB_ORIGIN = 'https://gprotab.net'

// Matches an artist anchor immediately followed (with any amount of
// intervening whitespace/other markup-free text) by a song anchor, per the
// observed markup:
//   <a href="/en/tabs/{artistSlug}" class="tab-band">Artist Name</a>
//   <a href="/en/tabs/{artistSlug}/{songSlug}" class="tab-name">Song Name</a>
const ANCHOR_PAIR_RE =
  /<a\s+href="(\/en\/tabs\/[^"]+)"\s+class="tab-band"[^>]*>([\s\S]*?)<\/a>\s*<a\s+href="(\/en\/tabs\/[^"]+)"\s+class="tab-name"[^>]*>([\s\S]*?)<\/a>/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  '#39': "'",
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
}

/** Decodes the small set of HTML entities expected in gprotab result markup. */
function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body in NAMED_ENTITIES) {
      return NAMED_ENTITIES[body]
    }
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const codePoint = Number.parseInt(body.slice(2), 16)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }
    if (body.startsWith('#')) {
      const codePoint = Number.parseInt(body.slice(1), 10)
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint)
    }
    return match
  })
}

/** Trims and collapses runs of internal whitespace (the site doubles spaces in some titles). */
function cleanName(rawHtml: string): string {
  return decodeEntities(rawHtml).replace(/\s+/g, ' ').trim()
}

/**
 * Parses a gprotab.net search results page, extracting artist/song anchor
 * pairs. Skips artist anchors with no following song anchor, deduplicates by
 * externalId, and preserves document order.
 */
export function parseSearchHtml(html: string): TabSearchResult[] {
  const results: TabSearchResult[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(ANCHOR_PAIR_RE)) {
    const [, , artistHtml, songHref, songHtml] = match
    const externalId = songHref
    if (seen.has(externalId)) {
      continue
    }
    seen.add(externalId)

    const { base, version } = splitVersion(cleanName(songHtml))
    results.push({
      sourceId: 'gprotab',
      externalId,
      title: base,
      artist: cleanName(artistHtml),
      url: GPROTAB_ORIGIN + externalId,
      ...(version === undefined ? {} : { version }),
    })
  }

  return results
}

/**
 * Parses the quality signals off a gprotab tab detail page. gprotab puts none
 * of this on the search results page, so reaching it costs one extra request
 * per result - see the enrichment step in app/api/tabs/search.ts.
 *
 * The rating is read from the page's JSON-LD `aggregateRating` rather than the
 * rendered stars, because the markup is a row of styled divs with no text.
 */
export function parseDetailSignals(html: string): TabQualitySignals {
  const signals: TabQualitySignals = {}

  const downloads = /Times downloaded<\/td>\s*<td>\s*([\d\s,]+?)\s*<\/td>/i.exec(html)
  if (downloads) {
    const value = Number.parseInt(downloads[1].replace(/[\s,]/g, ''), 10)
    if (!Number.isNaN(value)) signals.downloads = value
  }

  const format = /Tab file type<\/td>\s*<td>\s*([A-Za-z0-9]+)\s*<\/td>/i.exec(html)
  if (format) signals.format = format[1].toLowerCase()

  const size = /File size<\/td>\s*<td>\s*~?\s*([\d.]+)\s*kb\s*<\/td>/i.exec(html)
  if (size) {
    const kb = Number.parseFloat(size[1])
    if (!Number.isNaN(kb)) signals.sizeBytes = Math.round(kb * 1024)
  }

  const ratingValue = /"ratingValue"\s*:\s*([\d.]+)/.exec(html)
  const ratingCount = /"ratingCount"\s*:\s*(\d+)/.exec(html)
  if (ratingValue && ratingCount) {
    const value = Number.parseFloat(ratingValue[1])
    const votes = Number.parseInt(ratingCount[1], 10)
    if (!Number.isNaN(value) && !Number.isNaN(votes) && votes > 0) {
      signals.ratingValue = value
      signals.ratingVotes = votes
    }
  }

  return signals
}

/**
 * Extracts the filename from a Content-Disposition header value, handling
 * both quoted (`filename="x.gp3"`) and unquoted (`filename=x.gp3`) forms.
 * Returns null when the header is absent or carries no filename.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (header === null) {
    return null
  }
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header)
  if (quoted) {
    return quoted[1].length > 0 ? quoted[1] : null
  }
  const unquoted = /filename\s*=\s*([^;\s]+)/i.exec(header)
  if (unquoted) {
    return unquoted[1].length > 0 ? unquoted[1] : null
  }
  return null
}
