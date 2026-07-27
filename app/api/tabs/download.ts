// Vercel Edge Function: GET /api/tabs/download?id=<externalId>
//
// Streams a tab file back from gprotab.net (no CORS headers upstream, so the
// browser can't fetch it directly). The `id` query param is the externalId
// path returned by /api/tabs/search (e.g. "/en/tabs/metallica/one") and is
// strictly validated below - this function must never be usable as an open
// proxy to arbitrary URLs.
//
// See app/src/sources/types.ts for the FetchedTab contract this ultimately
// feeds. As with search.ts, this file duplicates the couple of parsing
// helpers it needs from app/src/sources/gprotabParse.ts rather than
// importing across the src/api boundary (app/tsconfig.app.json only covers
// src/, and an explicit ".ts" import path relies on bundler-only resolution
// this standalone function isn't guaranteed to get).

export const config = { runtime: 'edge' }

const GPROTAB_ORIGIN = 'https://gprotab.net'
const USER_AGENT = 'Fretwork/1.0 (personal guitar-tab tool; +https://github.com/) tab-search-proxy'
const DOWNLOAD_TIMEOUT_MS = 20_000
const MAX_CONTENT_LENGTH_BYTES = 20 * 1024 * 1024

// Must match exactly two "/en/tabs/{slug}/{slug}" path segments made up of
// unreserved URL characters. Anything else - absolute URLs, protocol-relative
// URLs, path traversal, query strings, extra segments - is rejected.
const EXTERNAL_ID_RE = /^\/en\/tabs\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+$/

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  const lastSegment = externalId.slice(externalId.lastIndexOf('/') + 1)
  return `${lastSegment || 'tab'}.gp3`
}

// HTTP header values must be ByteString (Latin-1); filenames pulled from the
// upstream Content-Disposition can contain arbitrary Unicode (e.g. accented
// artist names), which would otherwise throw when set on a Headers object.
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '_')
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (id === null || !EXTERNAL_ID_RE.test(id)) {
    return jsonError('Query parameter "id" is required and must be a valid gprotab tab path.', 400)
  }

  const downloadUrl = `${GPROTAB_ORIGIN}${id}?download`

  let upstream: Response
  try {
    upstream = await fetch(downloadUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
  } catch {
    return jsonError('Failed to reach the tab download upstream.', 502)
  }

  if (!upstream.ok) {
    return jsonError(`Tab download upstream returned status ${upstream.status}.`, 502)
  }

  const contentLengthHeader = upstream.headers.get('Content-Length')
  if (contentLengthHeader !== null) {
    const contentLength = Number.parseInt(contentLengthHeader, 10)
    if (!Number.isNaN(contentLength) && contentLength > MAX_CONTENT_LENGTH_BYTES) {
      return jsonError('Tab file exceeds the maximum allowed size.', 502)
    }
  }

  const filename =
    filenameFromContentDisposition(upstream.headers.get('Content-Disposition')) ?? filenameFromExternalId(id)

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
