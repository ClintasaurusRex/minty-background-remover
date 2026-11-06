import { describe, expect, it } from 'vitest'
import type { DisplayImage } from '../canvas/displayImage'
import { editActionCommand } from '../editor/editCommands'
import { type EditorAction, type EditorState, documentVersion, editorReducer, initialEditorState } from '../editor/editorState'
import { WORKSPACE, mask, opened, reduce } from '../editor/history/testFixtures'
import { createPixelBuffer } from '../image/pixelBuffer'
import { type EditDispatch, actionImage, dispatchEditAction } from './editDispatch'

/*
 * dispatchEditAction with a stand-in for React: a store whose dispatch queues actions and whose
 * flush runs the reducer and "commits" (as flushSync does), recording the order of events.
 * Real React (Strict Mode, rebasing) is checked in browsers: scripts/browser/edit-ownership.mjs.
 */

/** A display image that loses its size when released, as bitmaps and canvases do. */
interface TestImage {
  width: number
  height: number
  releases: number
}
function testImages() {
  const created: TestImage[] = []
  const create = (pixels: { width: number; height: number }): DisplayImage => {
    const image: TestImage = { width: pixels.width, height: pixels.height, releases: 0 }
    created.push(image)
    return image as unknown as DisplayImage
  }
  const release = (image: DisplayImage) => {
    const test = image as unknown as TestImage
    test.releases++
    test.width = 0
    test.height = 0
  }
  return { created, create, release }
}

function fakeReact(initial: EditorState, { strict = false, commitThrows = false } = {}) {
  let committed = initial
  const queue: EditorAction[] = []
  const events: string[] = []
  const deps = (release: (image: DisplayImage) => void): EditDispatch => ({
    dispatch: (action) => {
      queue.push(action)
      events.push(`dispatch ${action.type}`)
    },
    flush: (update) => {
      events.push('flush start')
      update()
      let state = committed
      for (const action of queue.splice(0)) {
        const first = editorReducer(state, action)
        // Strict Mode runs the reducer twice on the same state and keeps one of the results.
        state = strict ? editorReducer(state, action) : first
      }
      if (commitThrows) {
        committed = state
        events.push('flush threw')
        throw new Error('Render failed (test)')
      }
      committed = state
      events.push('flush end')
    },
    committedState: () => committed,
    release: (image) => {
      events.push('release')
      release(image)
    },
  })
  return { deps, events, committed: () => committed }
}

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })
function selected(): EditorState {
  const data = new Uint8ClampedArray(4 * 3 * 4).fill(200)
  const state = opened(createPixelBuffer(4, 3, data), measured)
  return reduce(state, { type: 'selection-applied', version: documentVersion(state)!, selection: mask('##..', '#...', '....') })
}

