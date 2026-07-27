import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { getDb } from '../../db/open.ts'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import { candidateUrls, getDesktopConfig, setDesktopConfig } from '../config.ts'

afterEach(resetTestDb)

describe('desktop config kv round-trip', () => {
  it('returns an empty config before anything has been saved', async () => {
    const db = await getDb()

    const config = await getDesktopConfig(db)

    expect(config).toEqual({ tailscaleUrl: '', lanUrl: '' })
  })

  it('persists and reloads a saved config', async () => {
    const db = await getDb()

    await setDesktopConfig(db, {
      tailscaleUrl: 'https://desktop.example.ts.net',
      lanUrl: 'http://192.168.1.50:8765',
    })
    const reloaded = await getDesktopConfig(db)

    expect(reloaded).toEqual({
      tailscaleUrl: 'https://desktop.example.ts.net',
      lanUrl: 'http://192.168.1.50:8765',
    })
  })

  it('overwrites a previously saved config', async () => {
    const db = await getDb()

    await setDesktopConfig(db, { tailscaleUrl: 'https://old.ts.net', lanUrl: '' })
    await setDesktopConfig(db, { tailscaleUrl: 'https://new.ts.net', lanUrl: 'http://192.168.1.9:8765' })
    const reloaded = await getDesktopConfig(db)

    expect(reloaded).toEqual({ tailscaleUrl: 'https://new.ts.net', lanUrl: 'http://192.168.1.9:8765' })
  })
})

describe('candidateUrls', () => {
  it('orders tailscale first, then lan, when both are set', () => {
    const urls = candidateUrls({
      tailscaleUrl: 'https://desktop.example.ts.net/',
      lanUrl: 'http://192.168.1.50:8765/',
    })

    expect(urls).toEqual(['https://desktop.example.ts.net', 'http://192.168.1.50:8765'])
  })

  it('skips blank entries', () => {
    expect(candidateUrls({ tailscaleUrl: '', lanUrl: 'http://192.168.1.50:8765' })).toEqual([
      'http://192.168.1.50:8765',
    ])
    expect(candidateUrls({ tailscaleUrl: 'https://desktop.example.ts.net', lanUrl: '' })).toEqual([
      'https://desktop.example.ts.net',
    ])
    expect(candidateUrls({ tailscaleUrl: '', lanUrl: '' })).toEqual([])
  })
})
