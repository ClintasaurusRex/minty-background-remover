import { describe, expect, it } from 'vitest'
import { imageToViewport } from '../canvas/coordinates'
import { planFrame } from '../canvas/rendering'
import { boundaryLineWidth, rasteriseSelectionOverlay, selectionStates } from '../canvas/selectionOverlay'
import { createSelectionMask } from '../image/selection/selectionMask'
import { imageFromRows, maskRows } from '../image/selection/testFixtures'
import {
  type EditorAction,
  type EditorState,
  type WorkspaceMetrics,
  displayViewport,
  documentVersion,
  editorReducer,
  initialEditorState,
} from './editorState'
import { describeSelection, formatSelection } from './documentInfo'
import { createImageDocument } from './imageDocument'
import {
  type PointerPress,
  type ShortcutKey,
  clearSelectionCommand,
  availableSelectionActions,
  clickSelectionMode,
  commitToleranceCommand,
  magicWandClick,
  reapplyMagicWandCommand,
  selectAllCommand,
  selectionActionCommand,
  selectionShortcut,
} from './selectionCommands'
import type { SelectionAction } from './selectionCommands'
import type { PixelCoordinate, Point, SelectionMask, SelectionMode } from './types'

const WORKSPACE: WorkspaceMetrics = { size: { width: 1000, height: 600 }, devicePixelRatio: 1 }

function reduce(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state)
}

let nextImportId = 1

/** Opens `pixels` as a new image, the way a successful import does. */
function open(pixels: ImageData, state: EditorState = reduce(initialEditorState, resized(WORKSPACE))): EditorState {
  const document = createImageDocument({ name: 'test.png', format: 'png', source: 'file-picker', fileSizeBytes: 1, pixels })
  const importId = nextImportId++
  const bitmap = { width: pixels.width, height: pixels.height, close: () => {} }
  return reduce(
    state,
    { type: 'import-started', importId },
    { type: 'import-finished', importId, result: { ok: true, document, bitmap } },
  )
}

function resized(workspace: WorkspaceMetrics): EditorAction {
  return { type: 'workspace-resized', workspace }
}

/** A distinct colour for every pixel, so a tolerance-0 click selects exactly the clicked pixel. */
function uniqueImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([i % 256, Math.floor(i / 256), 7, 255], i * 4)
  return { colorSpace: 'srgb', width, height, data }
}

const PALETTE = {
  w: [255, 255, 255, 255],
  k: [0, 0, 0, 255],
  r: [220, 30, 30, 255],
} as const

/**
 * Two white areas separated by a black wall, and a red block:
 *
 *   w w k w w
 *   w w k w w
 *   r r k w w
 */
const WALLED = () => imageFromRows(PALETTE, 'wwkww', 'wwkww', 'rrkww')

/** The viewport (canvas CSS px) point at the centre of image pixel (x, y). */
function centreOf(state: EditorState, x: number, y: number): Point {
  return imageToViewport(displayViewport(state)!, { x: x + 0.5, y: y + 0.5 })
}

/** Applies a Magic Wand click at the centre of pixel (x, y), as a mouse click would. */
function click(state: EditorState, x: number, y: number, mode: SelectionMode = 'new'): EditorState {
  const action = magicWandClick(state, centreOf(state, x, y), mode)
  if (!action) throw new Error(`Click at (${x}, ${y}) did nothing`)
  return editorReducer(state, action)
}

function selectedPixel(state: EditorState): PixelCoordinate {
  const { selection } = state
  if (!selection || selection.count !== 1) throw new Error('Expected exactly one selected pixel')
  return { x: selection.bounds.x, y: selection.bounds.y }
}

/** The pixel the canvas draws at image coordinate `u` sampled at a device pixel centre: an exact edge shows the lower pixel. */
function drawnAt(u: number): number {
  return Math.ceil(u - 1e-6) - 1
}

const plain: PointerPress = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }

describe('clickSelectionMode', () => {
  it('uses the chosen mode for a plain click', () => {
    for (const chosen of ['new', 'add', 'subtract'] as const) expect(clickSelectionMode(plain, chosen)).toBe(chosen)
  })

  it('adds with Shift and subtracts with Ctrl or Command, whatever mode is chosen', () => {
    for (const chosen of ['new', 'add', 'subtract'] as const) {
      expect(clickSelectionMode({ ...plain, shiftKey: true }, chosen)).toBe('add')
      expect(clickSelectionMode({ ...plain, ctrlKey: true }, chosen)).toBe('subtract')
      expect(clickSelectionMode({ ...plain, metaKey: true }, chosen)).toBe('subtract')
    }
  })

  it('lets Ctrl win when Shift is also held', () => {
    expect(clickSelectionMode({ ...plain, shiftKey: true, ctrlKey: true }, 'new')).toBe('subtract')
    expect(clickSelectionMode({ ...plain, shiftKey: true, metaKey: true }, 'add')).toBe('subtract')
  })

  it('ignores Alt', () => {
    expect(clickSelectionMode({ ...plain, altKey: true }, 'new')).toBe('new')
    expect(clickSelectionMode({ ...plain, altKey: true, shiftKey: true }, 'new')).toBe('add')
    expect(clickSelectionMode({ ...plain, altKey: true, ctrlKey: true }, 'new')).toBe('subtract')
  })

  it('ignores every button other than the primary one', () => {
    for (const button of [1, 2, 3, 4, -1]) {
      expect(clickSelectionMode({ ...plain, button }, 'new')).toBeNull()
      expect(clickSelectionMode({ ...plain, button, shiftKey: true }, 'new')).toBeNull()
    }
  })
})

