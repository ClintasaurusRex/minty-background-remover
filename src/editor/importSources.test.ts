import { describe, expect, it } from 'vitest'
import type { PastedImageChoice } from '../image/import/clipboardImage'
import type { DroppedFileChoice } from '../image/import/droppedFiles'
import { createImportError } from '../image/import/errors'
import type { ImportRequest, ImportResult } from '../image/import/importImage'
import { fakeImageData } from '../image/import/testFixtures'
import { type EditorAction, type EditorState, editorReducer, initialEditorState } from './editorState'
import { createImageDocument } from './imageDocument'
import { type ImportOptions, createImportRunner } from './importRunner'
import { createImportSources } from './importSources'

/** Import sources whose file checks finish only when told to. */
function setUp() {
  const started: { request: ImportRequest; options?: ImportOptions }[] = []
  const actions: EditorAction[] = []
  const drops: ((choice: DroppedFileChoice | null) => void)[] = []
  const pastes: ((choice: PastedImageChoice | null) => void)[] = []
  const sources = createImportSources({
    startImport: async (request, options) => {
      started.push(options ? { request, options } : { request })
    },
    dispatch: (action) => actions.push(action),
    chooseDroppedFile: () => new Promise((resolve) => drops.push(resolve)),
    choosePastedImage: () => new Promise((resolve) => pastes.push(resolve)),
    namePastedImage: ({ format }) => `pasted.${format}`,
  })
  return { sources, started, actions, drops, pastes }
}

const file = (name: string) => new File(['x'], name)
const names = (started: { request: ImportRequest }[]) => started.map(({ request }) => `${request.source}:${request.name}`)

describe('createImportSources: file picker', () => {
  it('imports the picked file straight away', async () => {
    const { sources, started } = setUp()
    await sources.openPickedFile(file('a.png'))
    expect(names(started)).toEqual(['file-picker:a.png'])
  })
})

describe('createImportSources: drop', () => {
  it('imports the chosen file, reporting ignored files and folders', async () => {
    const { sources, started, drops } = setUp()
    const chosen = file('b.png')
    const done = sources.openDroppedFiles([file('a.txt'), chosen], 2)
    drops[0]({ file: chosen, ignoredCount: 1 })
    await done
    expect(started).toEqual([{ request: { blob: chosen, name: 'b.png', source: 'drop' }, options: { ignoredFileCount: 3 } }])
  })

  it('reports a drop with nothing to open as unsupported', async () => {
    const { sources, started, actions, drops } = setUp()
    const done = sources.openDroppedFiles([], 1)
    drops[0](null)
    await done
    expect(started).toEqual([])
    expect(actions).toEqual([
      { type: 'import-rejected', error: expect.objectContaining({ code: 'unsupported-format', detail: 'Only folders were dropped' }) },
    ])
  })
})

describe('createImportSources: paste', () => {
  it('imports a pasted image with a generated name and the paste source', async () => {
    const { sources, started, pastes } = setUp()
    const image = new Blob(['x'])
    const done = sources.openPastedImages([image])
    pastes[0]({ blob: image, format: 'webp' })
    await done
    expect(started).toEqual([{ request: { blob: image, name: 'pasted.webp', source: 'paste' } }])
  })

  it('shows a notice, not an error, for an empty clipboard or one without a supported image', async () => {
    const { sources, started, actions, pastes } = setUp()
    const empty = sources.openPastedImages([])
    pastes[0](null)
    await empty
    const unsupported = sources.openPastedImages([new Blob(['GIF89a'])])
    pastes[1](null)
    await unsupported
    expect(started).toEqual([])
    expect(actions).toEqual([
      { type: 'import-notice-shown', notice: { kind: 'no-clipboard-image' } },
      { type: 'import-notice-shown', notice: { kind: 'no-clipboard-image' } },
    ])
  })
})

