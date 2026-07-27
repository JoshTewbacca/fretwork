import { render } from 'preact'
import './index.css'
import { AppShell } from './shell/AppShell'
import { initPwa } from './pwa/register'

void initPwa()

render(<AppShell />, document.getElementById('app')!)