describe('magicWandClick', () => {
  it('works straight after an image opens, because the Magic Wand is active', () => {
    const state = open(WALLED())
    expect(state.activeTool).toBe('magic-wand')
    expect(maskRows(click(state, 0, 0).selection!)).toEqual(['##...', '##...', '.....'])
  })

  it('selects contiguous pixels by default and every matching pixel in Global mode', () => {
    const state = open(WALLED())
    expect(maskRows(click(state, 4, 2).selection!)).toEqual(['...##', '...##', '...##'])
    const global = reduce(state, { type: 'magic-wand-flood-mode-changed', floodMode: 'global' })
    expect(maskRows(click(global, 4, 2).selection!)).toEqual(['##.##', '##.##', '...##'])
  })

  it('uses the current tolerance', () => {
    // Red is far from white and black, so only a high tolerance reaches past it.
    const state = open(imageFromRows(PALETTE, 'wrk'))
    expect(maskRows(click(state, 0, 0).selection!)).toEqual(['#..'])
    const tolerant = reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 100 })
    expect(maskRows(click(tolerant, 0, 0).selection!)).toEqual(['###'])
  })

  it('replaces the selection with New', () => {
    const state = click(click(open(WALLED()), 0, 0), 4, 0)
    expect(maskRows(state.selection!)).toEqual(['...##', '...##', '...##'])
  })

  it('adds with Shift + Click and subtracts with Ctrl + Click', () => {
    const opened = open(WALLED())
    const shiftClick = clickSelectionMode({ ...plain, shiftKey: true }, opened.magicWand.selectionMode)!
    const ctrlClick = clickSelectionMode({ ...plain, ctrlKey: true }, opened.magicWand.selectionMode)!

    const added = click(click(opened, 0, 0), 4, 0, shiftClick)
    expect(maskRows(added.selection!)).toEqual(['##.##', '##.##', '...##'])
    const subtracted = click(added, 4, 2, ctrlClick)
    expect(maskRows(subtracted.selection!)).toEqual(['##...', '##...', '.....'])
    // Subtracting everything leaves no selection.
    expect(click(subtracted, 1, 1, ctrlClick).selection).toBeNull()
  })

  it('uses the selection mode chosen in the editor for plain clicks', () => {
    const state = reduce(open(WALLED()), { type: 'magic-wand-selection-mode-changed', selectionMode: 'add' })
    const chosen = clickSelectionMode(plain, state.magicWand.selectionMode)!
    expect(chosen).toBe('add')
    expect(maskRows(click(click(state, 0, 2, chosen), 4, 2, chosen).selection!)).toEqual(['...##', '...##', '##.##'])
  })

  it('subtracting from no selection changes nothing', () => {
    const state = open(WALLED())
    const action = magicWandClick(state, centreOf(state, 0, 0), 'subtract')!
    const next = editorReducer(state, action)
    expect(next.selection).toBeNull()
    // Only the click is recorded, as the operation a tolerance change re-applies.
    expect({ ...next, lastMagicWandOperation: null }).toEqual(state)
    expect(next.lastMagicWandOperation).toMatchObject({ selectionMode: 'subtract', base: null })
  })

  it('ignores clicks outside the image, including exactly on its right and bottom edges', () => {
    const state = open(WALLED())
    const view = displayViewport(state)!
    const outside = [
      imageToViewport(view, { x: -0.05, y: 1 }),
      imageToViewport(view, { x: 1, y: -0.05 }),
      imageToViewport(view, { x: 5, y: 1 }),
      imageToViewport(view, { x: 1, y: 3 }),
      { x: 2, y: 2 },
      { x: Number.NaN, y: 10 },
    ]
    for (const point of outside) expect(magicWandClick(state, point, 'new')).toBeNull()
    expect(magicWandClick(state, imageToViewport(view, { x: 4.9, y: 2.9 }), 'new')).not.toBeNull()
  })

  it('does nothing without an image or when another tool is active', () => {
    const empty = reduce(initialEditorState, resized(WORKSPACE))
    expect(magicWandClick(empty, { x: 500, y: 300 }, 'new')).toBeNull()
    expect(magicWandClick(initialEditorState, { x: 500, y: 300 }, 'new')).toBeNull()

    const state = open(WALLED())
    expect(magicWandClick({ ...state, activeTool: 'crop' }, centreOf(state, 0, 0), 'new')).toBeNull()
  })

  it('does nothing before the workspace has been measured', () => {
    const unmeasured = open(WALLED(), initialEditorState)
    expect(unmeasured.viewport).toBeNull()
    expect(magicWandClick(unmeasured, { x: 0, y: 0 }, 'new')).toBeNull()
  })

  it('selects the pixel under the pointer at any zoom and pan offset', () => {
    let state = open(uniqueImage(64, 48))
    state = reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 0 })
    const steps: EditorAction[] = [
      { type: 'zoom-fitted' },
      { type: 'zoom-scaled', anchor: { x: 500, y: 300 }, factor: 0.25 },
      { type: 'zoom-actual-size' },
      { type: 'zoom-scaled', anchor: { x: 513.7, y: 288.2 }, factor: 8 },
      { type: 'zoom-scaled', anchor: { x: 497.1, y: 301.9 }, factor: 4.37 },
      { type: 'wheel-panned', delta: { x: 37.3, y: -21.6 } },
      { type: 'pan-drag-started' },
      { type: 'pan-dragged', delta: { x: -113.4, y: 61.2 } },
      { type: 'pan-drag-ended' },
    ]
    for (const step of steps) {
      state = reduce(state, step)
      const view = displayViewport(state)!
      // Points spread across the canvas, many deliberately off pixel centres.
      for (let y = 3.3; y < 600; y += 47.9) {
        for (let x = 1.7; x < 1000; x += 59.3) {
          const action = magicWandClick(state, { x, y }, 'new')
          // Hit-tested at the centre of the pointer's device pixel (ratio 1 here).
          const centre = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 }
          const drawn = { x: drawnAt((centre.x - view.offset.x) / view.zoom), y: drawnAt((centre.y - view.offset.y) / view.zoom) }
          if (drawn.x < 0 || drawn.y < 0 || drawn.x >= 64 || drawn.y >= 48) {
            expect(action).toBeNull()
            continue
          }
          expect(selectedPixel(editorReducer(state, action!))).toEqual(drawn)
        }
      }
    }
  })

  it('selects the pixel drawn under the pointer at fractional device pixel ratios', () => {
    const views: EditorAction[][] = [
      [{ type: 'zoom-scaled', anchor: { x: 400.3, y: 300.7 }, factor: 7.3 }, { type: 'wheel-panned', delta: { x: 3.7, y: -2.9 } }],
      // Zoom stops where image pixel edges pass exactly through device pixel centres.
      [{ type: 'zoom-actual-size' }],
      [{ type: 'zoom-actual-size' }, { type: 'zoom-stepped', direction: 1 }],
      [{ type: 'zoom-actual-size' }, { type: 'zoom-stepped', direction: 1 }, { type: 'zoom-stepped', direction: 1 }],
    ]
    for (const [devicePixelRatio, steps] of [1, 1.25, 1.5, 1.75, 2].flatMap((ratio) => views.map((v) => [ratio, v] as const))) {
      const workspace = { size: { width: 801.6, height: 599.2 }, devicePixelRatio }
      let state = open(uniqueImage(64, 48), reduce(initialEditorState, resized(workspace)))
      state = reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 0 }, ...steps)
      const plan = planFrame({
        imageSize: { width: 64, height: 48 },
        viewport: displayViewport(state)!,
        viewportSize: workspace.size,
        devicePixelRatio,
      })
      const { a, e, f } = plan.image!.transform
      // For device pixels across the canvas, the pixel the canvas draws there (sampled at
      // the device pixel's centre) must be the pixel the Magic Wand selects, wherever the
      // pointer is inside that device pixel: browsers report whole CSS pixels, fractions of
      // them, or positions on device pixel corners.
      for (let py = 0; py < plan.backingStore.height; py += 53) {
        for (let px = 0; px < plan.backingStore.width; px += 61) {
          const drawn = { x: drawnAt((px + 0.5 - e) / a), y: drawnAt((py + 0.5 - f) / a) }
          for (const within of [0, 0.5, 0.95]) {
            const pointer = { x: (px + within) / devicePixelRatio, y: (py + within) / devicePixelRatio }
            const action = magicWandClick(state, pointer, 'new')
            if (drawn.x < 0 || drawn.y < 0 || drawn.x >= 64 || drawn.y >= 48) expect(action).toBeNull()
            else expect(selectedPixel(editorReducer(state, action!))).toEqual(drawn)
          }
        }
      }
    }
  })

  it('selects the pixel shown in the pointer\'s device pixel when an image pixel edge falls inside it', () => {
    // At 437% with ratio 1, the edge between image pixels 0 and 1 is at x = 4.37 (offset 0),
    // inside device pixel 4, which the canvas fills with image pixel 1 (sampled at 4.5).
    let state = open(uniqueImage(64, 48))
    state = reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 0 })
    state = { ...state, viewport: { zoom: 4.37, offset: { x: 0, y: 0 } } }
    expect(selectedPixel(editorReducer(state, magicWandClick(state, { x: 4, y: 0 }, 'new')!))).toEqual({ x: 1, y: 0 })
    expect(selectedPixel(editorReducer(state, magicWandClick(state, { x: 3.9, y: 0 }, 'new')!))).toEqual({ x: 0, y: 0 })
  })

  it('tags the result with the version it was computed from, so a late result is discarded', () => {
    const first = open(WALLED())
    const action = magicWandClick(first, centreOf(first, 0, 0), 'new')!
    expect(action).toMatchObject({ operation: { version: documentVersion(first) } })

    // Another image of the same size opens before the result is applied.
    const replaced = open(WALLED(), first)
    expect(editorReducer(replaced, action)).toBe(replaced)

    // The same image with changed pixels (a later revision).
    const revised: EditorState = { ...first, document: { ...first.document!, revision: 1 } }
    expect(editorReducer(revised, action)).toBe(revised)

    expect(editorReducer(first, action).selection).not.toBeNull()
  })

  it('never changes the image pixels or the previous selection', () => {
    const state = click(open(WALLED()), 0, 0)
    const pixels = state.document!.pixels.data.slice()
    const before = state.selection!
    const beforeBytes = before.data.slice()
    click(click(state, 4, 0, 'add'), 0, 2, 'subtract')
    expect(state.document!.pixels.data).toEqual(pixels)
    expect(state.selection).toBe(before)
    expect(before.data).toEqual(beforeBytes)
  })

  it('keeps the selection while zooming and panning between clicks', () => {
    const selected = click(open(WALLED()), 0, 0)
    const moved = reduce(
      selected,
      { type: 'zoom-scaled', anchor: { x: 500, y: 300 }, factor: 12 },
      { type: 'wheel-panned', delta: { x: 20, y: 10 } },
    )
    expect(moved.selection).toBe(selected.selection)
    // The next Shift + Click still adds to it.
    expect(maskRows(click(moved, 3, 0, 'add').selection!)).toEqual(['##.##', '##.##', '...##'])
  })
})

