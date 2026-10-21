import { describe, expect, it } from 'vitest'
import { type DropTargetEvent, isDropTargetActive, updateDropTarget } from './dropTarget'

function run(events: DropTargetEvent[]) {
  const states: boolean[] = []
  let depth = 0
  for (const event of events) {
    depth = updateDropTarget(depth, event)
    states.push(isDropTargetActive(depth))
  }
  return { depth, states }
}

const enter: DropTargetEvent = { type: 'enter' }
const leaveInside: DropTargetEvent = { type: 'leave', stillInside: true }
const leaveOutside: DropTargetEvent = { type: 'leave', stillInside: false }

describe('updateDropTarget', () => {
  it('stays active while the drag crosses child elements', () => {
    // Workspace → canvas → empty state → canvas: browsers fire enter for the new
    // element before leave for the old one.
    const { states } = run([enter, enter, leaveInside, enter, leaveInside, enter, leaveInside])
    expect(states.every(Boolean)).toBe(true)
  })

  it('clears when the drag leaves the workspace', () => {
    expect(run([enter, enter, leaveInside, leaveOutside]).states.at(-1)).toBe(false)
  })

  it('clears at once when a drag is cancelled from inside a child element', () => {
    // Escape fires a single leave with no next element, even when nested.
    expect(run([enter, enter, enter, leaveOutside])).toEqual({ depth: 0, states: [true, true, true, false] })
  })

  it('clears on drop and reset', () => {
    expect(run([enter, enter, { type: 'drop' }]).depth).toBe(0)
    expect(run([enter, { type: 'reset' }]).depth).toBe(0)
  })

  it('re-arms on dragover if a leave was reported too early', () => {
    expect(run([enter, leaveOutside, { type: 'over' }]).states).toEqual([true, false, true])
    expect(run([enter, enter, { type: 'over' }]).depth).toBe(2)
  })

  it('never goes below zero', () => {
    expect(run([leaveInside, leaveOutside, leaveInside]).depth).toBe(0)
  })
})
