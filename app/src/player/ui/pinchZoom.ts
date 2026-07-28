// Pinch-to-zoom for the score.
//
// Zoom is also a stepper in the View sheet, but pinch is what everyone tries
// first on a phone, and it is the one control you reach for constantly while
// reading tab at arm's length.
//
// Changing the zoom makes alphaTab re-lay out the whole score, which is far
// too expensive to do on every touch frame. So the gesture is quantised to the
// same 10% steps the stepper uses: a normal pinch fires two or three re-renders
// instead of sixty, and the feedback still tracks your fingers closely enough
// to feel direct.

const STEP_PCT = 10

function distance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX
  const dy = touches[0].clientY - touches[1].clientY
  return Math.hypot(dx, dy)
}

export interface PinchZoomHandlers {
  getZoomPct: () => number
  setZoomPct: (pct: number) => void
}

/**
 * Attach pinch handling to a score container. Returns a teardown function.
 *
 * The listeners are registered manually rather than through JSX because
 * touchmove has to be non-passive to call preventDefault, which is what stops
 * the browser zooming the whole page out from under the gesture.
 */
export function attachPinchZoom(
  element: HTMLElement,
  { getZoomPct, setZoomPct }: PinchZoomHandlers,
): () => void {
  let startDistance = 0
  let startZoom = 0

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 2) return
    startDistance = distance(e.touches)
    startZoom = getZoomPct()
  }

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length !== 2 || startDistance <= 0) return
    e.preventDefault()
    const ratio = distance(e.touches) / startDistance
    const target = startZoom * ratio
    const stepped = Math.round(target / STEP_PCT) * STEP_PCT
    // setZoomPct clamps and ignores a value it already holds, so this is a
    // no-op until the pinch crosses into the next step.
    setZoomPct(stepped)
  }

  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) startDistance = 0
  }

  element.addEventListener('touchstart', onTouchStart, { passive: true })
  element.addEventListener('touchmove', onTouchMove, { passive: false })
  element.addEventListener('touchend', onTouchEnd, { passive: true })
  element.addEventListener('touchcancel', onTouchEnd, { passive: true })

  return () => {
    element.removeEventListener('touchstart', onTouchStart)
    element.removeEventListener('touchmove', onTouchMove)
    element.removeEventListener('touchend', onTouchEnd)
    element.removeEventListener('touchcancel', onTouchEnd)
  }
}
