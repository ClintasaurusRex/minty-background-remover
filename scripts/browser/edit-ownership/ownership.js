// In the browser: who releases the display images of edit actions dispatched through
// dispatchEditAction (src/app/editDispatch.ts) with React's real flushSync, the real editor reducer
// and the real ImageCanvas. Here actions can be made stale on purpose, and lower-priority updates
// left pending, which the app itself never does: React then processes the edit again later
// ("rebases" it), and the release decision taken after flushSync must still be right.
import { StrictMode, createElement as h, startTransition, useCallback, useLayoutEffect, useReducer, useRef } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { dispatchEditAction } from '/src/app/editDispatch.ts'
import { createDisplayImage, isReleasedDisplayImage, releaseDisplayImage } from '/src/canvas/displayImage.ts'
import { ImageCanvas } from '/src/components/Workspace/ImageCanvas.tsx'
import { editActionCommand } from '/src/editor/editCommands.ts'
import { displayViewport, editorReducer, initialEditorState } from '/src/editor/editorState.ts'
import { createImageDocument } from '/src/editor/imageDocument.ts'
import { createPixelBuffer } from '/src/image/pixelBuffer.ts'
import { createSelectionMask } from '/src/image/selection/selectionMask.ts'

const strict = new URLSearchParams(location.search).has('strict')
let api = null

function Harness() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  const stateRef = useRef(state)
  const canvasRef = useRef(null)
  useLayoutEffect(() => {
    stateRef.current = state
    api ??= { state: () => stateRef.current, dispatch }
  })
  const onResize = useCallback((workspace) => dispatch({ type: 'workspace-resized', workspace }), [])
  return h(ImageCanvas, {
    canvasRef,
    document: state.document,
    image: state.documentBitmap,
    viewport: displayViewport(state),
    workspace: state.workspace,
    onResize,
  })
}

// Console errors and warnings, where React reports misuse (of flushSync, for example).
const consoleMessages = []
for (const level of ['error', 'warn']) {
  const original = console[level]
  console[level] = (...args) => {
    consoleMessages.push(`${level}: ${args.map(String).join(' ').slice(0, 300)}`)
    original.apply(console, args)
  }
}

// Image draws onto the workspace canvas.
let draws = 0
const drawImage = CanvasRenderingContext2D.prototype.drawImage
CanvasRenderingContext2D.prototype.drawImage = function (...args) {
  if (this.canvas.classList?.contains('workspace__canvas')) draws++
  return drawImage.apply(this, args)
}

const created = []
const createImage = (pixels) => {
  const image = createDisplayImage(pixels)
  created.push(image)
  return image
}
const released = []
const deps = () => ({
  dispatch: api.dispatch,
  flush: flushSync,
  committedState: api.state,
  release: (image) => {
    released.push(image)
    releaseDisplayImage(image)
  },
})
const live = (image) => !isReleasedDisplayImage(image)
const later = (run) =>
  new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(run())
      } catch (error) {
        reject(error)
      }
    }, 0),
  )
const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 20))))

function pixels(width, height, colour) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(colour(i / 4 % width, Math.floor(i / 4 / width)), i)
  return createPixelBuffer(width, height, data)
}

/** What the canvas shows at image pixel (x, y): [r, g, b, a]. */
function shown(x, y) {
  const canvas = document.querySelector('canvas.workspace__canvas')
  const viewport = displayViewport(api.state())
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d', { willReadFrequently: true })
  context.drawImage(canvas, 0, 0)
  const X = Math.floor((viewport.offset.x + (x + 0.5) * viewport.zoom) * devicePixelRatio)
  const Y = Math.floor((viewport.offset.y + (y + 0.5) * viewport.zoom) * devicePixelRatio)
  return [...context.getImageData(X, Y, 1, 1).data]
}
const isCheckerboard = ([r, g, b, a]) => a === 255 && r === g && g === b && (r === 0x2c || r === 0x3a)

