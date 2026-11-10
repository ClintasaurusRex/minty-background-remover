import { beforeEach, describe, expect, it } from 'vitest'
import { editActionCommand, hasUnexportedEdits } from '../editor/editCommands'
import { type EditorAction, type EditorState, displayViewport, editorReducer, initialEditorState } from '../editor/editorState'
import { type FakeDisplayImages, WORKSPACE, accepted, fakeDisplayImages, opened, reduce } from '../editor/history/testFixtures'
import { commitToleranceCommand, magicWandClick, selectionActionCommand } from '../editor/selectionCommands'
import type { PixelBuffer } from '../editor/types'
import { encodePng } from '../image/export/pngEncoder'
import { decodeTestPng } from '../image/export/testPng'
import { createPixelBuffer } from '../image/pixelBuffer'
import { type ExportTarget, runExport } from './exportImage'

/*
 * The whole first background-removal workflow with the application's own commands, reducer and
 * PNG encoder: open → Magic Wand → tolerance → Delete → Undo / Redo → Auto Trim → Export, with
 * every exported pixel decoded and compared. Only the browser's download is replaced (it records
 * the file), and display images are fakes.
 */

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

/** An editor whose dispatch runs the real reducer, with the exports it downloaded. */
function editor(initial: EditorState) {
  let state = initial
  const downloads: { file: Blob; fileName: string }[] = []
  const dispatched: EditorAction[] = []
  const target: ExportTarget = {
    committedState: () => state,
    dispatch: (action) => {
      dispatched.push(action)
      state = editorReducer(state, action)
    },
    flush: (update) => update(),
    encode: (pixels) => encodePng(pixels, { yieldControl: () => Promise.resolve() }),
    download: (file, fileName) => downloads.push({ file, fileName }),
  }
  return {
    target: target as ExportTarget,
    downloads,
    dispatched,
    get state() {
      return state
    },
    set state(next: EditorState) {
      state = next
    },
    edit(action: 'delete-selection' | 'undo' | 'redo' | 'auto-trim') {
      state = accepted(state, editActionCommand(state, action, images.create))
    },
    click(x: number, y: number) {
      const viewport = displayViewport(state)!
      const point = { x: viewport.offset.x + (x + 0.5) * viewport.zoom, y: viewport.offset.y + (y + 0.5) * viewport.zoom }
      state = accepted(state, magicWandClick(state, point, 'new'))
    },
    tolerance(value: number) {
      state = reduce(state, ...commitToleranceCommand(state, value))
    },
  }
}

/**
 * 24 × 16: a light background with a little noise (values 240–247), a dark blue rounded badge
 * (12 × 8 at 6, 4) with a soft (partially transparent) red dot inside, and a 1-pixel grey line
 * not touching the badge.
 */
function screenshot(): PixelBuffer {
  const width = 24
  const height = 16
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const noise = (x * 7 + y * 3) % 8
      data.set([240 + noise, 240 + noise, 240 + noise, 255], i)
      const inBadge = x >= 6 && x < 18 && y >= 4 && y < 12 && !((x === 6 || x === 17) && (y === 4 || y === 11))
      if (inBadge) data.set([20, 40, 120, 255], i)
      if (inBadge && (x === 11 || x === 12) && (y === 7 || y === 8)) data.set([230, 30, 30, 96 + x * 4 + y], i)
      if (x === 2 && y >= 2 && y < 14) data.set([128, 128, 128, 255], i)
    }
  }
  return createPixelBuffer(width, height, data)
}

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })

function pixelAt(data: ArrayLike<number>, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

/** What the export of `pixels` must contain: every byte, fully transparent pixels as 0, 0, 0, 0. */
function expectExportOf(pixels: PixelBuffer, decoded: { width: number; height: number; data: Uint8Array }) {
  expect([decoded.width, decoded.height]).toEqual([pixels.width, pixels.height])
  let mismatches = 0
  for (let p = 0; p < pixels.width * pixels.height; p++) {
    const i = p * 4
    const alpha = pixels.data[i + 3]
    const expected = alpha === 0 ? [0, 0, 0, 0] : [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2], alpha]
    for (let k = 0; k < 4; k++) if (decoded.data[i + k] !== expected[k]) mismatches++
  }
  expect(mismatches).toBe(0)
}

