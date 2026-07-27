import '../screens/screens.css'

const APP_NAME = 'Fretwork'
const APP_VERSION = '0.1.0'

export function SettingsScreen() {
  return (
    <div class="settings-screen">
      <div class="settings-list">
        <div class="settings-row">
          <span class="settings-row__label">Theme</span>
          <span class="settings-row__value">Dark</span>
        </div>
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
