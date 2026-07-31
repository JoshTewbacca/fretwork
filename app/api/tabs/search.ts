// Vercel Edge Function: GET /api/tabs/search?q=<query>&source=<sourceId>
//
// Proxies a search against one of the free tab archives, none of which send
// CORS headers, so none can be called directly from the browser. See
// app/src/sources/types.ts for the TabSearchResult contract this returns
// (that file is not imported here - app/tsconfig.app.json only covers src/,
// and an explicit ".ts" import path relies on bundler-only resolution that
// this standalone function isn't guaranteed to get, so the parsing logic
// needed here is duplicated from app/src/sources/*Parse.ts instead of
// imported across that boundary).
//
// The two sources differ in where their quality signals live. guitarprotabs
// puts the download count and format on the results page, so its rows arrive
// ranked for free. gprotab puts them only on each tab's own page, so results
// are enriched with a bounded fan-out of detail requests - see ENRICH_LIMIT.

export const config = { runtime: 'edge' }

const GPROTAB_ORIGIN = 'https://gprotab.net'
const GUITARPROTABS_ORIGIN = 'https://guitarprotabs.org'
const USER_AGENT = 'Fretwork/1.0 (personal guitar-tab tool; +https://github.com/) tab-search-proxy'
const SEARCH_TIMEOUT_MS = 10_000
const DETAIL_TIMEOUT_MS = 8_000
const MAX_RESULTS = 40

/**
 * How many gprotab results get a detail request for their download count, and
 * how many of those run at once. Every unique search costs this many upstream
 * requests once, then rides the CDN cache below for an hour. Kept modest
 * because it is a politeness budget, not a performance one.
 */
const ENRICH_LIMIT = 12
const ENRICH_CONCURRENCY = 4

type SourceId = 'gprotab' | 'guitarprotabs'

interface TabQualitySignals {
  downloads?: number
  ratingValue?: number
  ratingVotes?: number
  format?: string
  sizeBytes?: number
}

interface TabSearchResult {
  sourceId: SourceId
  externalId: string
  title: string
  artist: string
  url: string
  version?: string
  signals?: TabQualitySignals
}

// --- shared HTML helpers (duplicated from src/sources/*Parse.ts) ---

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

function cleanCell(rawHtml: string): string {
  return decodeEntities(rawHtml.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function splitVersion(title: string): { base: string; version?: string } {
  const trimmed = title.trim()
  const parenthesised = /^(.*?)\s*\(([^()]+)\)$/.exec(trimmed)
  if (parenthesised && parenthesised[1].trim()) {
    return { base: parenthesised[1].trim(), version: parenthesised[2].trim() }
  }
  const numbered = /^(.*?)\s+(\d{1,2})$/.exec(trimmed)
  if (numbered && numbered[1].trim()) {
    return { base: numbered[1].trim(), version: numbered[2] }
  }
  return { base: trimmed }
}

// --- gprotab ---

const GPROTAB_ANCHOR_PAIR_RE =
  /<a\s+href="(\/en\/tabs\/[^"]+)"\s+class="tab-band"[^>]*>([\s\S]*?)<\/a>\s*<a\s+href="(\/en\/tabs\/[^"]+)"\s+class="tab-name"[^>]*>([\s\S]*?)<\/a>/g

function parseGprotabSearchHtml(html: string): TabSearchResult[] {
  const results: TabSearchResult[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(GPROTAB_ANCHOR_PAIR_RE)) {
    const [, , artistHtml, songHref, songHtml] = match
    const externalId = songHref
    if (seen.has(externalId)) continue
    seen.add(externalId)

    const { base, version } = splitVersion(cleanCell(songHtml))
    results.push({
      sourceId: 'gprotab',
      externalId,
      title: base,
      artist: cleanCell(artistHtml),
      url: GPROTAB_ORIGIN + externalId,
      ...(version === undefined ? {} : { version }),
    })
  }

  return results
}

function parseGprotabDetailSignals(html: string): TabQualitySignals {
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
 * Fills in download counts for the first ENRICH_LIMIT gprotab results, a few
 * at a time. A detail request that fails or times out leaves that result
 * without signals rather than failing the search - the row still works, it
 * just ranks below the ones we know about.
 */
async function enrichGprotabResults(results: TabSearchResult[]): Promise<void> {
  const targets = results.slice(0, ENRICH_LIMIT)

  for (let start = 0; start < targets.length; start += ENRICH_CONCURRENCY) {
    const batch = targets.slice(start, start + ENRICH_CONCURRENCY)
    await Promise.all(
      batch.map(async (result) => {
        try {
          const response = await fetch(GPROTAB_ORIGIN + result.externalId, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
          })
          if (!response.ok) return
          const signals = parseGprotabDetailSignals(await response.text())
          if (Object.keys(signals).length > 0) result.signals = signals
        } catch {
          // Leave this result unenriched; see the note above.
        }
      }),
    )
  }
}

// --- guitarprotabs ---

const GUITARPROTABS_ROW_RE =
  /<tr[^>]*>\s*<td[^>]*>\s*<a\s+href="([^"]+)"\s+title="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>\s*<a\s[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g

function songNameFromTitleAttribute(titleAttribute: string, artist: string): string {
  const suffix = `by${artist}`
  const value = titleAttribute.trim()
  if (value.toLowerCase().endsWith(suffix.toLowerCase())) {
    return value.slice(0, value.length - suffix.length).trim()
  }
  return value
}

function parseGuitarprotabsSearchHtml(html: string): TabSearchResult[] {
  const results: TabSearchResult[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(GUITARPROTABS_ROW_RE)) {
    const [, hrefRaw, titleAttribute, innerHtml, artistHtml, formatHtml, downloadsHtml] = match

    const downloads = Number.parseInt(cleanCell(downloadsHtml).replace(/[\s,]/g, ''), 10)
    if (Number.isNaN(downloads)) continue

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
    const format = /([A-Za-z0-9]+)/.exec(cleanCell(formatHtml))
    if (format) signals.format = format[1].toLowerCase()

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

// --- handler ---

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function searchUrlFor(source: SourceId, q: string): string {
  if (source === 'guitarprotabs') {
    return `${GUITARPROTABS_ORIGIN}/search.php?search=${encodeURIComponent(q)}&in=songs&page=1`
  }
  return `${GPROTAB_ORIGIN}/en/search?q=${encodeURIComponent(q)}`
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')

  if (q === null || q.trim().length < 2) {
    return jsonError('Query parameter "q" is required and must be at least 2 characters.', 400)
  }

  // Defaults to gprotab so that any client build predating the second source
  // keeps working against this function unchanged.
  const requested = url.searchParams.get('source') ?? 'gprotab'
  if (requested !== 'gprotab' && requested !== 'guitarprotabs') {
    return jsonError('Query parameter "source" must be "gprotab" or "guitarprotabs".', 400)
  }
  const source: SourceId = requested

  let upstream: Response
  try {
    upstream = await fetch(searchUrlFor(source, q), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
  } catch {
    return jsonError('Failed to reach the tab search upstream.', 502)
  }

  if (!upstream.ok) {
    return jsonError(`Tab search upstream returned status ${upstream.status}.`, 502)
  }

  let html: string
  try {
    html = await upstream.text()
  } catch {
    return jsonError('Failed to read the tab search upstream response.', 502)
  }

  const results = (
    source === 'guitarprotabs'
      ? parseGuitarprotabsSearchHtml(html)
      : parseGprotabSearchHtml(html)
  ).slice(0, MAX_RESULTS)

  if (source === 'gprotab') {
    await enrichGprotabResults(results)
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
