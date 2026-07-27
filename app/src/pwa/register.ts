/// <reference types="vite-plugin-pwa/client" />

// Service worker registration entry point. Wired into main.tsx by the app
// integration (not imported from here) - see task 0.5 delegation notes.

import { requestPersistentStorage } from './persistence';

/**
 * Registers the service worker (production builds only, so dev stays free of
 * SW caching quirks) and requests persistent storage. Call once at app
 * startup.
 */
export async function initPwa(): Promise<void> {
  if (import.meta.env.PROD) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  }

  await requestPersistentStorage();
}
