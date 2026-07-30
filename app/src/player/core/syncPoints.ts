// Converting a SyncMap into alphaTab's own sync points.
//
// The alphaTab-facing half of syncMap.ts. One direction only: SyncMap is
// written into the score model and never read back (ADR-002).

import * as alphaTab from '@coderline/alphatab'
import type { SyncAnchor, SyncMap } from '../../core/types'
import { normaliseAnchors } from './syncMap'

/**
 * Replace the score's sync points with those in `syncMap`, returning how many
 * anchors survived normalisation.
 *
 * Existing points are cleared first, so this is idempotent: re-applying after an
 * edit cannot leave the previous generation's anchors behind to fight the new
 * ones over the same bars.
 *
 * The caller calls `api.updateSyncPoints()` afterwards - a caller making several
 * changes should push once, not once per change.
 */
export function applySyncMap(score: alphaTab.model.Score, syncMap: SyncMap): number {
  const anchors = normaliseAnchors(syncMap.points, score.masterBars.length)
  clearSyncPoints(score)

  for (const anchor of anchors) {
    const masterBar = score.masterBars[anchor.masterBarIndex]
    if (!masterBar) continue
    masterBar.addSyncPoint(buildSyncPoint(anchor))
  }

  return anchors.length
}

/** Clear every sync point, returning the score to a linear time mapping. */
export function clearSyncPoints(score: alphaTab.model.Score): void {
  for (const masterBar of score.masterBars) {
    masterBar.syncPoints = undefined
  }
}

/**
 * One anchor as an alphaTab Automation.
 *
 * The type is assigned explicitly rather than inferred: AutomationType.SyncPoint
 * and AutomationType.Bank share the numeric value 4 in this version (see
 * docs/03-alphatab-notes.md), so anything deriving the type from the number is
 * ambiguous.
 */
function buildSyncPoint(anchor: SyncAnchor): alphaTab.model.Automation {
  const automation = new alphaTab.model.Automation()
  automation.type = alphaTab.model.AutomationType.SyncPoint
  automation.ratioPosition = anchor.ratioPosition
  automation.syncPointValue = new alphaTab.model.SyncPointData()
  automation.syncPointValue.barOccurence = anchor.barOccurence
  automation.syncPointValue.millisecondOffset = anchor.audioMs
  return automation
}
