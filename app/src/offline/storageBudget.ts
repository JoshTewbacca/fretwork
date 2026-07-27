// Storage budget tracking (docs/adr/ADR-003-offline-state-machine.md).
//
// The library must warn before it hits the quota rather than failing a write
// mid-import. Tab files and practice data are tiny and exempt in spirit; audio
// bundles are what consume the budget.

import { getStorageEstimate } from '../pwa/persistence'

export type BudgetLevel = 'ok' | 'warning' | 'critical'

export interface StorageBudget {
  usageBytes: number
  quotaBytes: number
  usedFraction: number
  level: BudgetLevel
  /** True when new downloads should be refused until space is freed. */
  blockNewDownloads: boolean
  message: string | null
}

export const WARN_AT = 0.8
export const CRITICAL_AT = 0.95

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export function evaluateBudget(usageBytes: number, quotaBytes: number): StorageBudget {
  const usedFraction = quotaBytes > 0 ? usageBytes / quotaBytes : 0
  let level: BudgetLevel = 'ok'
  let message: string | null = null

  if (usedFraction >= CRITICAL_AT) {
    level = 'critical'
    message = `Storage is nearly full (${formatBytes(usageBytes)} of ${formatBytes(quotaBytes)}). Remove a song or its audio before adding more.`
  } else if (usedFraction >= WARN_AT) {
    level = 'warning'
    message = `Storage is ${Math.round(usedFraction * 100)} percent full (${formatBytes(usageBytes)} of ${formatBytes(quotaBytes)}).`
  }

  return {
    usageBytes,
    quotaBytes,
    usedFraction,
    level,
    blockNewDownloads: level === 'critical',
    message,
  }
}

export async function readStorageBudget(): Promise<StorageBudget | null> {
  const estimate = await getStorageEstimate()
  if (!estimate) return null
  return evaluateBudget(estimate.usageBytes, estimate.quotaBytes)
}
