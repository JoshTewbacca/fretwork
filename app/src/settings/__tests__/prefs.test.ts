import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { getDb } from '../../db/open.ts'
import { putKv } from '../../db/kv.ts'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import { DEFAULT_PREFS, loadPrefs, prefs, resetPrefsForTests, setPrefs } from '../prefs.ts'
import { MAX_ZOOM_PCT } from '../../player/core/zoom.ts'

afterEach(async () => {
  resetPrefsForTests()
  await resetTestDb()
})

const KV_KEY = 'display-prefs'

describe('display preferences', () => {
  it('defaults to tab only, one track', async () => {
    await loadPrefs()
    expect(prefs.value.showNotation).toBe(false)
    expect(prefs.value.showAllTracks).toBe(false)
  })

  it('reads back what was stored', async () => {
    const db = await getDb()
    await putKv(db, KV_KEY, { showNotation: true, showAllTracks: true, defaultZoomPct: 160 })

    await loadPrefs()

    expect(prefs.value).toEqual({
      showNotation: true,
      showAllTracks: true,
      defaultZoomPct: 160,
    })
  })

  it('persists a patch without disturbing the other preferences', async () => {
    await loadPrefs()
    await setPrefs({ showNotation: true })
    resetPrefsForTests()

    await loadPrefs()

    expect(prefs.value.showNotation).toBe(true)
    expect(prefs.value.showAllTracks).toBe(false)
    expect(prefs.value.defaultZoomPct).toBe(DEFAULT_PREFS.defaultZoomPct)
  })

  it('clamps a stored zoom that is out of range', async () => {
    const db = await getDb()
    await putKv(db, KV_KEY, { defaultZoomPct: 9000 })

    await loadPrefs()

    expect(prefs.value.defaultZoomPct).toBe(MAX_ZOOM_PCT)
  })

  it('falls back to the defaults when the stored record is unusable', async () => {
    const db = await getDb()
    await putKv(db, KV_KEY, 'not a preferences record')

    await loadPrefs()

    expect(prefs.value).toEqual(DEFAULT_PREFS)
  })
})
