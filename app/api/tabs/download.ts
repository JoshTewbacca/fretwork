// Vercel Edge Function: GET /api/tabs/download?id=<externalId>&source=<sourceId>
//
// Streams a tab file back from one of the free archives (none send CORS
// headers, so the browser can't fetch them directly). The `id` query param is
// the externalId path returned by /api/tabs/search and is strictly validated
// per source below - this function must never be usable as an open proxy to
// arbitrary URLs.
//
// See app/src/sources/types.ts for the FetchedTab contract this ultimately
// feeds. As with search.ts, this file duplicates the couple of parsing
// helpers it needs from app/src/sources/*Parse.ts rather than importing
// across the src/api boundary (app/tsconfig.app.json only covers src/, and an
// explicit ".ts" import path relies on bundler-only resolution this
// standalone function isn't guaranteed to get).

export const config = { runtime: 'edge' }

const GPROTAB_ORIGIN = 'https://gprotab.net'
const GUITARPROTABS_ORIGIN = 'https://guitarprotabs.org'
const USER_AGENT = 'Fretwork/1.0 (personal guitar-tab tool; +https://github.com/) tab-search-proxy'
const DOWNLOAD_TIMEOUT_MS = 20_000
const MAX_CONTENT_LENGTH_BYTES = 20 * 1024 * 1024

type SourceId = 'gprotab' | 'guitarprotabs'

// gprotab: exactly two "/en/tabs/{slug}/{slug}" path segments of unreserved
// URL characters.
const GPROTAB_ID_RE = /^\/en\/tabs\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+$/

// guitarprotabs: "/{letter}/{artist}/{song}/" with a trailing slash. Its
// slugs keep punctuation the gprotab ones don't - "clapton,_eric",
// "eagles_(the)", "i'm_yours_20643", "master_of_puppets_(s&m)_11684" - so the
// character class has to be wider. It still excludes everything that could
// leave the intended path shape: no slashes, no backslashes, no colons, no
// percent signs (which could smuggle an encoded separator past this check),
// no query or fragment characters.
const GUITARPROTABS_ID_RE = /^\/[a-z0-9]\/[A-Za-z0-9._~,'()&!*+-]+\/[A-Za-z0-9._~,'()&!*+-]+\/$/

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isValidId(source: SourceId, id: string): boolean {
  // Belt and braces against traversal, ahead of the per-source shape check.
  if (id.includes('..')) return false
  return source === 'guitarprotabs' ? GUITARPROTABS_ID_RE.test(id) : GPROTAB_ID_RE.test(id)
}

function filenameFromContentDisposition(header: string | null): string | null {
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

function filenameFromExternalId(externalId: string): string {
  const trimmed = externalId.replace(/\/+$/, '')
  const lastSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return `${lastSegment || 'tab'}.gp3`
}

// HTTP header values must be ByteString (Latin-1); filenames pulled from the
// upstream Content-Disposition can contain arbitrary Unicode (e.g. accented
// artist names), which would otherwise throw when set on a Headers object.
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '_')
}

/**
 * guitarprotabs serves the tab page's HTML instead of the file when the
 * download URL is requested without a Referer pointing at that tab's own
 * page, so the referring page is sent explicitly. gprotab needs no such
 * header and is given none.
 */
function upstreamRequestFor(source: SourceId, id: string): { url: string; headers: HeadersInit } {
  if (source === 'guitarprotabs') {
    return {
      url: `${GUITARPROTABS_ORIGIN}${id}download/`,
      headers: { 'User-Agent': USER_AGENT, Referer: `${GUITARPROTABS_ORIGIN}${id}` },
    }
  }
  return { url: `${GPROTAB_ORIGIN}${id}?download`, headers: { 'User-Agent': USER_AGENT } }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  const requested = url.searchParams.get('source') ?? 'gprotab'
  if (requested !== 'gprotab' && requested !== 'guitarprotabs') {
    return jsonError('Query parameter "source" must be "gprotab" or "guitarprotabs".', 400)
  }
  const source: SourceId = requested

  if (id === null || !isValidId(source, id)) {
    return jsonError(`Query parameter "id" is required and must be a valid ${source} tab path.`, 400)
  }

  const request = upstreamRequestFor(source, id)

  let upstream: Response
  try {
    upstream = await fetch(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
  } catch {
    return jsonError('Failed to reach the tab download upstream.', 502)
  }

  if (!upstream.ok) {
    return jsonError(`Tab download upstream returned status ${upstream.status}.`, 502)
  }

  // Both archives serve tab files as an octet-stream attachment. An HTML body
  // here means the upstream returned a page instead of a file (guitarprotabs
  // does this when it rejects the request), which must not be stored as a tab.
  const contentType = upstream.headers.get('Content-Type') ?? ''
  if (contentType.toLowerCase().includes('text/html')) {
    return jsonError('Tab download upstream returned a page instead of a file.', 502)
  }

  const contentLengthHeader = upstream.headers.get('Content-Length')
  if (contentLengthHeader !== null) {
    const contentLength = Number.parseInt(contentLengthHeader, 10)
    if (!Number.isNaN(contentLength) && contentLength > MAX_CONTENT_LENGTH_BYTES) {
      return jsonError('Tab file exceeds the maximum allowed size.', 502)
    }
  }

  const filename =
    filenameFromContentDisposition(upstream.headers.get('Content-Disposition')) ??
    filenameFromExternalId(id)

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Tab-Filename': sanitizeHeaderValue(filename),
      'Access-Control-Expose-Headers': 'X-Tab-Filename',
      'Cache-Control': 'public, s-maxage=86400',
    },
  })
}
