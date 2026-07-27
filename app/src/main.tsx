import { render } from 'preact'
import './index.css'
import { AppShell } from './shell/AppShell'
import { initPwa } from './pwa/register'
import { offlineStore } from './offline/offlineStore'

void initPwa()
// Detect content the browser evicted while the app was closed, so the library
// explains itself instead of appearing empty (ADR-003).
void offlineStore.runStartupChecks()

render(<AppShell />, document.getElementById('app')!)
