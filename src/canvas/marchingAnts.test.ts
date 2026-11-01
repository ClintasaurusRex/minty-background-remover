import { describe, expect, it } from 'vitest'
import {
  type AnimationClock,
  MARCHING_ANTS_MAX_BOUNDARY_AREA,
  MARCHING_ANTS_MAX_SHARE,
  MARCHING_ANTS_STEP_MS,
  type MarchingAntsTarget,
  createMarchingAnts,
  marchingAntsDelay,
} from './marchingAnts'
import { type BoundaryPattern, MARCHING_ANTS_PHASES, STATIC_BOUNDARY, marchingBoundary } from './selectionOverlay'

/**
 * A clock whose time only moves with advance(): timers fire in order, and each fired timer's
 * animation frames run right after it, as a browser would at its next frame.
 */
function fakeClock() {
  let time = 1000
  let nextHandle = 1
  const timers = new Map<number, { due: number; callback: () => void }>()
  const frames = new Map<number, () => void>()
  const clock: AnimationClock = {
    now: () => time,
    setTimeout(callback, delay) {
      timers.set(nextHandle, { due: time + delay, callback })
      return nextHandle++
    },
    clearTimeout(handle) {
      timers.delete(handle)
    },
    requestAnimationFrame(callback) {
      frames.set(nextHandle, callback)
      return nextHandle++
    },
    cancelAnimationFrame(handle) {
      frames.delete(handle)
    },
  }
  const runFrames = () => {
    const pending = [...frames]
    frames.clear()
    for (const [, callback] of pending) callback()
  }
  return {
    clock,
    /** Pending timers and frames. */
    pending: () => timers.size + frames.size,
    timers: () => [...timers.values()],
    frames: () => frames.size,
    /** Moves time forward, firing due timers (and the frames they request) in order. */
    advance(ms: number) {
      const end = time + ms
      for (;;) {
        let next: [number, { due: number; callback: () => void }] | null = null
        for (const entry of timers) if (entry[1].due <= end && (!next || entry[1].due < next[1].due)) next = entry
        if (!next) break
        time = Math.max(time, next[1].due)
        timers.delete(next[0])
        next[1].callback()
        runFrames()
      }
      time = Math.max(time, end)
    },
    /** Fires the earliest timer now, without running the frames it requests. */
    fireNextTimer() {
      const [handle, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0]
      timers.delete(handle)
      timer.callback()
    },
    /** Spends time inside a call, as an expensive step would. */
    spend(ms: number) {
      time += ms
    },
    runFrames,
  }
}

/** A renderer stand-in: records the patterns shown and reports a boundary area. */
function fakeTarget(area = 50_000, onSet?: () => void) {
  const shown: BoundaryPattern[] = []
  const target: MarchingAntsTarget & { area: number } = {
    area,
    setPattern(pattern) {
      shown.push(pattern)
      onSet?.()
    },
    visibleBoundaryArea() {
      return this.area
    },
  }
  return { target, shown }
}

const visible = { reducedMotion: false, hidden: false }

describe('marchingAntsDelay', () => {
  it('steps every MARCHING_ANTS_STEP_MS while steps are cheap, and keeps their share of time bounded', () => {
    expect(MARCHING_ANTS_STEP_MS).toBe(150)
    expect(marchingAntsDelay(0)).toBe(MARCHING_ANTS_STEP_MS)
    expect(marchingAntsDelay(4)).toBe(MARCHING_ANTS_STEP_MS)
    expect(marchingAntsDelay(15)).toBe(300)
    for (const cost of [6, 10, 25, 80]) expect(cost / marchingAntsDelay(cost)).toBeLessThanOrEqual(MARCHING_ANTS_MAX_SHARE + 1e-12)
  })
})