describe('dispatchEditAction', () => {
  it('commits an accepted action before returning and keeps its image', () => {
    const images = testImages()
    const react = fakeReact(selected())
    const action = editActionCommand(react.committed(), 'delete-selection', images.create)!
    dispatchEditAction(action, react.deps(images.release))
    expect(react.committed().documentBitmap).toBe(actionImage(action))
    expect(images.created).toHaveLength(1)
    expect(images.created[0].releases).toBe(0)
    expect(react.events).toEqual(['flush start', 'dispatch edit-applied', 'flush end'])
  })

  it('releases a rejected action\'s image once, only after the action was committed', () => {
    const images = testImages()
    const react = fakeReact(selected())
    const first = editActionCommand(react.committed(), 'delete-selection', images.create)!
    const stale = editActionCommand(react.committed(), 'delete-selection', images.create)!
    dispatchEditAction(first, react.deps(images.release))
    react.events.length = 0
    dispatchEditAction(stale, react.deps(images.release))
    expect(react.events).toEqual(['flush start', 'dispatch edit-applied', 'flush end', 'release'])
    expect(images.created[1].releases).toBe(1)
    expect(images.created[0].releases).toBe(0)
    expect(react.committed().documentBitmap).toBe(actionImage(first))
  })

  it('releases nothing for actions without an image', () => {
    const images = testImages()
    const state = selected()
    const react = fakeReact(state)
    const actions: EditorAction[] = [
      { type: 'edit-failed', error: { operation: 'delete-selection' } },
      { type: 'edit-unchanged', version: documentVersion(state)!, operation: 'delete-selection' },
      { type: 'selection-cleared' },
    ]
    for (const action of actions) {
      expect(actionImage(action)).toBeNull()
      dispatchEditAction(action, react.deps(images.release))
    }
    expect(react.events).not.toContain('release')
  })

  it('when committing throws: passes the error on, releasing the image only if the committed state does not hold it', () => {
    const images = testImages()
    // Throws after committing the accepted action: the image is in use and kept.
    const kept = fakeReact(selected(), { commitThrows: true })
    const accepted = editActionCommand(kept.committed(), 'delete-selection', images.create)!
    expect(() => dispatchEditAction(accepted, kept.deps(images.release))).toThrow('Render failed (test)')
    expect(images.created[0].releases).toBe(0)
    // Throws before anything is committed: released.
    const state = selected()
    const failing: EditDispatch = {
      dispatch: () => {},
      flush: () => {
        throw new Error('Render failed (test)')
      },
      committedState: () => state,
      release: images.release,
    }
    const lost = editActionCommand(state, 'delete-selection', images.create)!
    expect(() => dispatchEditAction(lost, failing)).toThrow('Render failed (test)')
    expect(images.created[1].releases).toBe(1)
  })

  it('React Strict Mode: the reducer run twice keeps the same image, which is not released', () => {
    const images = testImages()
    const react = fakeReact(selected(), { strict: true })
    const action = editActionCommand(react.committed(), 'delete-selection', images.create)!
    dispatchEditAction(action, react.deps(images.release))
    expect(react.committed().documentBitmap).toBe(actionImage(action))
    expect(images.created[0].releases).toBe(0)
  })

  it('a released action is rejected by every later state, and by the state it was computed from', () => {
    const images = testImages()
    const start = selected()
    const react = fakeReact(start)
    const first = editActionCommand(start, 'delete-selection', images.create)!
    const stale = editActionCommand(start, 'delete-selection', images.create)!
    dispatchEditAction(first, react.deps(images.release))
    dispatchEditAction(stale, react.deps(images.release))
    expect(images.created[1].releases).toBe(1)
    // React processing it again on another base, even the one it was computed from: still rejected.
    const undone = editorReducer(react.committed(), editActionCommand(react.committed(), 'undo', images.create)!)
    for (const state of [start, react.committed(), undone]) expect(editorReducer(state, stale)).toBe(state)
  })

  it('Undo and Redo with the real reducer: stale ones released, the current image never', () => {
    const images = testImages()
    const react = fakeReact(selected())
    const deps = react.deps(images.release)
    dispatchEditAction(editActionCommand(react.committed(), 'delete-selection', images.create)!, deps)
    const undoA = editActionCommand(react.committed(), 'undo', images.create)!
    const undoB = editActionCommand(react.committed(), 'undo', images.create)!
    dispatchEditAction(undoA, deps)
    dispatchEditAction(undoB, deps)
    const redoA = editActionCommand(react.committed(), 'redo', images.create)!
    const redoB = editActionCommand(react.committed(), 'redo', images.create)!
    dispatchEditAction(redoA, deps)
    dispatchEditAction(redoB, deps)
    const current = react.committed().documentBitmap as unknown as TestImage
    expect(current).toBe(actionImage(redoA))
    expect(current.releases).toBe(0)
    expect(images.created.filter((image) => image.releases === 1)).toEqual([actionImage(undoB), actionImage(redoB)])
    // The canvas, not the dispatcher, releases replaced images: the first two stay until it does.
    expect(images.created.filter((image) => image.releases === 0)).toHaveLength(3)
  })
})
