import { offlineStore, offlineBannerMessage } from './offlineStore'
import './offline.css'

/**
 * Surfaces eviction and storage-pressure state in one place. The library must
 * never just look empty (ADR-003), so this explains what happened instead.
 */
export function StorageBanner() {
  const message = offlineBannerMessage()
  if (!message) return null

  const critical = offlineStore.budget.value?.level === 'critical'

  return (
    <div
      class={critical ? 'storage-banner storage-banner--critical' : 'storage-banner'}
      role="status"
    >
      <span class="storage-banner__text">{message}</span>
      <button
        type="button"
        class="storage-banner__dismiss"
        onClick={() => offlineStore.dismissBanner()}
      >
        Dismiss
      </button>
    </div>
  )
}
