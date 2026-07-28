import type { JSX } from 'preact'
import { currentRoute, navigate, type Route } from './router'
import {
  PlayerIcon,
  PracticeIcon,
  SearchIcon,
  LibraryIcon,
  SettingsIcon,
} from './icons'
import { PlayerScreen } from './screens/PlayerScreen'
import { PracticeScreen } from './screens/PracticeScreen'
import { SearchScreen } from './screens/SearchScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StorageBanner } from '../offline/StorageBanner'
import { practiceStore } from '../practice/practiceStore'
import { dueRows } from '../practice/ui/helpers'
import './AppShell.css'

interface TabDef {
  route: Route
  label: string
  Icon: () => JSX.Element
}

const TABS: TabDef[] = [
  { route: 'player', label: 'Player', Icon: PlayerIcon },
  { route: 'practice', label: 'Practice', Icon: PracticeIcon },
  { route: 'search', label: 'Search', Icon: SearchIcon },
  { route: 'library', label: 'Library', Icon: LibraryIcon },
  { route: 'settings', label: 'Settings', Icon: SettingsIcon },
]

export function AppShell() {
  const route = currentRoute.value
  // Practice is the one tab whose contents become true while you are not
  // looking at it, so it is the only one that carries a count.
  const dueCount = dueRows(
    practiceStore.passages.value,
    practiceStore.states.value,
    Date.now(),
  ).length

  return (
    <div class="app-shell">
      <StorageBanner />
      <main class="app-content">
        {/* PlayerScreen stays mounted so the alphaTab player and its audio
            context survive tab switches; the other screens are cheap. */}
        <div class="screen-keeper" hidden={route !== 'player'}>
          <PlayerScreen />
        </div>
        {route === 'practice' && <PracticeScreen />}
        {route === 'search' && <SearchScreen />}
        {route === 'library' && <LibraryScreen />}
        {route === 'settings' && <SettingsScreen />}
      </main>

      <nav class="tab-bar" aria-label="Main navigation">
        {TABS.map(({ route: tabRoute, label, Icon }) => {
          const active = route === tabRoute
          const badge = tabRoute === 'practice' && dueCount > 0 ? dueCount : null
          return (
            <button
              key={tabRoute}
              type="button"
              class={active ? 'tab-bar__item is-active' : 'tab-bar__item'}
              aria-current={active ? 'page' : undefined}
              aria-label={badge ? `${label}, ${badge} due` : undefined}
              onClick={() => navigate(tabRoute)}
            >
              {badge !== null && <span class="tab-bar__badge">{badge}</span>}
              <Icon />
              <span class="tab-bar__label">{label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
