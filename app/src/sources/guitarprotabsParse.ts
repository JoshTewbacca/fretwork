// Pure, dependency-free parsing helpers for the guitarprotabs.org HTML source.
// No network access happens here - see app/api/tabs/search.ts and
// app/api/tabs/download.ts for the serverless functions that fetch the
// HTML/binary and call into these helpers (the api/ functions duplicate the
// small pieces they need, since app/tsconfig.app.json only covers src/ and
// api/ must remain independently compilable - see the note in those files).
//
// Why this source earns a second adapter: unlike gprotab, its search results
// page already carries the download count and file format for every row, so
// ranking versions costs no extra requests. Measured 2026-07-31 by counting
// its own letter indexes: 21,572 tabs across 3,163 artists, roughly a third
// of them artists the gprotab catalogue does not have.

import type { TabQualitySignals, TabSearchResult } from './types.ts'
import { splitVersion } from './versionSplit.ts'

/** Origin of the upstream tab archive this source scrapes. */
export const GUITARPROTABS_ORIGIN = 'https://guitarprotabs.org'

// A search result row, per the observed markup:
//   <tr>
//     <td class="ucwords"><a href="https://guitarprotabs.org/m/metallica/master_of_puppets_(2)_11680/"
//                            title="Master Of Puppets (2) byMetallica">
//                           <span Class='highlight'>master Of Puppets</span> (2)</a></td>
//     <td><a href="...">Metallica</a></td>
//     <td>.gp3</td>
//     <td><span class="badge">14,028</span></td>
//   </tr>
// The anchor's title attribute is the parse target for the song name: the
// visible text is lowercased on its first word by the site's search
// highlighter, while the title attribute keeps the real casing.
const ROW_RE =
  /<tr[^>]*>\s*<td[^>]*>\s*<a\s+href="([^"]+)"\s+title="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>\s*<a\s[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  '#39': "'",
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
}

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

/** Strips tags, decodes entities, and collapses internal whitespace. */
function cleanCell(rawHtml: string): string {
  return decodeEntities(rawHtml.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The anchor's title attribute reads "Master Of Puppets (2) byMetallica" -
 * the song name with the artist appended and no space after "by". Removes
 * that suffix using the artist taken from the row's own artist cell, rather
 * than splitting on "by", which appears inside plenty of real song titles.
 */
export function songNameFromTitleAttribute(titleAttribute: string, artist: string): string {
  const suffix = `by${artist}`
  const value = titleAttribute.trim()
  if (value.toLowerCase().endsWith(suffix.toLowerCase())) {
    return value.slice(0, value.length - suffix.length).trim()
  }
  return value
}

/** Normalises the format cell (".gp4") to the bare lowercase extension. */
function normaliseFormat(cell: string): string | undefined {
  const match = /([A-Za-z0-9]+)/.exec(cleanCell(cell))
  return match ? match[1].toLowerCase() : undefined
}

/**
 * Parses a guitarprotabs.org search results page. Rows whose download cell is
 * not a number are skipped: the results table is interleaved with ad rows
 * that reuse the same markup.
 */
export function parseSearchHtml(html: string): TabSearchResult[] {
  const results: TabSearchResult[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(ROW_RE)) {
    const [, hrefRaw, titleAttribute, innerHtml, artistHtml, formatHtml, downloadsHtml] = match

    const downloads = Number.parseInt(cleanCell(downloadsHtml).replace(/[\s,]/g, ''), 10)
    if (Number.isNaN(downloads)) continue

    // Hrefs are HTML-escaped in the markup ("..._(s&amp;m)_11684/"); the path
    // has to be decoded or the download proxy asks upstream for the wrong URL.
    const externalId = decodeEntities(hrefRaw).replace(GUITARPROTABS_ORIGIN, '')
    if (!externalId.startsWith('/') || seen.has(externalId)) continue
    seen.add(externalId)

    const artist = cleanCell(artistHtml)
    const songName = artist
      ? songNameFromTitleAttribute(decodeEntities(titleAttribute), artist)
      : cleanCell(innerHtml)
    if (!songName || !artist) continue

    const { base, version } = splitVersion(songName)
    const signals: TabQualitySignals = { downloads }
    const format = normaliseFormat(formatHtml)
    if (format !== undefined) signals.format = format

    results.push({
      sourceId: 'guitarprotabs',
      externalId,
      title: base,
      artist,
      url: GUITARPROTABS_ORIGIN + externalId,
      ...(version === undefined ? {} : { version }),
      signals,
    })
  }

  return results
}
