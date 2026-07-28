// Minimal hash router. Three routes only; no history stack beyond what the
// browser's hash navigation already gives us for free.

import { signal } from '@preact/signals'

export type Route = 'player' | 'practice' | 'search' | 'library' | 'settings'

const DEFAULT_ROUTE: Route = 'player'

const ROUTES_BY_HASH: Record<string, Route> = {
  '#/player': 'player',
  '#/practice': 'practice',
  '#/search': 'search',
  '#/library': 'library',
  '#/settings': 'settings',
}

function parseHash(hash: string): Route {
  return ROUTES_BY_HASH[hash] ?? DEFAULT_ROUTE
}

export const currentRoute = signal<Route>(parseHash(window.location.hash))

window.addEventListener('hashchange', () => {
  currentRoute.value = parseHash(window.location.hash)
})

// Normalize an empty/unknown initial hash to the default route.
if (parseHash(window.location.hash) === DEFAULT_ROUTE && window.location.hash !== '#/player') {
  window.location.hash = '#/player'
}

export function navigate(route: Route): void {
  window.location.hash = `#/${route}`
}