describe('createImportSources: overlapping actions', () => {
  it('lets the newest drop win when an older one finishes choosing later', async () => {
    const { sources, started, drops } = setUp()
    const older = sources.openDroppedFiles([file('old.png')], 0)
    const newer = sources.openDroppedFiles([file('new.png')], 0)
    drops[1]({ file: file('new.png'), ignoredCount: 0 })
    await newer
    drops[0]({ file: file('old.png'), ignoredCount: 0 })
    await older
    expect(names(started)).toEqual(['drop:new.png'])
  })

  it('starts the newer action last when paste and drop overlap, so the runner keeps it', async () => {
    const { sources, started, drops, pastes } = setUp()
    // The older paste finishes checking first: it starts, then the newer drop starts
    // after it and supersedes it in the runner.
    const paste = sources.openPastedImages([new Blob(['x'])])
    const drop = sources.openDroppedFiles([file('dropped.png')], 0)
    pastes[0]({ blob: new Blob(['x']), format: 'png' })
    await paste
    drops[0]({ file: file('dropped.png'), ignoredCount: 0 })
    await drop
    expect(names(started)).toEqual(['paste:pasted.png', 'drop:dropped.png'])

    const drop2 = sources.openDroppedFiles([file('second.png')], 0)
    const paste2 = sources.openPastedImages([new Blob(['x'])])
    pastes[1]({ blob: new Blob(['x']), format: 'png' })
    await paste2
    // The newer paste has started importing, so the older drop is abandoned.
    drops[1]({ file: file('second.png'), ignoredCount: 0 })
    await drop2
    expect(names(started)).toEqual(['paste:pasted.png', 'drop:dropped.png', 'paste:pasted.png'])
  })

  it('abandons a paste or drop when a file is picked meanwhile', async () => {
    const { sources, started, drops, pastes } = setUp()
    const paste = sources.openPastedImages([new Blob(['x'])])
    const drop = sources.openDroppedFiles([file('dropped.png')], 0)
    await sources.openPickedFile(file('picked.png'))
    pastes[0]({ blob: new Blob(['x']), format: 'png' })
    drops[0]({ file: file('dropped.png'), ignoredCount: 0 })
    await Promise.all([paste, drop])
    expect(names(started)).toEqual(['file-picker:picked.png'])
  })

  it('never lets an unusable paste cancel a drop still being checked', async () => {
    const { sources, started, drops, pastes } = setUp()
    const drop = sources.openDroppedFiles([file('valid.png')], 0)
    const paste = sources.openPastedImages([])
    pastes[0](null)
    await paste
    drops[0]({ file: file('valid.png'), ignoredCount: 0 })
    await drop
    expect(names(started)).toEqual(['drop:valid.png'])
  })

  it('never lets a folder-only drop cancel a paste still being checked', async () => {
    const { sources, started, drops, pastes } = setUp()
    const paste = sources.openPastedImages([new Blob(['x'])])
    const drop = sources.openDroppedFiles([], 1)
    drops[0](null)
    await drop
    pastes[0]({ blob: new Blob(['x']), format: 'png' })
    await paste
    expect(names(started)).toEqual(['paste:pasted.png'])
  })

  it('still lets a newer usable paste beat an older drop', async () => {
    const { sources, started, drops, pastes } = setUp()
    const drop = sources.openDroppedFiles([file('older.png')], 0)
    const paste = sources.openPastedImages([new Blob(['x'])])
    pastes[0]({ blob: new Blob(['x']), format: 'png' })
    await paste
    drops[0]({ file: file('older.png'), ignoredCount: 0 })
    await drop
    expect(names(started)).toEqual(['paste:pasted.png'])
  })

  it('does not report an empty clipboard if a newer action started meanwhile', async () => {
    const { sources, actions, pastes } = setUp()
    const paste = sources.openPastedImages([])
    await sources.openPickedFile(file('picked.png'))
    pastes[0](null)
    await paste
    expect(actions).toEqual([])
  })
})

describe('createImportSources with the import runner and editor state', () => {
  it('replaces an open image with a pasted one, and keeps it when a paste fails or has no image', async () => {
    let state: EditorState = reduceAll(initialEditorState, [
      { type: 'workspace-resized', workspace: { size: { width: 1000, height: 600 }, devicePixelRatio: 1 } },
    ])
    const dispatch = (action: EditorAction) => {
      state = editorReducer(state, action)
    }
    const runImport = async (request: ImportRequest): Promise<ImportResult> =>
      request.name.includes('broken')
        ? { ok: false, error: createImportError('decode-failed') }
        : {
            ok: true,
            document: createImageDocument({
              name: request.name,
              format: 'png',
              source: request.source,
              fileSizeBytes: request.blob.size,
              pixels: fakeImageData(4, 3),
            }),
          }
    const startImport = createImportRunner(dispatch, runImport, async (document) => ({
      width: document.width,
      height: document.height,
      close: () => {},
    }))
    let pasteName = 'pasted.png'
    const sources = createImportSources({
      startImport,
      dispatch,
      chooseDroppedFile: async (files) => (files[0] ? { file: files[0], ignoredCount: 0 } : null),
      choosePastedImage: async (blobs) => (blobs[0] ? { blob: blobs[0], format: 'png' } : null),
      namePastedImage: () => pasteName,
    })

    await sources.openPickedFile(file('original.png'))
    expect(state.document?.name).toBe('original.png')

    await sources.openPastedImages([new Blob(['x'])])
    expect(state.document).toMatchObject({ name: 'pasted.png', source: 'paste' })
    const pasted = state.document

    pasteName = 'broken.png'
    await sources.openPastedImages([new Blob(['x'])])
    expect(state.document).toBe(pasted)
    expect(state.importError?.code).toBe('decode-failed')

    await sources.openPastedImages([])
    expect(state.document).toBe(pasted)
    expect(state.importNotice).toEqual({ kind: 'no-clipboard-image' })
  })

  it('lets a valid import already running finish when an empty paste happens', async () => {
    let state: EditorState = initialEditorState
    const dispatch = (action: EditorAction) => {
      state = editorReducer(state, action)
    }
    let finishImport: (result: ImportResult) => void = () => {}
    const startImport = createImportRunner(
      dispatch,
      () => new Promise<ImportResult>((resolve) => (finishImport = resolve)),
      async (document) => ({ width: document.width, height: document.height, close: () => {} }),
    )
    const sources = createImportSources({
      startImport,
      dispatch,
      chooseDroppedFile: async () => null,
      choosePastedImage: async () => null,
      namePastedImage: () => 'unused',
    })
    const picked = sources.openPickedFile(file('large.png'))
    await sources.openPastedImages([])
    expect(state.importNotice).toEqual({ kind: 'no-clipboard-image' })
    expect(state.pendingImportId).not.toBeNull()
    finishImport({
      ok: true,
      document: createImageDocument({ name: 'large.png', format: 'png', source: 'file-picker', fileSizeBytes: 1, pixels: fakeImageData(4, 3) }),
    })
    await picked
    expect(state.document?.name).toBe('large.png')
    expect(state.importError).toBeNull()
  })
})

function reduceAll(state: EditorState, actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state)
}
