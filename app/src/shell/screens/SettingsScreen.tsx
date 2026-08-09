import { useEffect, useState } from 'preact/hooks'
import '../screens/screens.css'
import '../../desktop/settings.css'
import { Switch } from '../../player/ui/Switch.tsx'
import { Stepper } from '../../player/ui/Stepper.tsx'
import { MAX_ZOOM_PCT, MIN_ZOOM_PCT } from '../../player/core/zoom.ts'
import { loadPrefs, prefs, prefsLoaded, setPrefs } from '../../settings/prefs.ts'
import { getDb } from '../../db/open.ts'
import { getDesktopConfig, setDesktopConfig, candidateUrls } from '../../desktop/config.ts'
import {
  activeDesktopUrl,
  checkHealth,
  isMixedContentBlocked,
  resolveDesktop,
} from '../../desktop/client.ts'
import { probe } from '../../desktop/status.ts'
import { syncLibrary } from '../../library/sync.ts'
import { refresh as refreshLibrary } from '../../library/libraryStore.ts'
import { ReviewQueue } from '../../review/ReviewQueue.tsx'
import { getStorageEstimate } from '../../pwa/persistence.ts'
import InstallHelp from '../../pwa/InstallHelp.tsx'

const APP_NAME = 'Fretwork'
const APP_VERSION = '0.1.0'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type TestState = 'idle' | 'checking' | 'ok' | 'error'

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DesktopConnectionSection() {
  const [tailscaleUrl, setTailscaleUrl] = useState('')
  const [lanUrl, setLanUrl] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const db = await getDb()
      const config = await getDesktopConfig(db)
      if (cancelled) return
      setTailscaleUrl(config.tailscaleUrl)
      setLanUrl(config.lanUrl)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave() {
    setSaveState('saving')
    try {
      const db = await getDb()
      await setDesktopConfig(db, { tailscaleUrl: tailscaleUrl.trim(), lanUrl: lanUrl.trim() })
      setSaveState('saved')
      void probe()
    } catch {
      setSaveState('error')
    }
  }

  async function handleTest() {
    setTestState('checking')
    setTestMessage('')
    const candidates = candidateUrls({ tailscaleUrl, lanUrl })
    if (candidates.length === 0) {
      setTestState('error')
      setTestMessage('Enter at least one address first.')
      return
    }
    for (const url of candidates) {
      const result = await checkHealth(url)
      if (result.ok) {
        setTestState('ok')
        setTestMessage(
          `Connected to ${url}${result.version ? ` (ingest service ${result.version})` : ''}.`,
        )
        // Test connection is otherwise cosmetic: everything that actually talks to
        // the desktop (audio downloads, review queue) reads activeDesktopUrl, which
        // only resolveDesktop() sets. Without this, a successful test still leaves
        // downloads reporting "the desktop is not connected".
        activeDesktopUrl.value = url
        return
      }
    }
    setTestState('error')
    setTestMessage('Could not reach the desktop at either address.')
  }

  const tailscaleBlocked = isMixedContentBlocked(tailscaleUrl)
  const lanBlocked = isMixedContentBlocked(lanUrl)

  if (!loaded) return null

  return (
    <div class="settings-section">
      <h3 class="h-sec">Desktop connection</h3>
      <p class="settings-section__hint">
        The desktop is only needed to bring in new audio and review matches -- playing tabs you
        already have works without it.
      </p>
      <p class="settings-section__hint">
        This page is loaded over HTTPS, so the desktop address must also be HTTPS or the browser
        will silently block every request. A plain http:// address only works if you open this
        app itself over http:// (e.g. a local dev server); the deployed app cannot use one. Use{' '}
        <strong>Tailscale Serve</strong> to get an https://&hellip;.ts.net address for your
        machine.
      </p>

      <div class="settings-field">
        <label class="settings-field__label" for="settings-tailscale-url">
          Tailscale URL
        </label>
        <input
          id="settings-tailscale-url"
          class="settings-field__input"
          type="text"
          placeholder="https://desktop-name.tailnet-name.ts.net"
          value={tailscaleUrl}
          onInput={(e) => setTailscaleUrl((e.currentTarget as HTMLInputElement).value)}
        />
        {tailscaleBlocked && (
          <p class="settings-field__warning">
            This is an http:// address. The browser will block it from this https:// page.
          </p>
        )}
      </div>

      <div class="settings-field">
        <label class="settings-field__label" for="settings-lan-url">
          LAN URL
        </label>
        <input
          id="settings-lan-url"
          class="settings-field__input"
          type="text"
          placeholder="http://192.168.1.50:8765"
          value={lanUrl}
          onInput={(e) => setLanUrl((e.currentTarget as HTMLInputElement).value)}
        />
        {lanBlocked && (
          <p class="settings-field__warning">
            This is an http:// address. The browser will block it from this https:// page.
          </p>
        )}
      </div>

      <div class="settings-actions">
        <button type="button" class="button button--primary" onClick={() => void handleSave()}>
          Save
        </button>
        <button type="button" class="button" onClick={() => void handleTest()}>
          Test connection
        </button>
        {saveState === 'saved' && <span class="settings-actions__result settings-actions__result--ok">Saved.</span>}
        {saveState === 'error' && (
          <span class="settings-actions__result settings-actions__result--error">
            Could not save settings.
          </span>
        )}
        {testState === 'checking' && <span class="settings-actions__result">Checking...</span>}
        {testState === 'ok' && (
          <span class="settings-actions__result settings-actions__result--ok">{testMessage}</span>
        )}
        {testState === 'error' && (
          <span class="settings-actions__result settings-actions__result--error">{testMessage}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Library sync (ADR-006). Manual rather than automatic in v1: the first run
 * uploads every song this phone holds, which is not something to do silently
 * on a metered connection the first time the desktop happens to answer.
 */
function LibrarySyncSection() {
  const [state, setState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSync() {
    setState('syncing')
    setMessage('')
    try {
      const db = await getDb()
      const config = await getDesktopConfig(db)
      const baseUrl = await resolveDesktop(config)
      if (!baseUrl) {
        setState('error')
        setMessage('Could not reach the desktop. Check the addresses above.')
        return
      }

      const { pull, push } = await syncLibrary(baseUrl)
      await refreshLibrary()

      const parts: string[] = []
      if (push.pushed) parts.push(`${push.pushed} sent to the desktop`)
      if (pull.added) parts.push(`${pull.added} added`)
      if (pull.updated) parts.push(`${pull.updated} updated`)
      if (!parts.length) parts.push('Already up to date')

      const problems: string[] = []
      if (push.skippedNoBlob.length) {
        problems.push(
          `${push.skippedNoBlob.length} could not be sent because the tab file is not on this phone`,
        )
      }
      if (pull.tabsMissing.length) {
        problems.push(`${pull.tabsMissing.length} tab file(s) did not download`)
      }
      if (push.rejected.length) {
        problems.push(`${push.rejected.length} rejected by the desktop`)
      }

      setState('done')
      setMessage(
        problems.length ? `${parts.join(', ')}. ${problems.join('. ')}.` : `${parts.join(', ')}.`,
      )
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'The library sync failed.')
    }
  }

  return (
    <div class="settings-section">
      <h3 class="h-sec">Library sync</h3>
      <p class="settings-section__hint">
        Sends any song the desktop does not have, then brings down everything it does. The desktop
        holds the catalogue; this phone keeps your favourites, tags, track choice and any
        corrections, and a sync never overwrites them.
      </p>
      <p class="settings-section__hint">
        Removing a song on the desktop hides it here but keeps its practice history, so re-adding
        it later picks up where you left off.
      </p>

      <div class="settings-actions">
        <button
          type="button"
          class="button button--primary"
          disabled={state === 'syncing'}
          onClick={() => void handleSync()}
        >
          {state === 'syncing' ? 'Syncing...' : 'Sync library'}
        </button>
        {state === 'done' && (
          <span class="settings-actions__result settings-actions__result--ok">{message}</span>
        )}
        {state === 'error' && (
          <span class="settings-actions__result settings-actions__result--error">{message}</span>
        )}
      </div>
    </div>
  )
}

/**
 * How tab is read. These are app-wide defaults; the player's View sheet can
 * override any of them for the song in hand without changing what is stored
 * here, so a one-off look at the notation does not become the new default.
 */
function NotationSection() {
  useEffect(() => {
    void loadPrefs()
  }, [])

  const { showNotation, showAllTracks, defaultZoomPct } = prefs.value
  if (!prefsLoaded.value) return null

  return (
    <div class="settings-section">
      <h3 class="h-sec">Notation</h3>
      <div class="card card--rows">
        <div class="row">
          <div class="row__text">
            <div class="row__label">Show standard notation</div>
            <p class="row__hint">
              Draws the five-line stave above the tab. Off shows tab only.
            </p>
          </div>
          <Switch
            label="Show standard notation"
            hideLabel
            on={showNotation}
            onToggle={() => void setPrefs({ showNotation: !showNotation })}
          />
        </div>

        <div class="row">
          <div class="row__text">
            <div class="row__label">Show all tracks</div>
            <p class="row__hint">
              Off draws only the part you play, which keeps the tab large.
            </p>
          </div>
          <Switch
            label="Show all tracks"
            hideLabel
            on={showAllTracks}
            onToggle={() => void setPrefs({ showAllTracks: !showAllTracks })}
          />
        </div>

        <div class="row">
          <div class="row__text">
            <div class="row__label">Default tab size</div>
            <p class="row__hint">Starting zoom for songs you have not adjusted.</p>
          </div>
          <Stepper
            label=""
            ariaLabel="default tab size"
            value={defaultZoomPct}
            min={MIN_ZOOM_PCT}
            max={MAX_ZOOM_PCT}
            step={10}
            format={(v) => `${v}%`}
            onChange={(v) => void setPrefs({ defaultZoomPct: v })}
          />
        </div>
      </div>
    </div>
  )
}

function StorageSection() {
  const [estimate, setEstimate] = useState<{ usageBytes: number; quotaBytes: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    void (async () => {
      const result = await getStorageEstimate()
      setEstimate(result)
      if ('storage' in navigator && 'persisted' in navigator.storage) {
        setPersisted(await navigator.storage.persisted())
      } else {
        setPersisted(null)
      }
    })()
  }, [])

  return (
    <div class="settings-section">
      <h3 class="h-sec">Storage</h3>
      <div class="card">
        {estimate ? (
          <>
            <div class="card__title">
              {formatMb(estimate.usageBytes)} of {formatMb(estimate.quotaBytes)} used
            </div>
            {persisted !== null && (
              <div class="card__sub">
                Persistent storage {persisted ? 'granted' : 'not granted'}
              </div>
            )}
            <div class="meter">
              <span
                class="meter__fill"
                style={{
                  width: `${Math.min(100, (estimate.usageBytes / Math.max(estimate.quotaBytes, 1)) * 100)}%`,
                }}
              />
            </div>
          </>
        ) : (
          <p class="settings-section__hint">Storage usage is not available in this browser.</p>
        )}
      </div>
    </div>
  )
}

export function SettingsScreen() {
  return (
    <div class="settings-screen">
      <h1 class="screen-title">Settings</h1>

      <NotationSection />

      <StorageSection />

      <DesktopConnectionSection />
      <LibrarySyncSection />

      <div class="settings-section">
        <h3 class="h-sec">Ingest review</h3>
        <ReviewQueue />
      </div>

      <div class="settings-section">
        <h3 class="h-sec">Install</h3>
        <InstallHelp />
      </div>

      <div class="settings-section">
        <h3 class="h-sec">About</h3>
        <div class="card card--rows">
          <div class="row">
            <div class="row__text">
              <div class="row__label">{APP_NAME}</div>
            </div>
            <span class="settings-row__value">{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
