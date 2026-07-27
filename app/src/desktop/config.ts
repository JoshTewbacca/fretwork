// Desktop endpoint configuration, persisted in the shared `kv` store.
//
// The desktop ingest service can be reached two ways: over the home LAN, or
// (from anywhere) over a Tailscale tailnet address exposed via Tailscale
// Serve, which is what makes it reachable as an https:// URL in the first
// place -- see client.ts for why that matters (mixed content).

import type { IDBPDatabase } from 'idb'
import type { FretworkDBSchema } from '../db/schema.ts'
import { getKv, putKv } from '../db/kv.ts'

const DESKTOP_CONFIG_KEY = 'desktopConfig'

export interface DesktopConfig {
  /** e.g. https://desktop-name.tailnet-name.ts.net -- reachable from anywhere. */
  tailscaleUrl: string
  /** e.g. http://192.168.1.50:8765 -- reachable only on the home LAN. */
  lanUrl: string
}

const EMPTY_CONFIG: DesktopConfig = { tailscaleUrl: '', lanUrl: '' }

/** Returns the persisted desktop config, or an empty one if nothing has been saved yet. */
export async function getDesktopConfig(
  db: IDBPDatabase<FretworkDBSchema>,
): Promise<DesktopConfig> {
  const stored = await getKv<DesktopConfig>(db, DESKTOP_CONFIG_KEY)
  return stored ?? { ...EMPTY_CONFIG }
}

export async function setDesktopConfig(
  db: IDBPDatabase<FretworkDBSchema>,
  config: DesktopConfig,
): Promise<void> {
  await putKv(db, DESKTOP_CONFIG_KEY, config)
}

/** Strips a trailing slash so callers can append `/path` without doubling it. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * URLs to try, in the order to try them: Tailscale first when set (it works
 * both at home and away), then LAN. Blank entries are skipped.
 */
export function candidateUrls(config: DesktopConfig): string[] {
  const candidates: string[] = []
  if (config.tailscaleUrl.trim()) candidates.push(normalizeUrl(config.tailscaleUrl))
  if (config.lanUrl.trim()) candidates.push(normalizeUrl(config.lanUrl))
  return candidates
}
