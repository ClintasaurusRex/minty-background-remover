import { describe, expect, it } from 'vitest'
import { createImportError } from '../image/import/errors'
import type { ImportRequest, ImportResult } from '../image/import/importImage'
import { fakeImageData } from '../image/import/testFixtures'
import { type EditorAction, type EditorState, editorReducer, initialEditorState } from './editorState'
import { createImageDocument } from './imageDocument'
import { createImportRunner } from './importRunner'
import type { ImageDocument } from './types'

interface Deferred<T> {
  resolve: (value: T) => void
  reject: (cause: unknown) => void
}

interface FakeBitmap extends ImageBitmap {
  readonly documentName: string
  closed: boolean
}

function deferred<T>(list: Deferred<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    list.push({ resolve, reject })
  })
}

/**
 * A runner over the real reducer. Imports and bitmap creation finish only when told
 * to, or, with `immediateBitmaps`, bitmaps are created straight away.
 */
function setUp({ immediateBitmaps = true } = {}) {
  let state: EditorState = initialEditorState
  const actions: EditorAction[] = []
  const imports: Deferred<ImportResult>[] = []
  const bitmapRequests: Deferred<ImageBitmap>[] = []
  const bitmaps: FakeBitmap[] = []
  const makeBitmap = (document: ImageDocument): FakeBitmap => {
    const bitmap: FakeBitmap = {
      width: document.width,
      height: document.height,
      documentName: document.name,
      closed: false,
      close() {
        bitmap.closed = true
      },
    }
    bitmaps.push(bitmap)
    return bitmap
  }
  const start = createImportRunner(
    (action) => {
      actions.push(action)
      state = editorReducer(state, action)
    },
    () => deferred(imports),
    (document) => (immediateBitmaps ? Promise.resolve(makeBitmap(document)) : deferred(bitmapRequests)),
  )
  return { start, imports, bitmapRequests, bitmaps, makeBitmap, actions, getState: () => state }
}

