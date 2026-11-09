import { beforeEach, describe, expect, it } from 'vitest'
import { type Rgba, imageFromRows } from '../image/selection/testFixtures'
import { adjustDeleteCommand, autoTrimCommand, editActionCommand, hasUnexportedEdits } from './editCommands'
import { editErrorMessage, editNoticeText, isShownEditNotice } from './editFeedback'
import {
  type EditorState,
  currentContent,
  displayViewport,
  editorReducer,
  initialEditorState,
  isExportedContent,
  sameContent,
} from './editorState'
import { canExport, exportFileName, exportStartCommand } from './exportCommands'
import { type FakeDisplayImages, WORKSPACE, accepted, fakeDisplayImages, opened, reachable, reduce } from './history/testFixtures'
import { magicWandClick } from './selectionCommands'
import type { PixelBuffer } from './types'

/*
 * Export's editor side (PNG export brought forward from Phase 6): availability, the suggested file
 * name, the export's state and outcomes in the reducer, and "unexported edits" measured from the
 * last export. Writing the file is tested in image/export/pngEncoder.test.ts and the whole flow in
 * app/exportImage.test.ts.
 */

const palette: Readonly<Record<string, Rgba>> = {
  w: [250, 250, 250, 255],
  r: [220, 30, 30, 255],
  k: [10, 10, 10, 255],
}

function picture(): PixelBuffer {
  return imageFromRows(palette, 'wwwwwww', 'wrrwkkw', 'wrrwkkw', 'wwwwwww')
}

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })
const start = () => opened(picture(), measured)

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

const run = (state: EditorState, action: 'delete-selection' | 'undo' | 'redo') =>
  accepted(state, editActionCommand(state, action, images.create))

function click(state: EditorState, x: number, y: number): EditorState {
  const viewport = displayViewport(state)!
  const point = { x: viewport.offset.x + (x + 0.5) * viewport.zoom, y: viewport.offset.y + (y + 0.5) * viewport.zoom }
  return accepted(state, magicWandClick(state, point, 'new'))
}

let nextId = 1

/** `state` after an export of its image started and finished (the file itself is not written here). */
function exported(state: EditorState): EditorState {
  const start = exportStartCommand(state, nextId++)
  if (!start) throw new Error('Export unavailable')
  const running = accepted(state, start.action)
  return accepted(running, { type: 'export-finished', id: start.action.job.id })
}

