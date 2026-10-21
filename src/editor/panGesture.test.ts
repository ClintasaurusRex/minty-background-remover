import { describe, expect, it } from 'vitest'
import { type PanGesture, type PanGestureEvent, idlePanGesture, updatePanGesture } from './panGesture'

function run(events: PanGestureEvent[], start: PanGesture = idlePanGesture) {
  let gesture = start
  const effects: unknown[] = []
  for (const event of events) {
    const update = updatePanGesture(gesture, event)
    gesture = update.gesture
    if (update.effect) effects.push(update.effect)
  }
  return { gesture, effects }
}

const down = (pointerId = 1, button = 0, x = 100, y = 100): PanGestureEvent => ({
  type: 'pointer-down',
  pointerId,
  button,
  point: { x, y },
})
const move = (x: number, y: number, pointerId = 1): PanGestureEvent => ({ type: 'pointer-move', pointerId, point: { x, y } })

describe('updatePanGesture', () => {
  it('drags only while Space is held and with the primary button', () => {
    expect(run([down()]).effects).toEqual([])
    expect(run([{ type: 'space-down' }, down(1, 2)]).effects).toEqual([])
    expect(run([{ type: 'space-down' }, down(1, 1)]).effects).toEqual([])
    expect(run([{ type: 'space-down' }, down()]).effects).toEqual([{ type: 'drag-started' }])
  })

  it('reports the total movement since the drag started', () => {
    const { effects } = run([{ type: 'space-down' }, down(1, 0, 100, 100), move(110, 95), move(130.5, 80.25)])
    expect(effects).toEqual([
      { type: 'drag-started' },
      { type: 'dragged', delta: { x: 10, y: -5 } },
      { type: 'dragged', delta: { x: 30.5, y: -19.75 } },
    ])
  })

  it('ignores other pointers during a drag', () => {
    const { effects, gesture } = run([{ type: 'space-down' }, down(1), down(2), move(150, 150, 2), { type: 'pointer-up', pointerId: 2 }])
    expect(effects).toEqual([{ type: 'drag-started' }])
    expect(gesture.drag?.pointerId).toBe(1)
  })

  it('ends the drag when Space is released, even with the button still held', () => {
    const { effects, gesture } = run([
      { type: 'space-down' },
      down(),
      move(120, 100),
      { type: 'space-up' },
      move(200, 200),
      { type: 'pointer-up', pointerId: 1 },
    ])
    expect(effects).toEqual([{ type: 'drag-started' }, { type: 'dragged', delta: { x: 20, y: 0 } }, { type: 'drag-ended' }])
    expect(gesture).toBe(idlePanGesture)
  })

  it('does not restart a drag when Space is pressed again with the button still held', () => {
    const { effects } = run([{ type: 'space-down' }, down(), { type: 'space-up' }, { type: 'space-down' }, move(150, 150)])
    expect(effects).toEqual([{ type: 'drag-started' }, { type: 'drag-ended' }])
  })

  it('ends the drag when the pointer is cancelled', () => {
    const { effects, gesture } = run([{ type: 'space-down' }, down(), { type: 'pointer-cancel', pointerId: 1 }, move(150, 150)])
    expect(effects).toEqual([{ type: 'drag-started' }, { type: 'drag-ended' }])
    expect(gesture).toEqual({ spaceHeld: true, drag: null })
  })

  it('resets everything on blur or unmount', () => {
    const { effects, gesture } = run([{ type: 'space-down' }, down(), { type: 'reset' }, move(150, 150)])
    expect(effects).toEqual([{ type: 'drag-started' }, { type: 'drag-ended' }])
    expect(gesture).toBe(idlePanGesture)
    expect(run([{ type: 'space-down' }, { type: 'reset' }]).effects).toEqual([])
  })

  it('treats key repeat as a single press and keeps unchanged state identical', () => {
    const held = run([{ type: 'space-down' }]).gesture
    expect(updatePanGesture(held, { type: 'space-down' }).gesture).toBe(held)
    expect(updatePanGesture(idlePanGesture, { type: 'space-up' }).gesture).toBe(idlePanGesture)
  })
})