describe('createMarchingAnts', () => {
  it('advances one phase per step while a boundary is in view, wrapping around', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, visible)
    expect(ants.pattern()).toBe(marchingBoundary(0))
    ants.update()
    expect(ants.isRunning()).toBe(true)
    time.advance(MARCHING_ANTS_STEP_MS * 10 + 1)
    expect(shown).toEqual(Array.from({ length: 10 }, (_, i) => marchingBoundary((i + 1) % MARCHING_ANTS_PHASES)))
    expect(ants.pattern()).toBe(marchingBoundary(10 % MARCHING_ANTS_PHASES))
  })

  it('draws steps in an animation frame after the timer', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    createMarchingAnts(target, time.clock, visible).update()
    expect(time.timers()).toHaveLength(1)
    expect(time.frames()).toBe(0)
    // Fire the timer without running frames: nothing is drawn until the frame.
    time.fireNextTimer()
    expect(shown).toHaveLength(0)
    expect(time.frames()).toBe(1)
    time.runFrames()
    expect(shown).toEqual([marchingBoundary(1)])
  })

  it('does not animate without a selection or with no boundary in view', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget(0)
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    expect(ants.isRunning()).toBe(false)
    expect(time.pending()).toBe(0)
    time.advance(5000)
    expect(shown).toHaveLength(0)
  })

  it('stops when the selection goes away and starts again when it comes back', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    time.advance(MARCHING_ANTS_STEP_MS * 3 + 1)
    expect(shown).toHaveLength(3)
    // Cleared, or a new image replaced the document: the renderer reports no boundary.
    target.area = 0
    ants.update()
    expect(ants.isRunning()).toBe(false)
    expect(time.pending()).toBe(0)
    time.advance(5000)
    expect(shown).toHaveLength(3)
    target.area = 1000
    ants.update()
    time.advance(MARCHING_ANTS_STEP_MS + 1)
    expect(shown).toEqual([1, 2, 3, 4].map((phase) => marchingBoundary(phase)))
  })

  it('draws nothing when the boundary disappears between the timer and the frame', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    createMarchingAnts(target, time.clock, visible).update()
    time.fireNextTimer()
    target.area = 0
    time.runFrames()
    expect(shown).toHaveLength(0)
    expect(time.pending()).toBe(0)
  })

  it('keeps a single step pending however often frames are drawn', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, visible)
    for (let i = 0; i < 100; i++) {
      // Zooming, panning and selection changes each draw a frame and call update().
      ants.update()
      expect(time.pending()).toBe(1)
      time.advance(10)
    }
    // 1000 ms of updates: steps kept their cadence.
    expect(shown).toHaveLength(Math.floor(1000 / MARCHING_ANTS_STEP_MS))
  })

  it('stays static with reduced motion, and switches live when the preference changes', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, { reducedMotion: true, hidden: false })
    expect(ants.pattern()).toBe(STATIC_BOUNDARY)
    ants.update()
    expect(ants.isRunning()).toBe(false)
    time.advance(5000)
    expect(shown).toHaveLength(0)

    ants.setReducedMotion(false)
    expect(shown).toEqual([marchingBoundary(0)])
    expect(ants.isRunning()).toBe(true)
    time.advance(MARCHING_ANTS_STEP_MS * 2 + 1)
    expect(shown.slice(1)).toEqual([marchingBoundary(1), marchingBoundary(2)])

    ants.setReducedMotion(true)
    expect(shown.at(-1)).toBe(STATIC_BOUNDARY)
    expect(ants.pattern()).toBe(STATIC_BOUNDARY)
    expect(ants.isRunning()).toBe(false)
    expect(time.pending()).toBe(0)
    const count = shown.length
    time.advance(5000)
    expect(shown).toHaveLength(count)
    // Repeating the same preference changes nothing.
    ants.setReducedMotion(true)
    expect(shown).toHaveLength(count)
  })

  it('pauses while the page is hidden and continues from the same phase', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    time.advance(MARCHING_ANTS_STEP_MS * 2 + 1)
    ants.setHidden(true)
    expect(ants.isRunning()).toBe(false)
    expect(time.pending()).toBe(0)
    time.advance(60_000)
    // Frames drawn while hidden (a resize, say) do not start it either.
    ants.update()
    expect(time.pending()).toBe(0)
    expect(shown).toHaveLength(2)
    ants.setHidden(false)
    expect(ants.isRunning()).toBe(true)
    time.advance(MARCHING_ANTS_STEP_MS + 1)
    expect(shown).toEqual([1, 2, 3].map((phase) => marchingBoundary(phase)))
  })

  it('cancels a pending frame when hidden between the timer and the frame', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    time.fireNextTimer()
    expect(time.frames()).toBe(1)
    ants.setHidden(true)
    expect(time.frames()).toBe(0)
    time.runFrames()
    expect(shown).toHaveLength(0)
  })

  it('does not start hidden', () => {
    const time = fakeClock()
    const { target } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, { reducedMotion: false, hidden: true })
    ants.update()
    expect(time.pending()).toBe(0)
  })

  it('spaces costly steps further apart, and speeds up again when they get cheaper', () => {
    const time = fakeClock()
    let cost = 20
    const { target, shown } = fakeTarget(50_000, () => time.spend(cost))
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    time.advance(MARCHING_ANTS_STEP_MS + 1)
    expect(shown).toHaveLength(1)
    // The next step waits until the 20 ms step is under the time share.
    expect(time.timers()[0].due - time.clock.now()).toBe(20 / MARCHING_ANTS_MAX_SHARE)
    const before = shown.length
    time.advance(6000)
    const costly = shown.length - before
    expect(costly).toBeLessThanOrEqual(Math.ceil(6000 / (20 / MARCHING_ANTS_MAX_SHARE)))
    cost = 1
    time.advance(6000)
    expect(time.timers()[0].due - time.clock.now()).toBeLessThanOrEqual(MARCHING_ANTS_STEP_MS)
  })

  it('measures afresh at the normal pace after the boundary in view changes a lot', () => {
    const time = fakeClock()
    let cost = 30
    const { target } = fakeTarget(400_000, () => time.spend(cost))
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    time.advance(MARCHING_ANTS_STEP_MS + 1)
    expect(time.timers()[0].due - time.clock.now()).toBe(30 / MARCHING_ANTS_MAX_SHARE)
    // A new, much simpler selection: its steps are not held back by the old estimate.
    cost = 1
    target.area = 5_000
    ants.update()
    time.advance(30 / MARCHING_ANTS_MAX_SHARE)
    expect(time.timers()[0].due - time.clock.now()).toBe(MARCHING_ANTS_STEP_MS)
  })

  it('pauses while the boundary in view is too large to repaint, and resumes when it shrinks', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget(MARCHING_ANTS_MAX_BOUNDARY_AREA + 1)
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    expect(ants.isRunning()).toBe(false)
    time.advance(5000)
    expect(shown).toHaveLength(0)
    target.area = MARCHING_ANTS_MAX_BOUNDARY_AREA
    ants.update()
    time.advance(MARCHING_ANTS_STEP_MS + 1)
    expect(shown).toEqual([marchingBoundary(1)])
  })

  it('cancels everything when disposed and ignores later calls', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    time.advance(MARCHING_ANTS_STEP_MS + 1)
    ants.dispose()
    expect(ants.isRunning()).toBe(false)
    expect(time.pending()).toBe(0)
    ants.update()
    ants.setHidden(true)
    ants.setHidden(false)
    ants.setReducedMotion(true)
    time.advance(5000)
    expect(shown).toEqual([marchingBoundary(1)])
  })

  it('disposed between the timer and its frame, draws nothing', () => {
    const time = fakeClock()
    const { target, shown } = fakeTarget()
    const ants = createMarchingAnts(target, time.clock, visible)
    ants.update()
    time.fireNextTimer()
    ants.dispose()
    time.runFrames()
    expect(shown).toHaveLength(0)
  })

  it('leaves no loop behind when mounted twice (React Strict Mode)', () => {
    const time = fakeClock()
    const first = fakeTarget()
    const second = fakeTarget()
    const a = createMarchingAnts(first.target, time.clock, visible)
    a.update()
    a.dispose()
    const b = createMarchingAnts(second.target, time.clock, visible)
    b.update()
    time.advance(MARCHING_ANTS_STEP_MS * 4 + 1)
    expect(first.shown).toHaveLength(0)
    expect(second.shown).toHaveLength(4)
    expect(time.pending()).toBe(1)
  })
})