describe('exportFileName', () => {
  it('adds -cleaned and the .png extension to the opened name', () => {
    expect(exportFileName('pump-station.png')).toBe('pump-station-cleaned.png')
    expect(exportFileName('pump-station.jpg')).toBe('pump-station-cleaned.png')
    expect(exportFileName('Photo.JPEG')).toBe('Photo-cleaned.png')
    expect(exportFileName('drawing.svg')).toBe('drawing-cleaned.png')
    expect(exportFileName('pasted-image-2026-11-08-201500.png')).toBe('pasted-image-2026-11-08-201500-cleaned.png')
  })

  it('removes only the last extension, and never names the opened file', () => {
    expect(exportFileName('site.plan.v2.webp')).toBe('site.plan.v2-cleaned.png')
    expect(exportFileName('logo')).toBe('logo-cleaned.png')
    // A leading dot would make a hidden file on Linux: dropped, like spaces and dots at the ends.
    expect(exportFileName('.png')).toBe('png-cleaned.png')
    expect(exportFileName('logo-cleaned.png')).toBe('logo-cleaned-cleaned.png')
    for (const name of ['a.png', 'a', 'a-cleaned.png', '.png']) expect(exportFileName(name)).not.toBe(name)
  })

  it('replaces characters file systems reject, and drops spaces and dots at the ends', () => {
    expect(exportFileName('a:b*c?"d"<e>|f.png')).toBe('a_b_c__d__e__f-cleaned.png')
    expect(exportFileName('folder/sub\\name.png')).toBe('name-cleaned.png')
    expect(exportFileName('tab\there\u0001.png')).toBe('tab_here_-cleaned.png')
    expect(exportFileName('  spaced name. .png')).toBe('spaced name-cleaned.png')
    expect(exportFileName('...')).toBe('image-cleaned.png')
    expect(exportFileName('')).toBe('image-cleaned.png')
  })

  it('keeps long names to a 200-character stem without splitting characters', () => {
    const long = `${'😀'.repeat(150)}${'x'.repeat(100)}.png`
    const name = exportFileName(long)
    expect(Array.from(name.replace(/-cleaned\.png$/, ''))).toHaveLength(200)
    expect(name.startsWith('😀'.repeat(150))).toBe(true)
    expect(name).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('Export availability and state', () => {
  it('is unavailable without an image and while another export runs', () => {
    expect(canExport(initialEditorState)).toBe(false)
    expect(exportStartCommand(initialEditorState, 1)).toBeNull()
    const state = start()
    expect(canExport(state)).toBe(true)
    const startAction = exportStartCommand(state, 7)!
    expect(startAction.pixels).toBe(state.document!.pixels)
    expect(startAction.action.job).toEqual({ id: 7, fileName: 'test-cleaned.png', content: currentContent(state) })
    const running = accepted(state, startAction.action)
    expect(running.exporting).toBe(startAction.action.job)
    expect(canExport(running)).toBe(false)
    expect(exportStartCommand(running, 8)).toBeNull()
    // A second start that slipped through is refused by the reducer.
    expect(editorReducer(running, exportStartCommand(state, 9)!.action)).toBe(running)
  })

  it('is available while another image opens, and with a selection (which it ignores)', () => {
    const importing = reduce(click(start(), 0, 0), { type: 'import-started', importId: 5 })
    expect(canExport(importing)).toBe(true)
    expect(exportStartCommand(importing, 1)?.pixels).toBe(importing.document!.pixels)
  })

  it('refuses a start computed for an earlier content state', () => {
    const state = click(start(), 0, 0)
    const stale = exportStartCommand(state, 1)!
    const deleted = run(state, 'delete-selection')
    expect(editorReducer(deleted, stale.action)).toBe(deleted)
  })

  it('finishes with an announcement only, changing nothing in the image, selection or history', () => {
    const state = click(run(click(start(), 0, 0), 'delete-selection'), 4, 1)
    const startAction = exportStartCommand(state, 3)!
    const running = accepted(state, startAction.action)
    const done = accepted(running, { type: 'export-finished', id: 3 })
    for (const key of ['document', 'documentBitmap', 'selection', 'lastMagicWandOperation', 'history', 'viewport', 'editDepth'] as const) {
      expect(done[key]).toBe(state[key])
    }
    expect(done.exporting).toBeNull()
    expect(isExportedContent(done.lastExport, startAction.action.job.content)).toBe(true)
    expect(isExportedContent(done.lastExport, currentContent(done))).toBe(true)
    expect(done.editNotice).toEqual({ kind: 'exported', fileName: 'test-cleaned.png' })
    expect(done.editFeedbackId).toBe(running.editFeedbackId + 1)
    expect(editNoticeText(done.editNotice!)).toBe('Exported as test-cleaned.png.')
    expect(isShownEditNotice(done.editNotice!)).toBe(false)
  })

  it('ignores outcomes of exports that are not running', () => {
    const state = start()
    expect(editorReducer(state, { type: 'export-finished', id: 1 })).toBe(state)
    expect(editorReducer(state, { type: 'export-failed', id: 1 })).toBe(state)
    const running = accepted(state, exportStartCommand(state, 2)!.action)
    expect(editorReducer(running, { type: 'export-finished', id: 1 })).toBe(running)
    expect(editorReducer(running, { type: 'export-failed', id: 3 })).toBe(running)
  })

  it('reports a failure, keeping the image, selection, history and last export', () => {
    const state = exported(run(click(start(), 0, 0), 'delete-selection'))
    const edited = run(click(state, 4, 1), 'delete-selection')
    const running = accepted(edited, exportStartCommand(edited, 11)!.action)
    const failed = accepted(running, { type: 'export-failed', id: 11, detail: 'RangeError: Array buffer allocation failed' })
    expect(failed.exporting).toBeNull()
    expect(failed.lastExport).toBe(edited.lastExport)
    expect(failed.document).toBe(edited.document)
    expect(failed.editError).toEqual({ operation: 'export', detail: 'RangeError: Array buffer allocation failed' })
    expect(failed.editNotice).toBeNull()
    expect(editErrorMessage(failed.editError!)).toBe(
      'The image could not be exported. Nothing was downloaded, and the image has not changed. There may not be enough memory for an image this large.',
    )
    expect(editErrorMessage({ operation: 'export' })).toBe('The image could not be exported. Nothing was downloaded, and the image has not changed.')
    expect(hasUnexportedEdits(failed)).toBe(true)
  })

  it('keeps running when another image opens, and then does not count as that image’s export', () => {
    const state = run(click(start(), 0, 0), 'delete-selection')
    const running = accepted(state, exportStartCommand(state, 21)!.action)
    const other = opened(picture(), running)
    expect(other.exporting).toBe(running.exporting)
    expect(canExport(other)).toBe(false)
    const done = accepted(other, { type: 'export-finished', id: 21 })
    expect(done.lastExport).toBeNull()
    expect(done.editNotice).toEqual({ kind: 'exported', fileName: 'test-cleaned.png' })
    // The new image's own edits are unexported.
    expect(hasUnexportedEdits(run(click(done, 0, 0), 'delete-selection'))).toBe(true)
  })
})

describe('hasUnexportedEdits after exports', () => {
  it('is false right after an export, and again after Undo and Redo back to it', () => {
    let state = run(click(start(), 0, 0), 'delete-selection')
    state = run(click(state, 4, 1), 'delete-selection')
    expect(hasUnexportedEdits(state)).toBe(true)
    state = exported(state)
    expect(hasUnexportedEdits(state)).toBe(false)
    state = run(state, 'undo')
    expect(hasUnexportedEdits(state)).toBe(true)
    state = run(state, 'redo')
    expect(hasUnexportedEdits(state)).toBe(false)
    // Undoing every edit returns to the opened file: nothing to lose.
    state = run(run(state, 'undo'), 'undo')
    expect(state.editDepth).toBe(0)
    expect(hasUnexportedEdits(state)).toBe(false)
    state = run(run(state, 'redo'), 'redo')
    expect(hasUnexportedEdits(state)).toBe(false)
  })

  it('is true again after a new edit, also one made after undoing to before the export', () => {
    let state = exported(run(click(start(), 0, 0), 'delete-selection'))
    const afterExport = state
    state = run(click(state, 4, 1), 'delete-selection')
    expect(hasUnexportedEdits(state)).toBe(true)
    // Undo the new edit: back to the exported image.
    state = run(state, 'undo')
    expect(hasUnexportedEdits(state)).toBe(false)
    // Undo past the export, then a different edit of the same depth.
    state = run(click(run(state, 'undo'), 4, 1), 'delete-selection')
    expect(state.editDepth).toBe(afterExport.editDepth)
    expect(hasUnexportedEdits(state)).toBe(true)
  })

  it('is true after the exported Delete is made again with other edge amounts', () => {
    const state = exported(run(click(start(), 0, 0), 'delete-selection'))
    expect(hasUnexportedEdits(state)).toBe(false)
    const adjusted = accepted(state, adjustDeleteCommand(state, { cleanup: 1, feather: 0 }, images.create))
    expect(adjusted.editDepth).toBe(state.editDepth)
    expect(hasUnexportedEdits(adjusted)).toBe(true)
  })

  it('counts an export started before an edit as saving the image from before it', () => {
    const state = run(click(start(), 0, 0), 'delete-selection')
    const running = accepted(state, exportStartCommand(state, 31)!.action)
    // Edited while the file is written.
    const edited = run(click(running, 4, 1), 'delete-selection')
    const done = accepted(edited, { type: 'export-finished', id: 31 })
    expect(hasUnexportedEdits(done)).toBe(true)
    expect(hasUnexportedEdits(run(done, 'undo'))).toBe(false)
  })

  it('follows Auto Trim like any edit, and is cleared by opening another image', () => {
    let state = run(click(start(), 0, 0), 'delete-selection')
    state = accepted(state, autoTrimCommand(reduce(state, { type: 'auto-trim-padding-changed', padding: 0 }), images.create))
    expect(hasUnexportedEdits(state)).toBe(true)
    state = exported(state)
    expect(hasUnexportedEdits(state)).toBe(false)
    expect(state.lastExport).not.toBeNull()
    state = opened(picture(), state)
    expect(state.lastExport).toBeNull()
    expect(hasUnexportedEdits(state)).toBe(false)
  })

  it('treats an unedited image as having nothing to lose, exported or not', () => {
    const state = start()
    expect(hasUnexportedEdits(state)).toBe(false)
    expect(hasUnexportedEdits(exported(state))).toBe(false)
  })
})

describe('sameContent and isExportedContent', () => {
  it('holds the exported history entry weakly, so a dropped entry is never kept alive', () => {
    const state = exported(run(click(start(), 0, 0), 'delete-selection'))
    const saved = state.lastExport!
    expect(saved.entry).toBeInstanceOf(WeakRef)
    expect(saved.entry!.deref()).toBe(state.history.undo.at(-1))
    // An entry that is gone can never match the current one.
    const gone = { ...saved, entry: { deref: () => undefined } as unknown as WeakRef<never> }
    expect(isExportedContent(gone, currentContent(state))).toBe(false)
    expect(isExportedContent(saved, currentContent(state))).toBe(true)
    expect(isExportedContent(null, currentContent(state))).toBe(false)
    expect(isExportedContent(saved, null)).toBe(false)
  })

  it('does not keep the exported entry reachable once the history has discarded it', () => {
    const state = exported(run(click(start(), 0, 0), 'delete-selection'))
    const entry = state.history.undo.at(-1)!
    expect(reachable(state).objects.has(entry)).toBe(true)
    // Undo, then a new edit: the exported Delete is discarded from Redo.
    const later = run(click(run(state, 'undo'), 4, 1), 'delete-selection')
    expect(later.history.undo.includes(entry) || later.history.redo.includes(entry)).toBe(false)
    expect(later.lastExport).toBe(state.lastExport)
    expect(reachable(later).objects.has(entry)).toBe(false)
    for (const buffer of reachable(entry).buffers) expect(reachable(later).buffers.has(buffer)).toBe(false)
  })

  it('compares the document, edit depth and next Undo', () => {
    const state = run(click(start(), 0, 0), 'delete-selection')
    const content = currentContent(state)!
    expect(sameContent(content, { ...content })).toBe(true)
    expect(sameContent(content, { ...content, editDepth: 2 })).toBe(false)
    expect(sameContent(content, { ...content, documentId: content.documentId + 1 })).toBe(false)
    expect(sameContent(content, { ...content, entry: null })).toBe(false)
    expect(sameContent(null, null)).toBe(true)
    expect(sameContent(content, null)).toBe(false)
    expect(currentContent(initialEditorState)).toBeNull()
  })
})
