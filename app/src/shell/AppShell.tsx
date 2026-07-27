import type { JSX } from 'preact'
import { currentRoute, navigate, type Route } from './router'
import { PlayerIcon, SearchIcon, LibraryIcon, SettingsIcon } from './icons'
import { PlayerScreen } from './screens/PlayerScreen'
import { SearchScreen } from './screens/SearchScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import './AppShell.css'

interface TabDef {
  route: Route
  label: string
  Icon: () => JSX.Element
}

const TABS: TabDef[] = [
  { route: 'player', label: 'Player', Icon: PlayerIcon },
  { route: 'search', label: 'Search', Icon: SearchIcon },
  { route: 'library', label: 'Library', Icon: LibraryIcon },
  { route: 'settings', label: 'Settings', Icon: SettingsIcon },
]

export function AppShell() {
  const route = currentRoute.value

  return (
    <div class="app-shell">
      <main class="app-content">
        {/* PlayerScreen stays mounted so the alphaTab player and its audio
            context survive tab switches; the other screens are cheap. */}
        <div class="screen-keeper" hidden={route !== 'player'}>
          <PlayerScreen />
        </div>
        {route === 'search' && <SearchScreen />}
        {route === 'library' && <LibraryScreen />}
        {route === 'settings' && <SettingsScreen />}
      </main>

      <nav class="tab-bar" aria-label="Main navigation">
        {TABS.map(({ route: tabRoute, label, Icon }) => {
          const active = route === tabRoute
          return (
            <button
              key={tabRoute}
              type="button"
              class={active ? 'tab-bar__item is-active' : 'tab-bar__item'}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(tabRoute)}
            >
              <Icon />
              <span class="tab-bar__label">{label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
