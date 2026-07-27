// Storage persistence helpers.
//
// iOS can evict IndexedDB even when navigator.storage.persist() has been
// granted (see ADR-003) - requesting it lowers the odds but does not
// eliminate them. This module only handles the request/estimate primitives;
// eviction detection and recovery live with the storage layer.

let warnedOnce = false;

/**
 * Requests persistent storage so the browser is less likely to evict
 * IndexedDB/Cache Storage under pressure. Resolves to whether it was granted.
 * Safe to call in environments without the Storage API (resolves false).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !('persist' in navigator.storage)) {
    return false;
  }

  try {
    const granted = await navigator.storage.persist();
    if (!granted && !warnedOnce) {
      warnedOnce = true;
      console.warn(
        '[pwa] Persistent storage was not granted; offline data may be evicted under storage pressure.',
      );
    }
    return granted;
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn('[pwa] navigator.storage.persist() threw:', err);
    }
    return false;
  }
}

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
}

/**
 * Returns the current storage usage/quota estimate, or null if the API is
 * unavailable or the call fails.
 */
export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    if (estimate.usage === undefined || estimate.quota === undefined) {
      return null;
    }
    return { usageBytes: estimate.usage, quotaBytes: estimate.quota };
  } catch (err) {
    console.warn('[pwa] navigator.storage.estimate() failed:', err);
    return null;
  }
}
