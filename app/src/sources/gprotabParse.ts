// Pure, dependency-free parsing helpers for the gprotab.net HTML source.
// No network access happens here - see app/api/tabs/search.ts and
// app/api/tabs/download.ts for the serverless functions that fetch the
// HTML/binary and call into these helpers (the api/ functions duplicate the
// small pieces they need, since app/tsconfig.app.json only covers src/ and
// api/ must remain independently compilable - see the note in those files).

import type { TabSearchResult } from './types.ts'

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

    results.push({
      sourceId: 'gprotab',
      externalId,
      title: cleanName(songHtml),
      artist: cleanName(artistHtml),
      url: GPROTAB_ORIGIN + externalId,
    })
  }

  return results
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