async function run() {
  const results = { strict }
  await frames()
  const W = 64
  const H = 48
  const colour = (x, y) => [(x * 4) & 255, (y * 5) & 255, 200, 255]
  const document1 = createImageDocument({ name: 'a.png', format: 'png', source: 'file-picker', fileSizeBytes: 1, pixels: pixels(W, H, colour) })
  const importBitmap = createDisplayImage(document1.pixels)
  flushSync(() => {
    api.dispatch({ type: 'import-started', importId: 1 })
    api.dispatch({ type: 'import-finished', importId: 1, result: { ok: true, document: document1, bitmap: importBitmap } })
  })
  const left = new Uint8Array(W * H)
  for (let i = 0; i < left.length; i++) left[i] = i % W < W / 2 ? 1 : 0
  const version = () => ({ documentId: api.state().document.id, revision: api.state().document.revision })
  flushSync(() => api.dispatch({ type: 'selection-applied', version: version(), selection: createSelectionMask(W, H, left) }))
  await frames()

  // 1. An accepted Delete: committed, drawn and recorded before dispatchEditAction returns.
  {
    const drawsBefore = draws
    const action = editActionCommand(api.state(), 'delete-selection', createImage)
    dispatchEditAction(action, deps())
    results.accepted = {
      type: action.type,
      held: api.state().documentBitmap === action.image,
      drawnSynchronously: draws > drawsBefore,
      replacedReleased: !live(importBitmap),
      notReleasedByDispatch: !released.includes(action.image),
      deletedShowsCheckerboard: isCheckerboard(shown(5, 5)),
      keptShowsImage: shown(50, 5).slice(0, 3).join() === colour(50, 5).slice(0, 3).join(),
    }
  }

  // 2. Two Undos computed from the same state: the second is stale, rejected, released at once.
  {
    const first = editActionCommand(api.state(), 'undo', createImage)
    const second = editActionCommand(api.state(), 'undo', createImage)
    dispatchEditAction(first, deps())
    dispatchEditAction(second, deps())
    results.stale = {
      firstHeld: api.state().documentBitmap === first.image && live(first.image),
      secondReleased: !live(second.image) && released.includes(second.image),
      canvasShowsUndone: shown(5, 5).slice(0, 3).join() === colour(5, 5).slice(0, 3).join(),
    }
    await frames()
    results.stale.stillHeldLater = api.state().documentBitmap === first.image && live(first.image)
  }

  // 3-5. An update queued at a lower priority just before the edit actions: a resize, then another
  // image arriving. React either processes it first, in order, in the flushSync pass, or skips it
  // there and processes the edit actions again on top of it later ("rebasing" them, as it does for
  // transitions). Either way: an image held right after flushSync is live; a released one is never
  // held later; the one finally held is live; every replaced one ends up released.
  const queueIn = {
    // A timer: default priority.
    default: (update, then) => later(() => { api.dispatch(update); return then() }),
    // Inside a pointermove event: continuous input priority.
    continuous: (update, then) =>
      new Promise((resolve) => {
        addEventListener('pointermove', () => { api.dispatch(update); resolve(then()) }, { once: true })
        dispatchEvent(new PointerEvent('pointermove'))
      }),
    // A transition: always skipped by a sync render, so the edit is processed again later.
    transition: (update, then) => later(() => { startTransition(() => api.dispatch(update)); return then() }),
  }
  let width = 640
  for (const [kind, queue] of Object.entries(queueIn)) {
    // Accepted, then a stale twin, with a resize queued before them.
    const before = api.state().workspace
    width = width === 640 ? 600 : 640
    const resize = { type: 'workspace-resized', workspace: { size: { width, height: 450 }, devicePixelRatio } }
    const actionName = api.state().history.redo.length ? 'redo' : 'undo'
    const pair = await queue(resize, () => {
      const pair = [editActionCommand(api.state(), actionName, createImage), editActionCommand(api.state(), actionName, createImage)]
      dispatchEditAction(pair[0], deps())
      dispatchEditAction(pair[1], deps())
      return pair
    })
    const syncPass = {
      firstHeld: api.state().documentBitmap === pair[0].image && live(pair[0].image),
      secondReleased: !live(pair[1].image),
      path: api.state().workspace === before ? 'resize skipped, processed again later' : 'resize processed first, in order',
    }
    await frames()
    results[`queued-${kind}`] = {
      ...syncPass,
      resizeApplied: api.state().workspace?.size.width === width,
      firstStillHeld: api.state().documentBitmap === pair[0].image && live(pair[0].image),
      secondNeverHeld: api.state().documentBitmap !== pair[1].image,
    }
  }

  // Another image arriving (queued) before a Delete: rejected at once (in order) or accepted, shown,
  // and rejected when processed again after the import (skipped first).
  for (const [kind, queue] of Object.entries(queueIn)) {
    if (!api.state().selection) {
      flushSync(() => api.dispatch({ type: 'selection-applied', version: version(), selection: createSelectionMask(api.state().document.width, api.state().document.height, new Uint8Array(api.state().document.width * api.state().document.height).fill(1)) }))
    }
    const importId = 10 + Object.keys(queueIn).indexOf(kind)
    const next = createImageDocument({ name: `${kind}.png`, format: 'png', source: 'paste', fileSizeBytes: 1, pixels: pixels(32, 32, () => [10, 220, 30, 255]) })
    const bitmap = createDisplayImage(next.pixels)
    const oldId = api.state().document.id
    let syncPass
    const edit = await queue({ type: 'import-started', importId }, () => {
      // The finished import is queued in the same lane, right after it started.
      if (kind === 'transition') startTransition(() => api.dispatch({ type: 'import-finished', importId, result: { ok: true, document: next, bitmap } }))
      else api.dispatch({ type: 'import-finished', importId, result: { ok: true, document: next, bitmap } })
      const action = editActionCommand(api.state(), 'delete-selection', createImage)
      dispatchEditAction(action, deps())
      const held = api.state().documentBitmap === action.image
      syncPass = { heldThenLive: !held || live(action.image), path: held && api.state().document.id === oldId ? 'import skipped: Delete shown first' : 'import processed first: Delete rejected at once' }
      return action
    })
    await frames()
    results[`import-${kind}`] = {
      ...syncPass,
      importHeld: api.state().document === next && api.state().documentBitmap === bitmap && live(bitmap),
      deleteReleased: !live(edit.image),
      releasedBy: released.includes(edit.image) ? 'dispatch' : 'canvas',
    }
  }

  const current = api.state().documentBitmap
  results.final = {
    created: created.length,
    releasedByDispatch: released.length,
    everyOtherReleased: [...created, importBitmap].filter((image) => image !== current).every((image) => !live(image)),
    currentLive: live(current),
  }
  results.consoleMessages = consoleMessages

  // Not done by the app (no editor action is ever dispatched at transition priority): a selection
  // change queued as a transition before a Delete and a stale Undo computed with the old
  // selection. The sync pass accepts the Delete (shown; the image before it released by the canvas)
  // and rejects the Undo (released by the dispatcher). Processed again after the selection change,
  // the Delete no longer fits, so the state returns to the image before it, already released, and
  // the canvas would be blank; the stale Undo stays rejected, its image having no size. Reported,
  // not checked: it shows where the ownership argument ends (editDispatch.ts).
  {
    // The state the two actions are computed from: the left half deleted (Undo available), then
    // everything selected.
    const { width: w, height: h } = api.state().document
    const half = new Uint8Array(w * h)
    for (let i = 0; i < half.length; i++) half[i] = i % w < w / 2 ? 1 : 0
    flushSync(() => api.dispatch({ type: 'selection-applied', version: version(), selection: createSelectionMask(w, h, half) }))
    dispatchEditAction(editActionCommand(api.state(), 'delete-selection', createImage), deps())
    flushSync(() => api.dispatch({ type: 'selection-applied', version: version(), selection: createSelectionMask(w, h, new Uint8Array(w * h).fill(1)) }))
    let pair
    await later(() => {
      startTransition(() => api.dispatch({ type: 'selection-applied', version: version(), selection: createSelectionMask(w, h, half) }))
      pair = [editActionCommand(api.state(), 'delete-selection', createImage), editActionCommand(api.state(), 'undo', createImage)]
      // Undo is unavailable once the Delete is accepted; computed before, it is the stale one.
      dispatchEditAction(pair[0], deps())
      dispatchEditAction(pair[1], deps())
    })
    const syncPass = { deleteHeld: api.state().documentBitmap === pair[0].image, undoReleased: !live(pair[1].image) }
    await frames()
    const held = api.state().documentBitmap
    results.transitionHazard = {
      ...syncPass,
      releasedImageHeldLater: held === pair[1].image && !live(pair[1].image),
      finallyHeld: held === pair[0].image ? 'the Delete' : held === pair[1].image ? 'the stale Undo' : 'another image',
      heldLive: live(held),
      selectionAfter: api.state().selection?.count ?? 0,
      transitionSelection: w * h / 2,
      undoStack: api.state().history.undo.length,
      pairTypes: pair.map((a) => a.type),
    }
  }
  return results
}

createRoot(document.getElementById('root')).render(strict ? h(StrictMode, null, h(Harness)) : h(Harness))
const waitForApi = () => (api ? Promise.resolve() : new Promise((resolve) => setTimeout(() => resolve(waitForApi()), 10)))
await waitForApi()
window.__ownership = { run }
window.__ready = true