async function lastExport(downloads: { file: Blob; fileName: string }[]) {
  const download = downloads.at(-1)!
  return { fileName: download.fileName, png: await decodeTestPng(download.file) }
}

describe('runExport: the first background-removal workflow', () => {
  it('opens, selects with the Magic Wand, deletes, undoes, redoes, trims and exports exact transparent PNGs', async () => {
    const original = screenshot()
    const app = editor(opened(original, measured))
    expect(app.state.document!.name).toBe('test.png')

    // Tolerance 0 selects only the exact clicked colour, leaving most of the noisy background.
    app.tolerance(0)
    app.click(0, 0)
    const exact = app.state.selection!.count
    // A committed tolerance re-applies the click: now the whole connected background (not the
    // line, the badge or its dot, which differ far more).
    app.tolerance(10)
    const selection = app.state.selection!
    expect(selection.count).toBeGreaterThan(exact)
    expect(selection.count).toBe(24 * 16 - 12 * 8 + 4 - 12)
    expect(selection.data[0]).toBe(1)
    expect(selection.data[4 * 24 + 6]).toBe(1) // the badge's rounded corner is background
    expect(selection.data[4 * 24 + 7]).toBe(0)
    expect(selection.data[5 * 24 + 2]).toBe(0) // the line

    app.edit('delete-selection')
    const deleted = app.state.document!.pixels
    expect([deleted.width, deleted.height]).toEqual([24, 16])
    expect(app.state.selection).toBeNull()
    expect(hasUnexportedEdits(app.state)).toBe(true)

    // Export the transparent result.
    await runExport(app.target, 1)
    expect(app.downloads).toHaveLength(1)
    let exported = await lastExport(app.downloads)
    expect(exported.fileName).toBe('test-cleaned.png')
    expectExportOf(deleted, exported.png)
    // Deleted background: fully transparent, hidden colour dropped. Unselected pixels: exact.
    expect(pixelAt(exported.png.data, 24, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(deleted.data, 24, 0, 0)).toEqual([240, 240, 240, 0])
    expect(pixelAt(exported.png.data, 24, 7, 4)).toEqual([20, 40, 120, 255])
    expect(pixelAt(exported.png.data, 24, 11, 7)).toEqual([230, 30, 30, 96 + 44 + 7])
    expect(pixelAt(exported.png.data, 24, 2, 5)).toEqual([128, 128, 128, 255])
    expect(hasUnexportedEdits(app.state)).toBe(false)
    expect(app.state.editNotice).toEqual({ kind: 'exported', fileName: 'test-cleaned.png' })

    // Undo: the original pixels, exported exactly; Redo: the deletion again.
    app.edit('undo')
    // The selection comes back (decoded from the history: equal, not the same object).
    expect(app.state.selection!.count).toBe(selection.count)
    expect(app.state.selection!.data).toEqual(selection.data)
    // Exported with the selection active: the selection is not part of the file, and stays.
    await runExport(app.target, 2)
    expect(app.state.selection!.data).toEqual(selection.data)
    exported = await lastExport(app.downloads)
    expectExportOf(original, exported.png)
    expect(pixelAt(exported.png.data, 24, 0, 0)).toEqual([240, 240, 240, 255])
    app.edit('redo')
    await runExport(app.target, 3)
    expectExportOf(deleted, (await lastExport(app.downloads)).png)

    // Auto Trim with the default 5 px padding, then Trim Tight (0 px): the size changes, pixels stay.
    expect(app.state.autoTrimPadding).toBe(5)
    app.edit('auto-trim')
    // The visible area is x 2–17, y 2–13; 5 px padding is clipped at the image's edges.
    expect([app.state.document!.width, app.state.document!.height]).toEqual([23, 16]) // x 0–22, y 0–15
    app.state = reduce(app.state, { type: 'auto-trim-padding-changed', padding: 0 })
    app.edit('auto-trim')
    const trimmed = app.state.document!.pixels
    expect([trimmed.width, trimmed.height]).toEqual([16, 12])
    await runExport(app.target, 4)
    exported = await lastExport(app.downloads)
    expectExportOf(trimmed, exported.png)
    expect(pixelAt(exported.png.data, 16, 0, 0)).toEqual([128, 128, 128, 255]) // the line's top
    expect(pixelAt(exported.png.data, 16, 4, 2)).toEqual([0, 0, 0, 0]) // the badge's rounded corner
    expect(pixelAt(exported.png.data, 16, 9, 5)).toEqual([230, 30, 30, 96 + 44 + 7])

    // Undo both trims and the Delete: back to the opened image, byte for byte.
    app.edit('undo')
    app.edit('undo')
    app.edit('undo')
    await runExport(app.target, 5)
    expectExportOf(original, (await lastExport(app.downloads)).png)
    expect(app.downloads.map((download) => download.fileName)).toEqual(Array(5).fill('test-cleaned.png'))
  })

  it('exports a fully transparent image as a transparent PNG of the same size', async () => {
    const app = editor(opened(screenshot(), measured))
    app.state = accepted(app.state, selectionActionCommand(app.state, 'select-all'))
    app.edit('delete-selection')
    await runExport(app.target, 1)
    const { png } = await lastExport(app.downloads)
    expect([png.width, png.height]).toEqual([24, 16])
    expect(png.data.every((value) => value === 0)).toBe(true)
  })
})

describe('runExport', () => {
  it('starts nothing without an image', async () => {
    const app = editor(measured)
    await runExport(app.target, 1)
    expect(app.dispatched).toEqual([])
    expect(app.downloads).toEqual([])
  })

  it('starts nothing while another image opens, and exports as before once it has opened', async () => {
    const app = editor(opened(screenshot(), measured))
    app.click(0, 0)
    app.state = reduce(app.state, { type: 'import-started', importId: 900 })
    await runExport(app.target, 1)
    expect(app.dispatched).toEqual([])
    expect(app.downloads).toEqual([])
    const next = screenshot()
    app.state = opened(next, app.state)
    await runExport(app.target, 2)
    expectExportOf(next, (await lastExport(app.downloads)).png)
  })

  it('runs one export at a time: a second request while one is written does nothing', async () => {
    const app = editor(opened(screenshot(), measured))
    let finish: (file: Blob) => void = () => {}
    app.target = { ...app.target, encode: () => new Promise<Blob>((resolve) => (finish = resolve)) }
    const first = runExport(app.target, 1)
    expect(app.state.exporting?.id).toBe(1)
    await runExport(app.target, 2)
    expect(app.state.exporting?.id).toBe(1)
    finish(new Blob(['png'], { type: 'image/png' }))
    await first
    expect(app.state.exporting).toBeNull()
    expect(app.downloads.map((download) => download.fileName)).toEqual(['test-cleaned.png'])
    expect(app.dispatched.map((action) => action.type)).toEqual(['export-started', 'export-finished'])
  })

  it('reports a file that could not be written, and downloads nothing', async () => {
    const app = editor(opened(screenshot(), measured))
    app.target = { ...app.target, encode: () => Promise.reject(new RangeError('Array buffer allocation failed')) }
    await runExport(app.target, 1)
    expect(app.downloads).toEqual([])
    expect(app.state.exporting).toBeNull()
    expect(app.state.editError).toEqual({ operation: 'export', detail: 'RangeError: Array buffer allocation failed' })
    expect(app.state.lastExport).toBeNull()
  })

  it('reports a download the browser refused', async () => {
    const app = editor(opened(screenshot(), measured))
    app.edit('auto-trim')
    app.target = {
      ...app.target,
      download: () => {
        throw new Error('Blocked')
      },
    }
    await runExport(app.target, 1)
    expect(app.state.editError).toEqual({ operation: 'export', detail: 'Error: Blocked' })
    expect(app.state.exporting).toBeNull()
  })
})
