import { useEffect, useState } from 'preact/hooks'
import '../screens/screens.css'
import '../../desktop/settings.css'
import { getDb } from '../../db/open.ts'
import { getDesktopConfig, setDesktopConfig, candidateUrls } from '../../desktop/config.ts'
import { checkHealth, isMixedContentBlocked } from '../../desktop/client.ts'
import { probe } from '../../desktop/status.ts'
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
      <h3 class="settings-section__title">Desktop connection</h3>
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
      <h3 class="settings-section__title">Storage</h3>
      {estimate ? (
        <div class="settings-storage">
          <span>
            {formatMb(estimate.usageBytes)} used of {formatMb(estimate.quotaBytes)} available
          </span>
          <div class="settings-storage__bar">
            <div
              class="settings-storage__bar-fill"
              style={{
                width: `${Math.min(100, (estimate.usageBytes / Math.max(estimate.quotaBytes, 1)) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <p class="settings-section__hint">Storage usage is not available in this browser.</p>
      )}
      {persisted !== null && (
        <p class="settings-section__hint">
          Persistent storage: {persisted ? 'granted' : 'not granted'}
        </p>
      )}
    </div>
  )
}

export function SettingsScreen() {
  return (
    <div class="settings-screen">
      <DesktopConnectionSection />

      <div class="settings-section">
        <h3 class="settings-section__title">Ingest review</h3>
        <ReviewQueue />
      </div>

      <StorageSection />

      <div class="settings-section">
        <h3 class="settings-section__title">Install</h3>
        <InstallHelp />
      </div>

      <div class="settings-list">
        <div class="settings-row">
          <span class="settings-row__label">About</span>
          <span class="settings-row__value">
            {APP_NAME} {APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  )
}