/** Lets pending promise callbacks run, e.g. so bitmap creation has been requested. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function request(name: string): ImportRequest {
  return { blob: new Blob([]), name, source: 'file-picker' }
}

function documentNamed(name: string): ImageDocument {
  return createImageDocument({ name, format: 'png', source: 'file-picker', fileSizeBytes: 1, pixels: fakeImageData(2, 2) })
}

function success(name: string): ImportResult {
  return { ok: true, document: documentNamed(name) }
}

describe('createImportRunner', () => {
  it('reports the start and result of an import, with its bitmap', async () => {
    const { start, imports, bitmaps, actions, getState } = setUp()
    const done = start(request('a.png'))
    expect(getState().pendingImportId).toBe(1)
    imports[0].resolve(success('a.png'))
    await done
    expect(actions.map((action) => action.type)).toEqual(['import-started', 'import-finished'])
    expect(getState().document?.name).toBe('a.png')
    expect(getState().documentBitmap).toBe(bitmaps[0])
    expect(getState().pendingImportId).toBeNull()
  })

  it('keeps the newest import when an older one finishes last', async () => {
    const { start, imports, bitmaps, getState } = setUp()
    const first = start(request('older.png'))
    const second = start(request('newer.png'))
    imports[1].resolve(success('newer.png'))
    await second
    imports[0].resolve(success('older.png'))
    await first
    expect(getState().document?.name).toBe('newer.png')
    // No bitmap is created for the stale result.
    expect(bitmaps.map((bitmap) => bitmap.documentName)).toEqual(['newer.png'])
  })

  it('keeps the newest import when an older one finishes first', async () => {
    const { start, imports, getState } = setUp()
    const first = start(request('older.png'))
    const second = start(request('newer.png'))
    imports[0].resolve(success('older.png'))
    await first
    expect(getState().document).toBeNull()
    expect(getState().pendingImportId).toBe(2)
    imports[1].resolve(success('newer.png'))
    await second
    expect(getState().document?.name).toBe('newer.png')
  })

  it('does not let a stale failure show an error or clear the newer import', async () => {
    const { start, imports, getState } = setUp()
    const first = start(request('older.png'))
    const second = start(request('newer.png'))
    imports[0].resolve({ ok: false, error: createImportError('decode-failed') })
    await first
    expect(getState().importError).toBeNull()
    imports[1].resolve(success('newer.png'))
    await second
    expect(getState().document?.name).toBe('newer.png')
  })

  it('keeps the current document when a later import fails', async () => {
    const { start, imports, getState } = setUp()
    const first = start(request('good.png'))
    imports[0].resolve(success('good.png'))
    await first
    const opened = getState()
    const second = start(request('bad.png'))
    imports[1].resolve({ ok: false, error: createImportError('unsupported-format') })
    await second
    expect(getState().document).toBe(opened.document)
    expect(getState().documentBitmap).toBe(opened.documentBitmap)
    expect(getState().importError?.code).toBe('unsupported-format')
  })

  it('reports an import that throws as a failure', async () => {
    const { start, imports, getState } = setUp()
    const done = start(request('a.png'))
    imports[0].reject(new TypeError('boom'))
    await done
    expect(getState().importError).toMatchObject({ code: 'decode-failed', detail: 'TypeError: boom' })
    expect(getState().pendingImportId).toBeNull()
  })
})

describe('createImportRunner: bitmap creation', () => {
  it('reports a failed bitmap as a display failure and keeps the current image', async () => {
    const { start, imports, bitmapRequests, makeBitmap, getState } = setUp({ immediateBitmaps: false })
    const first = start(request('good.png'))
    imports[0].resolve(success('good.png'))
    await settle()
    bitmapRequests[0].resolve(makeBitmap(documentNamed('good.png')))
    await first
    const opened = getState()

    const second = start(request('huge.png'))
    imports[1].resolve(success('huge.png'))
    await settle()
    bitmapRequests[1].reject(new DOMException('Out of memory', 'InvalidStateError'))
    await second

    const state = getState()
    expect(state.importError).toMatchObject({ code: 'display-failed', detail: 'InvalidStateError: Out of memory' })
    expect(state.importError?.message).toMatch(/could not be displayed/)
    expect(state.document).toBe(opened.document)
    expect(state.documentBitmap).toBe(opened.documentBitmap)
    expect(state.viewport).toBe(opened.viewport)
    expect(state.pendingImportId).toBeNull()
  })

  it('reports a display failure when there is no current image', async () => {
    const { start, imports, bitmapRequests, getState } = setUp({ immediateBitmaps: false })
    const done = start(request('huge.png'))
    imports[0].resolve(success('huge.png'))
    await settle()
    bitmapRequests[0].reject(new Error('no memory'))
    await done
    expect(getState().document).toBeNull()
    expect(getState().importError?.code).toBe('display-failed')
  })

  it('stays busy until the bitmap is ready', async () => {
    const { start, imports, bitmapRequests, makeBitmap, getState } = setUp({ immediateBitmaps: false })
    const done = start(request('a.png'))
    imports[0].resolve(success('a.png'))
    await settle()
    expect(getState().pendingImportId).toBe(1)
    expect(getState().document).toBeNull()
    bitmapRequests[0].resolve(makeBitmap(documentNamed('a.png')))
    await done
    expect(getState().document?.name).toBe('a.png')
  })

  it('closes a bitmap that finishes after a newer import started', async () => {
    const { start, imports, bitmapRequests, makeBitmap, getState } = setUp({ immediateBitmaps: false })
    const first = start(request('older.png'))
    imports[0].resolve(success('older.png'))
    await settle()
    const second = start(request('newer.png'))
    const staleBitmap = makeBitmap(documentNamed('older.png'))
    bitmapRequests[0].resolve(staleBitmap)
    await first
    expect(staleBitmap.closed).toBe(true)
    expect(getState().document).toBeNull()
    expect(getState().pendingImportId).toBe(2)

    imports[1].resolve(success('newer.png'))
    await settle()
    bitmapRequests[1].resolve(makeBitmap(documentNamed('newer.png')))
    await second
    expect(getState().document?.name).toBe('newer.png')
  })

  it('ignores a bitmap failure after a newer import started', async () => {
    const { start, imports, bitmapRequests, getState } = setUp({ immediateBitmaps: false })
    const first = start(request('older.png'))
    imports[0].resolve(success('older.png'))
    await settle()
    start(request('newer.png'))
    bitmapRequests[0].reject(new Error('no memory'))
    await first
    expect(getState().importError).toBeNull()
    expect(getState().pendingImportId).toBe(2)
  })
})
