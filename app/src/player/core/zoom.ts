// Zoom bounds for the score. Kept in their own module so the settings screen
// and the preferences store can share them without pulling in alphaTab.
//
// The defaults are far larger than alphaTab's own: with tab-only, single-track
// rendering there is room for it, and a fret number you can read at arm's
// length with a guitar in your hands is the whole point of the screen.

export const MIN_ZOOM_PCT = 60
export const MAX_ZOOM_PCT = 220
export const DEFAULT_ZOOM_PCT = 130

export function clampZoom(pct: number): number {
  return Math.min(MAX_ZOOM_PCT, Math.max(MIN_ZOOM_PCT, Math.round(pct)))
}