describe('selectAllCommand and clearSelectionCommand', () => {
  it('selects the whole image', () => {
    const state = open(WALLED())
    const selected = editorReducer(state, selectAllCommand(state)!)
    expect(selected.selection).toMatchObject({ count: 15, bounds: { x: 0, y: 0, width: 5, height: 3 } })
  })

  it('does nothing when everything is already selected', () => {
    const state = open(WALLED())
    const selected = editorReducer(state, selectAllCommand(state)!)
    expect(selectAllCommand(selected)).toBeNull()
  })

  it('replaces a partial selection', () => {
    const state = click(open(WALLED()), 0, 0)
    expect(editorReducer(state, selectAllCommand(state)!).selection!.count).toBe(15)
  })

  it('clears the selection, and does nothing when nothing is selected', () => {
    const state = open(WALLED())
    expect(clearSelectionCommand(state)).toBeNull()
    const selected = click(state, 0, 0)
    expect(editorReducer(selected, clearSelectionCommand(selected)!).selection).toBeNull()
  })

  it('does nothing without an image', () => {
    expect(selectAllCommand(initialEditorState)).toBeNull()
    expect(clearSelectionCommand(initialEditorState)).toBeNull()
  })

  it('discards a Select All computed for an image that was since replaced', () => {
    const first = open(WALLED())
    const action = selectAllCommand(first)!
    const replaced = open(WALLED(), first)
    expect(editorReducer(replaced, action)).toBe(replaced)
  })
})

