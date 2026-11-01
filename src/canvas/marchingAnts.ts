import { type BoundaryPattern, MARCHING_ANTS_PHASES, STATIC_BOUNDARY, marchingBoundary } from './selectionOverlay'

/*
 * When the selection boundary's marching ants move. The overlay renderer draws them; this module
 * only decides when the next phase is shown, without React and without the DOM (the clock and
 * the reduced-motion and visibility states are passed in), so its lifecycle can be tested.
 *
 * - Each step moves the dashes by one boundary line width (about one CSS pixel), at most every
 *   MARCHING_ANTS_STEP_MS. Steps are timers followed by one animation frame, so the page is woken
 *   a few times a second, not every frame, and nothing is drawn while the page is hidden.
 * - Steps are timed. When they get expensive (very complex boundaries, large high-DPI screens),
 *   they are spaced further apart, so the ants never take more than about
 *   MARCHING_ANTS_MAX_SHARE of the main thread; the motion slows down rather than the app.
 * - Nothing is scheduled with reduced motion (the boundary is static), while the page is hidden,
 *   when no boundary is in view (including when nothing is selected), or while the boundary in
 *   view is larger than MARCHING_ANTS_MAX_BOUNDARY_AREA.
 * - At most one step is ever pending, and disposing cancels it.
 */

/** Milliseconds between marching-ants steps when steps are cheap. A full cycle takes eight steps. */
export const MARCHING_ANTS_STEP_MS = 150

/** The largest share of time the steps may take: costlier steps are spaced further apart. */
export const MARCHING_ANTS_MAX_SHARE = 1 / 20

/**
 * The ants pause (the boundary stays as it is) while the boundary areas in view, which every step
 * repaints, cover more device pixels than this: more than a 4K screen, where even spaced-out
 * steps would each hold up the page noticeably.
 */
export const MARCHING_ANTS_MAX_BOUNDARY_AREA = 10_000_000

/** The delay before the next step, given the typical cost of a step (milliseconds). */
export function marchingAntsDelay(stepCost: number): number {
  return Math.max(MARCHING_ANTS_STEP_MS, stepCost / MARCHING_ANTS_MAX_SHARE)
}

/** What the animation drives: the overlay renderer. */
export interface MarchingAntsTarget {
  /** Shows the current frame with another boundary pattern. */
  setPattern(pattern: BoundaryPattern): void
  /** How many device pixels the boundary areas of the current frame cover (0 without boundary). */
  visibleBoundaryArea(): number
}

/** Timers and animation frames: the browser's in the app, a fake one in tests. */
export interface AnimationClock {
  now(): number
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(handle: number): void
  requestAnimationFrame(callback: () => void): number
  cancelAnimationFrame(handle: number): void
}

export interface MarchingAnts {
  /** The pattern to draw new frames with: static with reduced motion, else the current phase. */
  pattern(): BoundaryPattern
  /** Call after every frame the target draws: starts or stops stepping as needed. */
  update(): void
  setReducedMotion(reduced: boolean): void
  setHidden(hidden: boolean): void
  /** Whether a step is pending. */
  isRunning(): boolean
  /** Cancels any pending step; nothing is drawn afterwards. */
  dispose(): void
}

export function createMarchingAnts(
  target: MarchingAntsTarget,
  clock: AnimationClock,
  initial: { readonly reducedMotion: boolean; readonly hidden: boolean },
): MarchingAnts {
  let { reducedMotion, hidden } = initial
  let disposed = false
  let phase = 0
  // What a step costs (milliseconds, smoothed over recent steps) and the boundary area it was
  // measured with. Steps repaint the boundary areas in view, so after the area changes a lot (a new
  // selection, zoom or window size) the estimate is dropped and the next step measured afresh.
  let stepCost = 0
  let costArea = 0
  const similarArea = (area: number) => area <= 2 * costArea && 2 * area >= costArea
  let timer: number | null = null
  let frame: number | null = null

  const pattern = (): BoundaryPattern => (reducedMotion ? STATIC_BOUNDARY : marchingBoundary(phase))

  const wanted = () => {
    if (disposed || reducedMotion || hidden) return false
    const area = target.visibleBoundaryArea()
    return area > 0 && area <= MARCHING_ANTS_MAX_BOUNDARY_AREA
  }

  const stop = () => {
    if (timer !== null) clock.clearTimeout(timer)
    if (frame !== null) clock.cancelAnimationFrame(frame)
    timer = frame = null
  }

  const step = () => {
    frame = null
    if (!wanted()) return
    phase = (phase + 1) % MARCHING_ANTS_PHASES
    const area = target.visibleBoundaryArea()
    const start = clock.now()
    target.setPattern(marchingBoundary(phase))
    const cost = clock.now() - start
    stepCost = costArea > 0 && similarArea(area) ? (stepCost + cost) / 2 : cost
    costArea = area
    schedule()
  }

  const schedule = () => {
    if (timer !== null || frame !== null) return
    timer = clock.setTimeout(() => {
      timer = null
      frame = clock.requestAnimationFrame(step)
    }, marchingAntsDelay(costArea > 0 && similarArea(target.visibleBoundaryArea()) ? stepCost : 0))
  }

  const update = () => {
    if (wanted()) schedule()
    else stop()
  }

  return {
    pattern,
    update,

    setReducedMotion(reduced) {
      if (disposed || reduced === reducedMotion) return
      reducedMotion = reduced
      target.setPattern(pattern())
      update()
    },

    setHidden(nextHidden) {
      if (disposed || nextHidden === hidden) return
      hidden = nextHidden
      update()
    },

    isRunning() {
      return timer !== null || frame !== null
    },

    dispose() {
      stop()
      disposed = true
    },
  }
}
