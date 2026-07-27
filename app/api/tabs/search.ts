// Vercel Edge Function: GET /api/tabs/search?q=<query>
//
// Proxies a search against gprotab.net, which sends no CORS headers and so
// cannot be called directly from the browser. See app/src/sources/types.ts
// for the TabSearchResult contract this returns (that file is not imported
// here - app/tsconfig.app.json only covers src/, and an explicit ".ts"
// import path relies on bundler-only resolution that this standalone
// function isn't guaranteed to get, so the small amount of parsing logic
// needed here is duplicated from app/src/sources/gprotabParse.ts instead of
// imported across that boundary).

export const config = { runtime: 'edge' }

const GPROTAB_ORIGIN = 'https://gprotab.net'
const USER_AGENT = 'Fretwork/1.0 (personal guitar-tab tool; +https://github.com/) tab-search-proxy'
const SEARCH_TIMEOUT_MS = 10_000
const MAX_RESULTS = 40

interface TabSearchResult {
  sourceId: 'gprotab'
  externalId: string
  title: string
  artist: string
  url: string
}

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

function cleanName(rawHtml: string): string {
  return decodeEntities(rawHtml).replace(/\s+/g, ' ').trim()
}

function parseSearchHtml(html: string): TabSearchResult[] {
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

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const q = url.searchParams.get('q')

  if (q === null || q.trim().length < 2) {
    return jsonError('Query parameter "q" is required and must be at least 2 characters.', 400)
  }

  const searchUrl = `${GPROTAB_ORIGIN}/en/search?q=${encodeURIComponent(q)}`

  let upstream: Response
  try {
    upstream = await fetch(searchUrl, {
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

  const results = parseSearchHtml(html).slice(0, MAX_RESULTS)

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