describe('selectionShortcut', () => {
  /** A fake element whose closest() matches only the given selector fragments. */
  function element(matching: string[] = [], isContentEditable = false): EventTarget {
    const fake = {
      closest: (selector: string) =>
        matching.some((part) => selector.split(',').map((s) => s.trim()).includes(part)) ? {} : null,
      isContentEditable,
    }
    return fake as unknown as EventTarget
  }

  const key = (keyName: string, extra: Partial<ShortcutKey> = {}): ShortcutKey => ({
    key: keyName,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: element(),
    ...extra,
  })

  it('recognises Ctrl + A, Command + A and Escape', () => {
    expect(selectionShortcut(key('a', { ctrlKey: true }))).toBe('select-all')
    expect(selectionShortcut(key('A', { ctrlKey: true }))).toBe('select-all')
    expect(selectionShortcut(key('a', { metaKey: true }))).toBe('select-all')
    expect(selectionShortcut(key('Escape'))).toBe('clear-selection')
  })

  it('works with focus on the page, the workspace or a toolbar button', () => {
    expect(selectionShortcut(key('a', { ctrlKey: true, target: null }))).toBe('select-all')
    expect(selectionShortcut(key('Escape', { target: element(['button']) }))).toBe('clear-selection')
    expect(selectionShortcut(key('a', { ctrlKey: true, target: element(['button']) }))).toBe('select-all')
  })

  it('works with focus on the tolerance slider, which is not a text field', () => {
    const slider = { closest: (selector: string) => (selector === 'input' ? { type: 'range' } : null) } as unknown as EventTarget
    expect(selectionShortcut(key('a', { ctrlKey: true, target: slider }))).toBe('select-all')
    expect(selectionShortcut(key('Escape', { target: slider }))).toBe('clear-selection')
  })

  it('leaves text fields and editable content alone', () => {
    for (const target of [element(['input']), element(['textarea']), element(['select']), element([], true)]) {
      expect(selectionShortcut(key('a', { ctrlKey: true, target }))).toBeNull()
      expect(selectionShortcut(key('Escape', { target }))).toBeNull()
    }
  })

  it('ignores text composition and keys already handled elsewhere', () => {
    expect(selectionShortcut(key('Escape', { isComposing: true }))).toBeNull()
    expect(selectionShortcut(key('a', { ctrlKey: true, defaultPrevented: true }))).toBeNull()
  })

  it('ignores other keys and modifier combinations', () => {
    expect(selectionShortcut(key('a'))).toBeNull()
    expect(selectionShortcut(key('a', { shiftKey: true }))).toBeNull()
    expect(selectionShortcut(key('a', { ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(selectionShortcut(key('a', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(selectionShortcut(key('d', { ctrlKey: true }))).toBeNull()
    expect(selectionShortcut(key('Escape', { shiftKey: true }))).toBeNull()
    expect(selectionShortcut(key('Escape', { ctrlKey: true }))).toBeNull()
    expect(selectionShortcut(key('Esc'))).toBeNull()
  })
})

/** Applies a selection action, failing if it is unavailable. */
function run(state: EditorState, action: SelectionAction): EditorState {
  const result = selectionActionCommand(state, action)
  if (!result) throw new Error(`${action} did nothing`)
  return editorReducer(state, result)
}

/** A copy of a mask's bytes, to check that later operations never write to it. */
function snapshot(state: EditorState): Uint8Array | null {
  return state.selection ? Uint8Array.from(state.selection.data) : null
}

/**
 * A 7 × 5 white image with a 3 × 1 black bar in the middle, a black pixel in the corner
 * and a black pixel on the bottom edge:
 *
 *   k w w w w w w
 *   w w w w w w w
 *   w w k k k w w
 *   w w w w w w w
 *   w w w w k w w
 */
const BAR = () => imageFromRows(PALETTE, 'kwwwwww', 'wwwwwww', 'wwkkkww', 'wwwwwww', 'wwwwkww')

describe('availableSelectionActions', () => {
  const none = { 'select-all': false, clear: false, invert: false, grow: false, shrink: false }

  it('offers nothing without an image', () => {
    expect(availableSelectionActions(initialEditorState)).toEqual(none)
  })

  it('offers Select All and Invert with nothing selected', () => {
    expect(availableSelectionActions(open(BAR()))).toEqual({ ...none, 'select-all': true, invert: true })
  })

  it('offers everything for a partial selection', () => {
    const state = click(open(BAR()), 3, 2)
    expect(availableSelectionActions(state)).toEqual({
      'select-all': true,
      clear: true,
      invert: true,
      grow: true,
      shrink: true,
    })
  })

  it('offers Clear and Invert only when everything is selected', () => {
    const state = run(open(BAR()), 'select-all')
    expect(availableSelectionActions(state)).toEqual({ ...none, clear: true, invert: true })
  })

  it('agrees with the commands: an available action returns an action, an unavailable one null', () => {
    const states = [initialEditorState, open(BAR()), click(open(BAR()), 3, 2), run(open(BAR()), 'select-all')]
    for (const state of states) {
      const available = availableSelectionActions(state)
      for (const action of ['select-all', 'clear', 'invert', 'grow', 'shrink'] as const) {
        expect(selectionActionCommand(state, action) !== null).toBe(available[action])
      }
    }
  })
})

describe('selectionActionCommand', () => {
  it('selects all, clears and inverts', () => {
    const state = click(open(BAR()), 3, 2)
    expect(run(state, 'select-all').selection).toMatchObject({ count: 35, bounds: { x: 0, y: 0, width: 7, height: 5 } })
    expect(run(state, 'clear').selection).toBeNull()
    const inverted = run(state, 'invert')
    expect(inverted.selection).toMatchObject({ count: 32, bounds: { x: 0, y: 0, width: 7, height: 5 } })
    expect(maskRows(inverted.selection!)).toEqual(['#######', '#######', '##...##', '#######', '#######'])
  })

  it('inverts nothing to everything, and everything to nothing', () => {
    const everything = run(open(BAR()), 'invert')
    expect(everything.selection).toMatchObject({ count: 35, bounds: { x: 0, y: 0, width: 7, height: 5 } })
    expect(run(everything, 'invert').selection).toBeNull()
  })

  it('inverting twice gives back the same pixels', () => {
    const state = click(open(BAR()), 0, 0, 'new')
    const twice = run(run(state, 'invert'), 'invert')
    expect(maskRows(twice.selection!)).toEqual(maskRows(state.selection!))
    expect(twice.selection).toMatchObject({ count: state.selection!.count, bounds: state.selection!.bounds })
  })

  it('grows by one pixel including diagonals, with exact count and bounds', () => {
    const grown = run(click(open(BAR()), 3, 2), 'grow')
    expect(maskRows(grown.selection!)).toEqual(['.......', '.#####.', '.#####.', '.#####.', '.......'])
    expect(grown.selection).toMatchObject({ count: 15, bounds: { x: 1, y: 1, width: 5, height: 3 } })
  })

  it('grows within the image at its edges', () => {
    const grown = run(click(open(BAR()), 0, 0), 'grow')
    expect(grown.selection).toMatchObject({ count: 4, bounds: { x: 0, y: 0, width: 2, height: 2 } })
  })

  it('repeated Grow keeps growing until everything is selected, then is unavailable', () => {
    let state = click(open(BAR()), 3, 2)
    const counts: number[] = []
    while (availableSelectionActions(state).grow) {
      state = run(state, 'grow')
      counts.push(state.selection!.count)
    }
    expect(counts).toEqual([15, 35])
    expect(selectionActionCommand(state, 'grow')).toBeNull()
  })

  it('shrinks by one pixel including diagonals, keeping edges that touch the image border', () => {
    // Everything but the corner pixel: shrinking pulls away only around that pixel.
    const state = run(click(open(BAR()), 0, 0), 'invert')
    const shrunk = run(state, 'shrink')
    expect(maskRows(shrunk.selection!)).toEqual(['..#####', '..#####', '#######', '#######', '#######'])
    expect(shrunk.selection).toMatchObject({ count: 31, bounds: { x: 0, y: 0, width: 7, height: 5 } })
  })

  it('shrinking a selection too thin to survive leaves nothing selected', () => {
    const state = click(open(BAR()), 3, 2)
    const shrunk = run(state, 'shrink')
    expect(shrunk.selection).toBeNull()
    expect(availableSelectionActions(shrunk)).toMatchObject({ clear: false, grow: false, shrink: false })
  })

  it('Grow and Shrink do nothing with no selection or a full selection', () => {
    const empty = open(BAR())
    const full = run(empty, 'select-all')
    for (const state of [empty, full]) {
      expect(selectionActionCommand(state, 'grow')).toBeNull()
      expect(selectionActionCommand(state, 'shrink')).toBeNull()
    }
  })

  it('does nothing without an image', () => {
    for (const action of ['select-all', 'clear', 'invert', 'grow', 'shrink'] as const) {
      expect(selectionActionCommand(initialEditorState, action)).toBeNull()
    }
  })

  it('never modifies the previous mask or the image pixels', () => {
    const state = click(open(BAR()), 3, 2)
    const before = snapshot(state)
    const pixels = Uint8ClampedArray.from(state.document!.pixels.data)
    for (const action of ['invert', 'grow', 'shrink', 'select-all', 'clear'] as const) {
      const next = run(state, action)
      expect(next.selection).not.toBe(state.selection)
    }
    expect(snapshot(state)).toEqual(before)
    expect(state.document!.pixels.data).toEqual(pixels)
  })

  it('never changes the viewport, the tool or the Magic Wand options', () => {
    const state = click(open(BAR()), 3, 2)
    for (const action of ['invert', 'grow', 'shrink', 'select-all', 'clear'] as const) {
      const next = run(state, action)
      expect(next.viewport).toBe(state.viewport)
      expect(next.activeTool).toBe(state.activeTool)
      expect(next.magicWand).toBe(state.magicWand)
      expect(next.document).toBe(state.document)
    }
  })

  it('tags each result with its version, so a result for a replaced image is discarded', () => {
    const first = click(open(BAR()), 3, 2)
    const actions = (['invert', 'grow', 'shrink', 'select-all'] as const).map((a) => selectionActionCommand(first, a)!)
    const replaced = open(BAR(), first)
    expect(replaced.selection).toBeNull()
    for (const action of actions) expect(editorReducer(replaced, action)).toBe(replaced)
    // The replacement image still works normally.
    expect(run(replaced, 'select-all').selection!.count).toBe(35)
  })

  it('keeps a selection on the open image when another import fails', () => {
    const state = click(open(BAR()), 3, 2)
    const failed = reduce(
      state,
      { type: 'import-started', importId: 999 },
      { type: 'import-finished', importId: 999, result: { ok: false, error: { code: 'decode-failed', message: 'x' } } },
    )
    expect(failed.selection).toBe(state.selection)
    expect(run(failed, 'grow').selection!.count).toBe(15)
  })
})

describe('Magic Wand options and the selection', () => {
  it('changing the mode, flood mode or tolerance keeps the selection exactly as it is', () => {
    const state = click(open(BAR()), 3, 2)
    const changed = reduce(
      state,
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'subtract' },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'magic-wand-tolerance-changed', tolerance: 100 },
    )
    expect(changed.selection).toBe(state.selection)
    expect(changed.viewport).toBe(state.viewport)
    expect(changed.document).toBe(state.document)
  })

  it('a new flood mode takes effect on the next click', () => {
    const contiguous = click(open(BAR()), 3, 2)
    expect(contiguous.selection!.count).toBe(3)
    const global = reduce(contiguous, { type: 'magic-wand-flood-mode-changed', floodMode: 'global' })
    expect(global.selection!.count).toBe(3)
    expect(click(global, 3, 2).selection!.count).toBe(5)
    const back = reduce(global, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
    expect(click(back, 3, 2).selection!.count).toBe(3)
  })

  it('a new tolerance takes effect on the next click', () => {
    const state = click(open(BAR()), 3, 2)
    const raised = reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 100 })
    expect(raised.selection!.count).toBe(3)
    expect(click(raised, 3, 2).selection!.count).toBe(35)
  })

  it('the chosen selection mode decides what a plain click does', () => {
    let state = click(open(BAR()), 3, 2)
    state = reduce(state, { type: 'magic-wand-selection-mode-changed', selectionMode: 'add' })
    state = editorReducer(state, magicWandClick(state, centreOf(state, 0, 0), clickSelectionMode(plain, state.magicWand.selectionMode)!)!)
    expect(state.selection!.count).toBe(4)
    state = reduce(state, { type: 'magic-wand-selection-mode-changed', selectionMode: 'subtract' })
    state = editorReducer(state, magicWandClick(state, centreOf(state, 3, 2), clickSelectionMode(plain, state.magicWand.selectionMode)!)!)
    expect(state.selection).toMatchObject({ count: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } })
    state = reduce(state, { type: 'magic-wand-selection-mode-changed', selectionMode: 'new' })
    state = editorReducer(state, magicWandClick(state, centreOf(state, 3, 2), clickSelectionMode(plain, state.magicWand.selectionMode)!)!)
    expect(state.selection).toMatchObject({ count: 3, bounds: { x: 2, y: 2, width: 3, height: 1 } })
  })

  it('Shift and Ctrl override the chosen mode for one click without changing it', () => {
    let state = click(open(BAR()), 3, 2)
    const pressClick = (current: EditorState, x: number, y: number, press: PointerPress) =>
      editorReducer(current, magicWandClick(current, centreOf(current, x, y), clickSelectionMode(press, current.magicWand.selectionMode)!)!)

    state = pressClick(state, 0, 0, { ...plain, shiftKey: true })
    expect(state.selection!.count).toBe(4)
    expect(state.magicWand.selectionMode).toBe('new')

    state = pressClick(state, 0, 0, { ...plain, ctrlKey: true })
    expect(state.selection!.count).toBe(3)
    expect(state.magicWand.selectionMode).toBe('new')

    // Ctrl wins over Shift.
    state = pressClick(state, 3, 2, { ...plain, ctrlKey: true, shiftKey: true })
    expect(state.selection).toBeNull()
    expect(state.magicWand.selectionMode).toBe('new')

    // With Subtract chosen, Shift still adds for one click.
    state = reduce(state, { type: 'magic-wand-selection-mode-changed', selectionMode: 'subtract' })
    state = pressClick(state, 3, 2, { ...plain, shiftKey: true })
    expect(state.selection!.count).toBe(3)
    expect(state.magicWand.selectionMode).toBe('subtract')
    // And the next plain click subtracts again.
    state = pressClick(state, 3, 2, plain)
    expect(state.selection).toBeNull()
  })

  it('options persist when another image opens, which clears the selection', () => {
    const state = reduce(
      click(open(BAR()), 3, 2),
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'add' },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'magic-wand-tolerance-changed', tolerance: 42 },
    )
    const replaced = open(WALLED(), state)
    expect(replaced.selection).toBeNull()
    expect(replaced.magicWand).toEqual({ selectionMode: 'add', floodMode: 'global', tolerance: 42 })
    expect(availableSelectionActions(replaced)).toMatchObject({ clear: false, grow: false, shrink: false })
  })
})

/**
 * Ten grey levels, 26 apart, so each step of about 10 in tolerance reaches one more level
 * from white. Rows 0 and 1 run light to dark; row 2 runs dark to light, so it only joins a
 * Contiguous selection from (0, 0) once the selection is wide enough to meet it.
 */
const STAIRS = () => {
  const palette: Record<string, readonly [number, number, number, number]> = {}
  for (let k = 0; k < 10; k++) palette[String(k)] = [255 - 26 * k, 255 - 26 * k, 255 - 26 * k, 255]
  return imageFromRows(palette, '0123456789', '0123456789', '9876543210')
}

/** Commits a tolerance the way the App does: the tolerance, then the re-applied click if needed. */
function commit(state: EditorState, tolerance: number): EditorState {
  return reduce(state, ...commitToleranceCommand(state, tolerance))
}

/** The same click made once, at `tolerance`, on the state from before the original click. */
function freshClick(before: EditorState, x: number, y: number, mode: SelectionMode, tolerance: number): EditorState {
  return click(reduce(before, { type: 'magic-wand-tolerance-changed', tolerance }), x, y, mode)
}

function expectSameSelection(actual: EditorState, expected: EditorState) {
  if (!expected.selection) return expect(actual.selection).toBeNull()
  expect(maskRows(actual.selection!)).toEqual(maskRows(expected.selection))
  // Count and bounds agree with a recount of the bytes.
  const recount = createSelectionMask(actual.selection!.width, actual.selection!.height, Uint8Array.from(actual.selection!.data))
  expect(actual.selection).toMatchObject({ count: recount!.count, bounds: recount!.bounds })
  expect(actual.selection).toMatchObject({ count: expected.selection.count, bounds: expected.selection.bounds })
}

describe('re-applying the last Magic Wand click on a committed tolerance', () => {
  const SEQUENCE = [40, 60, 10, 100, 0, 35, 20]

  it('does nothing without a previous click, and never creates a selection', () => {
    const state = open(STAIRS())
    expect(reapplyMagicWandCommand(state, 60)).toBeNull()
    const committed = commit(state, 60)
    expect(committed.selection).toBeNull()
    expect(committed.magicWand.tolerance).toBe(60)
    // Select All is not a Magic Wand click either.
    const all = run(state, 'select-all')
    expect(commit(all, 5).selection).toBe(all.selection)
  })

  for (const floodMode of ['contiguous', 'global'] as const) {
    it(`New re-selects the clicked region at each tolerance (${floodMode})`, () => {
      const before = reduce(open(STAIRS()), { type: 'magic-wand-flood-mode-changed', floodMode })
      let state = click(before, 0, 0, 'new')
      expect(state.lastMagicWandOperation).toMatchObject({ seed: { x: 0, y: 0 }, floodMode, selectionMode: 'new', base: null, tolerance: 20 })
      for (const tolerance of SEQUENCE) {
        state = commit(state, tolerance)
        expectSameSelection(state, freshClick(before, 0, 0, 'new', tolerance))
      }
    })

    it(`Add recalculates against the selection before the click, never growing cumulatively (${floodMode})`, () => {
      const opened = reduce(open(STAIRS()), { type: 'magic-wand-flood-mode-changed', floodMode })
      const before = click(opened, 9, 0, 'new')
      const base = before.selection
      let state = click(before, 0, 0, 'add')
      expect(state.lastMagicWandOperation!.base).toBe(base)
      for (const tolerance of SEQUENCE) {
        state = commit(state, tolerance)
        expectSameSelection(state, freshClick(before, 0, 0, 'add', tolerance))
      }
      // Back at the click's tolerance: exactly the original result.
      expectSameSelection(state, click(before, 0, 0, 'add'))
    })

    it(`Subtract recalculates from the selection before the click, never removing cumulatively (${floodMode})`, () => {
      const opened = reduce(open(STAIRS()), { type: 'magic-wand-flood-mode-changed', floodMode })
      const before = run(opened, 'select-all')
      let state = click(before, 0, 0, 'subtract')
      for (const tolerance of SEQUENCE) {
        state = commit(state, tolerance)
        expectSameSelection(state, freshClick(before, 0, 0, 'subtract', tolerance))
      }
      // Raising the tolerance to remove everything, then lowering it, gives the pixels back.
      expect(commit(state, 100).selection).toBeNull()
      expectSameSelection(commit(commit(state, 100), 0), freshClick(before, 0, 0, 'subtract', 0))
    })
  }

  it('re-applies the modes captured at the click: Shift / Ctrl overrides, not later option changes', () => {
    const before = click(open(STAIRS()), 9, 0, 'new')
    const shift = clickSelectionMode({ ...plain, shiftKey: true }, before.magicWand.selectionMode)!
    let state = click(before, 0, 0, shift)
    expect(state.lastMagicWandOperation!.selectionMode).toBe('add')
    state = reduce(
      state,
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'subtract' },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
    )
    state = commit(state, 60)
    const expected = freshClick(before, 0, 0, 'add', 60)
    expectSameSelection(state, expected)
    expect(state.lastMagicWandOperation).toMatchObject({ selectionMode: 'add', floodMode: 'contiguous', tolerance: 60 })

    const ctrl = clickSelectionMode({ ...plain, ctrlKey: true, shiftKey: true }, 'new')!
    const subtracted = click(state, 9, 0, ctrl)
    expect(subtracted.lastMagicWandOperation).toMatchObject({ selectionMode: 'subtract', base: state.selection })
  })

  it('computes nothing when the effective tolerance has not changed, so a repeated commit is free', () => {
    let state = click(open(STAIRS()), 0, 0, 'new')
    for (const same of [20, 20.4, 19.6, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reapplyMagicWandCommand(state, same)).toBeNull()
    }
    state = commit(state, 40)
    const selection = state.selection
    // The same adjustment reported twice (change event, then leaving the slider).
    expect(commitToleranceCommand(state, 40)).toEqual([{ type: 'magic-wand-tolerance-changed', tolerance: 40 }])
    expect(commit(state, 40).selection).toBe(selection)
  })

  it('stops re-applying once Select All, Clear, Invert, Grow or Shrink changes the selection', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    for (const action of ['select-all', 'clear', 'invert', 'grow', 'shrink'] as const) {
      const changed = run(clicked, action)
      expect(changed.lastMagicWandOperation).toBeNull()
      expect(reapplyMagicWandCommand(changed, 90)).toBeNull()
      expect(commit(changed, 90).selection).toBe(changed.selection)
    }
  })

  it('stops re-applying when another image opens, and keeps the click when an import fails', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    const failed = reduce(
      clicked,
      { type: 'import-started', importId: 998 },
      { type: 'import-finished', importId: 998, result: { ok: false, error: { code: 'decode-failed', message: 'x' } } },
    )
    expect(failed.selection).toBe(clicked.selection)
    expect(failed.lastMagicWandOperation).toBe(clicked.lastMagicWandOperation)
    expectSameSelection(commit(failed, 60), commit(clicked, 60))

    const replaced = open(STAIRS(), clicked)
    expect(replaced.lastMagicWandOperation).toBeNull()
    expect(commit(replaced, 60).selection).toBeNull()
  })

  it('never re-applies to another document version, and discards a late or stale result', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    const revised: EditorState = { ...clicked, document: { ...clicked.document!, revision: 1 } }
    expect(reapplyMagicWandCommand(revised, 60)).toBeNull()

    const action = reapplyMagicWandCommand(clicked, 60)!
    // Another image opened before the result arrived.
    const replaced = open(STAIRS(), clicked)
    expect(editorReducer(replaced, action)).toBe(replaced)
    // A newer click (or re-apply) replaced the operation it was computed from.
    const newer = click(clicked, 9, 0, 'new')
    expect(editorReducer(newer, action)).toBe(newer)
    expect(editorReducer(commit(clicked, 30), action).lastMagicWandOperation!.tolerance).toBe(30)
  })

  it('never modifies the selection from before the click, earlier results or the image', () => {
    const before = click(open(STAIRS()), 9, 0, 'new')
    const baseBytes = Uint8Array.from(before.selection!.data)
    const pixels = Uint8ClampedArray.from(before.document!.pixels.data)
    let state = click(before, 0, 0, 'add')
    const results = [state.selection!]
    const snapshots = [Uint8Array.from(state.selection!.data)]
    for (const tolerance of SEQUENCE) {
      state = commit(state, tolerance)
      results.push(state.selection!)
      snapshots.push(Uint8Array.from(state.selection!.data))
    }
    expect(before.selection!.data).toEqual(baseBytes)
    results.forEach((mask, i) => expect(mask.data).toEqual(snapshots[i]))
    expect(before.document!.pixels.data).toEqual(pixels)
  })
})

