import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeDesktopUrl,
  checkHealth,
  isMixedContentBlocked,
  resolveDesktop,
} from '../client.ts'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  activeDesktopUrl.value = null
})

describe('checkHealth', () => {
  it('returns ok with the version on a healthy response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', version: '1.2.3' })))

    const result = await checkHealth('https://desktop.example.ts.net')

    expect(result).toEqual({ ok: true, version: '1.2.3' })
  })

  it('returns not-ok when the response is a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })))

    const result = await checkHealth('https://desktop.example.ts.net')

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns not-ok when fetch rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await checkHealth('https://desktop.example.ts.net')

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('does not call fetch at all when the request would be mixed-content blocked', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // isMixedContentBlocked falls back to "page is https" when window is
    // unavailable (as in this node test environment), so an http:// url here
    // is treated as blocked.
    const result = await checkHealth('http://192.168.1.50:8765')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
  })
})

describe('isMixedContentBlocked', () => {
  it('flags an http:// url (page defaults to https when window is unavailable)', () => {
    expect(isMixedContentBlocked('http://192.168.1.50:8765')).toBe(true)
  })

  it('does not flag an https:// url', () => {
    expect(isMixedContentBlocked('https://desktop.example.ts.net')).toBe(false)
  })

  it('does not flag an empty string', () => {
    expect(isMixedContentBlocked('')).toBe(false)
  })
})

describe('resolveDesktop', () => {
  it('prefers the tailscale URL when both answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', version: '1.0.0' }))
    vi.stubGlobal('fetch', fetchMock)

    const url = await resolveDesktop({
      tailscaleUrl: 'https://desktop.example.ts.net',
      lanUrl: 'https://192.168.1.50:8765',
    })

    expect(url).toBe('https://desktop.example.ts.net')
    expect(activeDesktopUrl.value).toBe('https://desktop.example.ts.net')
    // Only the tailscale candidate should have been tried.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the LAN URL when tailscale does not answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', version: '1.0.0' }))
    vi.stubGlobal('fetch', fetchMock)

    const url = await resolveDesktop({
      tailscaleUrl: 'https://desktop.example.ts.net',
      lanUrl: 'https://192.168.1.50:8765',
    })

    expect(url).toBe('https://192.168.1.50:8765')
    expect(activeDesktopUrl.value).toBe('https://192.168.1.50:8765')
  })

  it('returns null and clears activeDesktopUrl when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })))
    activeDesktopUrl.value = 'https://stale.example.ts.net'

    const url = await resolveDesktop({
      tailscaleUrl: 'https://desktop.example.ts.net',
      lanUrl: 'https://192.168.1.50:8765',
    })

    expect(url).toBeNull()
    expect(activeDesktopUrl.value).toBeNull()
  })

  it('returns null without calling fetch when no candidates are configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const url = await resolveDesktop({ tailscaleUrl: '', lanUrl: '' })

    expect(url).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
