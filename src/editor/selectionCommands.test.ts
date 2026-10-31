import { describe, expect, it } from 'vitest'
import { imageToViewport } from '../canvas/coordinates'
import { planFrame } from '../canvas/rendering'
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
import { createImageDocument } from './imageDocument'
import {
  type PointerPress,
  type ShortcutKey,
  clearSelectionCommand,
  clickSelectionMode,
  magicWandClick,
  selectAllCommand,
  selectionShortcut,
} from './selectionCommands'
import type { PixelCoordinate, Point, SelectionMode } from './types'

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
    expect(editorReducer(state, action)).toBe(state)
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
    expect(action).toMatchObject({ version: documentVersion(first) })

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