/** `state` with image pixels that throw when read, so a test can tell whether the Magic Wand ran. */
function withUnreadablePixels(state: EditorState): EditorState {
  const pixels = new Proxy({} as ImageData, {
    get() {
      throw new Error('The Magic Wand ran')
    },
  })
  return { ...state, document: { ...state.document!, pixels } }
}

describe('re-applying: when it computes, and what a commit changes', () => {
  it('runs the Magic Wand only when a recorded click needs a new tolerance', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    // The check itself works: a real re-apply reads the pixels.
    expect(() => reapplyMagicWandCommand(withUnreadablePixels(clicked), 60)).toThrow('The Magic Wand ran')

    // The same effective tolerance, no click, another version: nothing is computed.
    expect(reapplyMagicWandCommand(withUnreadablePixels(clicked), 20.4)).toBeNull()
    expect(reapplyMagicWandCommand(withUnreadablePixels(open(STAIRS())), 60)).toBeNull()
    const revised: EditorState = { ...clicked, document: { ...clicked.document!, revision: 1 } }
    expect(reapplyMagicWandCommand(withUnreadablePixels(revised), 60)).toBeNull()
    expect(reapplyMagicWandCommand(withUnreadablePixels(run(clicked, 'grow')), 60)).toBeNull()
  })

  it('re-applies Subtract from nothing as nothing, without running the Magic Wand', () => {
    const subtracted = click(open(STAIRS()), 0, 0, 'subtract')
    expect(subtracted.selection).toBeNull()
    const action = reapplyMagicWandCommand(withUnreadablePixels(subtracted), 90)
    expect(action).toMatchObject({ type: 'magic-wand-reapplied', tolerance: 90, selection: null })
    const committed = commit(subtracted, 90)
    expect(committed.selection).toBeNull()
    expect(committed.lastMagicWandOperation).toMatchObject({ selectionMode: 'subtract', base: null, tolerance: 90 })
  })

  it('leaves the state untouched for a commit that changes nothing', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    expect(commit(clicked, 20)).toBe(clicked)
    const raised = commit(clicked, 60)
    expect(commit(raised, 60)).toBe(raised)
    expect(commit(raised, 59.6)).toBe(raised)
  })

  it('never re-applies while the tolerance is only being adjusted, only when it is committed', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    // A slider drag: every movement changes the tolerance, nothing else.
    let dragged = clicked
    for (const tolerance of [21, 30, 45, 70, 100, 64, 60]) {
      dragged = reduce(dragged, { type: 'magic-wand-tolerance-changed', tolerance })
      expect(dragged.selection).toBe(clicked.selection)
      expect(dragged.lastMagicWandOperation).toBe(clicked.lastMagicWandOperation)
    }
    // Released at 60.
    const released = commit(dragged, 60)
    expectSameSelection(released, freshClick(open(STAIRS()), 0, 0, 'new', 60))
    expect(released.lastMagicWandOperation!.tolerance).toBe(60)
  })

  it('computes nothing when a drag ends at the tolerance the selection was made with', () => {
    // Raised and lowered back to the click's tolerance before release.
    let state = click(open(STAIRS()), 0, 0, 'new')
    const selection = state.selection
    for (const tolerance of [50, 80, 20]) state = reduce(state, { type: 'magic-wand-tolerance-changed', tolerance })
    expect(reapplyMagicWandCommand(withUnreadablePixels(state), 20)).toBeNull()
    expect(commit(state, 20).selection).toBe(selection)
  })

  it('makes a click with a tolerance typed but not yet committed, which the later commit leaves alone', () => {
    // Typing "60" applies it; the click on the image arrives before the field loses focus.
    const before = click(open(STAIRS()), 9, 0, 'new')
    const typed = reduce(before, { type: 'magic-wand-tolerance-changed', tolerance: 60 })
    const clicked = click(typed, 0, 0, 'add')
    expect(clicked.lastMagicWandOperation).toMatchObject({ tolerance: 60, base: before.selection })
    // Leaving the field commits 60: the new click was made with it, so nothing is computed.
    expect(reapplyMagicWandCommand(withUnreadablePixels(clicked), 60)).toBeNull()
    expect(commit(clicked, 60)).toBe(clicked)
    expectSameSelection(clicked, freshClick(before, 0, 0, 'add', 60))
  })

  it('re-applies at the clicked pixel after zooming, panning and resizing the workspace', () => {
    const before = click(open(STAIRS()), 9, 0, 'new')
    const clicked = click(before, 0, 2, 'add')
    const moved = reduce(
      clicked,
      { type: 'zoom-scaled', anchor: { x: 400, y: 300 }, factor: 9 },
      { type: 'wheel-panned', delta: { x: -170, y: 40 } },
      { type: 'workspace-resized', workspace: { size: { width: 640, height: 480 }, devicePixelRatio: 1.5 } },
    )
    for (const tolerance of [70, 30, 5]) {
      expectSameSelection(commit(moved, tolerance), freshClick(before, 0, 2, 'add', tolerance))
    }
  })

  it('re-applies on the open image while another import runs, which then replaces or keeps the result', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    const importing = reduce(clicked, { type: 'import-started', importId: 997 })
    const reapplied = commit(importing, 60)
    expectSameSelection(reapplied, freshClick(open(STAIRS()), 0, 0, 'new', 60))

    const failed = reduce(reapplied, {
      type: 'import-finished',
      importId: 997,
      result: { ok: false, error: { code: 'decode-failed', message: 'x' } },
    })
    expect(failed.selection).toBe(reapplied.selection)
    expect(failed.lastMagicWandOperation).toBe(reapplied.lastMagicWandOperation)
    // Still re-applies after the failure.
    expectSameSelection(commit(failed, 10), freshClick(open(STAIRS()), 0, 0, 'new', 10))

    const pixels = STAIRS()
    const document = createImageDocument({ name: 'b.png', format: 'png', source: 'drop', fileSizeBytes: 1, pixels })
    const bitmap = { width: pixels.width, height: pixels.height, close: () => {} }
    const succeeded = reduce(reapplied, { type: 'import-finished', importId: 997, result: { ok: true, document, bitmap } })
    expect(succeeded.selection).toBeNull()
    expect(succeeded.lastMagicWandOperation).toBeNull()
    expect(commit(succeeded, 80).selection).toBeNull()
  })

  it('discards a re-applied result that arrives after Select All, Invert, Grow, Shrink or Clear', () => {
    const clicked = click(open(STAIRS()), 0, 0, 'new')
    const late = reapplyMagicWandCommand(clicked, 70)!
    for (const action of ['select-all', 'clear', 'invert', 'grow', 'shrink'] as const) {
      const changed = run(clicked, action)
      expect(editorReducer(changed, late)).toBe(changed)
    }
  })
})

describe('re-applying: what the overlay and status bar show', () => {
  /** Every overlay pixel at `scale` device pixels per image pixel: selection states and the drawn colours. */
  function overlay(selection: SelectionMask, scale: number) {
    const lineWidth = boundaryLineWidth(1)
    const rect = { x: -lineWidth, y: -lineWidth, width: Math.ceil(selection.width * scale) + 2 * lineWidth, height: Math.ceil(selection.height * scale) + 2 * lineWidth }
    const out = new Uint32Array(rect.width * rect.height)
    rasteriseSelectionOverlay(selection, scale, lineWidth, rect, out, rect.width)
    return { states: selectionStates(selection, scale, rect), pixels: out }
  }

  it('draws a re-applied selection exactly as the same click made once at that tolerance', () => {
    for (const mode of ['new', 'add', 'subtract'] as const) {
      const before = mode === 'new' ? open(STAIRS()) : mode === 'add' ? click(open(STAIRS()), 9, 2, 'new') : run(open(STAIRS()), 'select-all')
      let state = click(before, 0, 0, mode)
      for (const tolerance of [55, 5, 30]) {
        state = commit(state, tolerance)
        const expected = freshClick(before, 0, 0, mode, tolerance)
        if (!expected.selection) {
          expect(state.selection).toBeNull()
          continue
        }
        for (const scale of [1, 3, 0.5]) expect(overlay(state.selection!, scale)).toEqual(overlay(expected.selection, scale))
      }
    }
  })

  it('reports the re-applied pixel count and bounds in the status bar, recounted from the mask', () => {
    const before = click(open(STAIRS()), 9, 0, 'new')
    let state = click(before, 0, 0, 'add')
    for (const tolerance of [40, 100, 0, 25]) {
      state = commit(state, tolerance)
      const expected = freshClick(before, 0, 0, 'add', tolerance)
      expect(formatSelection(state.selection!)).toBe(formatSelection(expected.selection!))
      expect(describeSelection(state.selection)).toBe(describeSelection(expected.selection))
      const recount = createSelectionMask(10, 3, Uint8Array.from(state.selection!.data))!
      expect(formatSelection(state.selection!)).toBe(formatSelection(recount))
    }
    expect(formatSelection(commit(state, 100).selection!)).toBe('30 px · 10 × 3')
  })
})

/**
 * A 3840 × 2160 screenshot-like image: a vertical background gradient (light grey), a dark
 * toolbar and blue panels, so tolerance decides how much of the background a click reaches.
 */
function screenshot4K(): ImageData {
  const width = 3840
  const height = 2160
  const data = new Uint8ClampedArray(width * height * 4)
  const words = new Uint32Array(data.buffer)
  // Little-endian words: 0xAABBGGRR.
  for (let y = 0; y < height; y++) {
    const shade = 200 + Math.floor((y * 50) / height)
    words.fill((255 << 24) | (shade << 16) | (shade << 8) | shade, y * width, (y + 1) * width)
  }
  const rect = (x0: number, y0: number, w: number, h: number, value: number) => {
    for (let y = y0; y < y0 + h; y++) words.fill(value, y * width + x0, y * width + x0 + w)
  }
  rect(0, 0, width, 120, 0xff302820)
  for (let i = 0; i < 6; i++) rect(200 + i * 600, 400 + (i % 2) * 500, 480, 900, 0xffc08040)
  return { colorSpace: 'srgb', width, height, data }
}

function sameMask(a: SelectionMask | null, b: SelectionMask | null): boolean {
  if (!a || !b) return a === b
  if (a.count !== b.count || JSON.stringify(a.bounds) !== JSON.stringify(b.bounds)) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

describe('re-applying on a 4K image', () => {
  it('takes one Magic Wand pass per commit, never accumulates and keeps only the masks it needs', () => {
    const opened = open(screenshot4K())
    const befores = {
      new: opened,
      // One blue panel.
      add: click(opened, 300, 500, 'new'),
      subtract: run(opened, 'select-all'),
    } as const
    expect(befores.add.selection!.count).toBe(480 * 900)
    for (const mode of ['new', 'add', 'subtract'] as const) {
      const before = befores[mode]
      let state = click(before, 3000, 2000, mode)
      const counts = [state.selection?.count]
      // Down from the click's 20 (which reaches the whole gradient), then back up part of the
      // way: the background reached changes each time.
      for (const tolerance of [5, 12]) {
        const started = performance.now()
        state = commit(state, tolerance)
        // About 50–200 ms in Node on a desktop; the limit only catches runaway work.
        expect(performance.now() - started).toBeLessThan(2000)
        counts.push(state.selection?.count)
        // Memory: New keeps no earlier mask; Add and Subtract share the one from before the
        // click, never copying it, so the state holds at most two full-image masks.
        expect(state.lastMagicWandOperation!.base).toBe(mode === 'new' ? null : before.selection)
      }
      expect(new Set(counts).size).toBe(3)
      expect(sameMask(state.selection, freshClick(before, 3000, 2000, mode, 12).selection)).toBe(true)
    }
  })
})
