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
import { createReplaceConfirmation } from './replaceConfirmation'
import { editActionCommand, hasUnexportedEdits } from './editCommands'
import { documentVersion } from './editorState'
import { fakeDisplayImages } from './history/testFixtures'
import { createPixelBuffer } from '../image/pixelBuffer'
import { createSelectionMask } from '../image/selection/selectionMask'

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
    confirmReplace: () => true,
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
      confirmReplace: () => true,
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
      confirmReplace: () => true,
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

describe('createImportSources: replacing the open image (P3-D12)', () => {
  /** Sources whose confirmReplace records requests and answers when told to. */
  function asking() {
    const asked: ImportRequest[] = []
    const answers: ((replace: boolean) => void)[] = []
    const set = setUpWith((request) => {
      asked.push(request)
      return new Promise<boolean>((resolve) => answers.push(resolve))
    })
    return { ...set, asked, answers }
  }
  function setUpWith(confirmReplace: (request: ImportRequest) => boolean | Promise<boolean>) {
    const started: ImportRequest[] = []
    const actions: EditorAction[] = []
    const drops: ((choice: DroppedFileChoice | null) => void)[] = []
    const pastes: ((choice: PastedImageChoice | null) => void)[] = []
    const sources = createImportSources({
      startImport: async (request) => {
        started.push(request)
      },
      dispatch: (action) => actions.push(action),
      chooseDroppedFile: () => new Promise((resolve) => drops.push(resolve)),
      choosePastedImage: () => new Promise((resolve) => pastes.push(resolve)),
      namePastedImage: ({ format }) => `pasted.${format}`,
      confirmReplace,
    })
    return { sources, started, actions, drops, pastes }
  }

  it('asks just before each source would start, with the image it would open', async () => {
    const { sources, asked, answers, drops, pastes, started } = asking()
    const picked = sources.openPickedFile(file('a.png'))
    expect(asked.map((r) => `${r.source}:${r.name}`)).toEqual(['file-picker:a.png'])
    answers[0](false)
    await picked
    const dropped = sources.openDroppedFiles([file('b.png')], 0)
    expect(asked).toHaveLength(1)
    drops[0]({ file: file('b.png'), ignoredCount: 0 })
    await Promise.resolve()
    await Promise.resolve()
    expect(asked.map((r) => r.source)).toEqual(['file-picker', 'drop'])
    answers[1](false)
    await dropped
    const pasted = sources.openPastedImages([new Blob(['x'])])
    pastes[0]({ blob: new Blob(['x']), format: 'webp' })
    await Promise.resolve()
    await Promise.resolve()
    expect(asked.at(-1)).toMatchObject({ name: 'pasted.webp', source: 'paste' })
    answers[2](false)
    await pasted
    expect(started).toEqual([])
  })

  it('Continue starts the import with the same request and options', async () => {
    const { sources, answers, drops, started } = asking()
    const chosen = file('b.png')
    const dropped = sources.openDroppedFiles([chosen], 1)
    drops[0]({ file: chosen, ignoredCount: 2 })
    await Promise.resolve()
    await Promise.resolve()
    answers[0](true)
    await dropped
    expect(started).toEqual([{ blob: chosen, name: 'b.png', source: 'drop' }])
  })

  it('does not ask when there is nothing to open', async () => {
    const { sources, asked, drops, pastes, actions } = asking()
    const dropped = sources.openDroppedFiles([], 1)
    drops[0](null)
    await dropped
    const pasted = sources.openPastedImages([])
    pastes[0](null)
    await pasted
    expect(asked).toEqual([])
    expect(actions.map((a) => a.type)).toEqual(['import-rejected', 'import-notice-shown'])
  })

  it('abandons at once, for every source, when confirmReplace refuses straight away (a question is already open)', async () => {
    const { sources, started, drops, pastes, actions } = setUpWith(() => false)
    await sources.openPickedFile(file('a.png'))
    const dropped = sources.openDroppedFiles([file('b.png')], 0)
    drops[0]({ file: file('b.png'), ignoredCount: 0 })
    await dropped
    const pasted = sources.openPastedImages([new Blob(['x'])])
    pastes[0]({ blob: new Blob(['x']), format: 'png' })
    await pasted
    expect(started).toEqual([])
    expect(actions).toEqual([])
  })

  it('starts at once, synchronously, when no question is needed', () => {
    const { sources, started } = setUpWith(() => true)
    void sources.openPickedFile(file('a.png'))
    expect(started.map((r) => r.name)).toEqual(['a.png'])
  })

  it('abandons a confirmed import if a newer one started while asking', async () => {
    let first = true
    let answer: (replace: boolean) => void = () => {}
    const { sources, started } = setUpWith(() => {
      if (!first) return true
      first = false
      return new Promise<boolean>((resolve) => (answer = resolve))
    })
    const older = sources.openPickedFile(file('older.png'))
    await sources.openPickedFile(file('newer.png'))
    answer(true)
    await older
    expect(started.map((r) => r.name)).toEqual(['newer.png'])
  })

  it('with the editor: Cancel keeps an edited image; a failed import after Continue keeps it too; a successful one replaces it', async () => {
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
            // Opaque, so Delete changes them.
            document: createImageDocument({ name: request.name, format: 'png', source: request.source, fileSizeBytes: 1, pixels: createPixelBuffer(4, 3, new Uint8ClampedArray(48).fill(255)) }),
          }
    const startImport = createImportRunner(dispatch, runImport, async (document) => ({ width: document.width, height: document.height, close: () => {} }))
    const confirmation = createReplaceConfirmation()
    confirmation.setNeeded(() => hasUnexportedEdits(state))
    const sources = createImportSources({
      startImport,
      dispatch,
      chooseDroppedFile: async (files) => (files[0] ? { file: files[0], ignoredCount: 0 } : null),
      choosePastedImage: async (blobs) => (blobs[0] ? { blob: blobs[0], format: 'png' } : null),
      namePastedImage: () => 'pasted.png',
      confirmReplace: confirmation.confirmReplace,
    })

    // The first image and an unedited one open without a question.
    await sources.openPickedFile(file('first.png'))
    await sources.openPickedFile(file('second.png'))
    expect(confirmation.question()).toBeNull()
    expect(state.document?.name).toBe('second.png')

    // An edit.
    const selection = createSelectionMask(4, 3, new Uint8Array(12).fill(1))
    dispatch({ type: 'selection-applied', version: documentVersion(state)!, selection })
    dispatch(editActionCommand(state, 'delete-selection', fakeDisplayImages().create)!)
    expect(hasUnexportedEdits(state)).toBe(true)
    const edited = state

    // Cancel, for every source.
    for (const open of [
      () => sources.openPickedFile(file('third.png')),
      () => sources.openDroppedFiles([file('dropped.png')], 0),
      () => sources.openPastedImages([new Blob(['x'])]),
    ]) {
      const opening = open()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(confirmation.question()).not.toBeNull()
      confirmation.answer(false)
      await opening
      expect(state.document).toBe(edited.document)
      expect(state.history).toBe(edited.history)
      expect(state.pendingImportId).toBeNull()
    }

    // Continue with an image that fails to open: still the edited image and its history.
    const failing = sources.openPickedFile(file('broken.png'))
    confirmation.answer(true)
    await failing
    expect(state.importError?.code).toBe('decode-failed')
    expect(state.document).toBe(edited.document)
    expect(state.history).toBe(edited.history)
    expect(hasUnexportedEdits(state)).toBe(true)

    // Continue with an image that opens: replaced, history cleared.
    const replacing = sources.openPastedImages([new Blob(['x'])])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(confirmation.question()).toEqual({ name: 'pasted.png', source: 'paste' })
    confirmation.answer(true)
    await replacing
    expect(state.document?.name).toBe('pasted.png')
    expect(state.history.undo).toHaveLength(0)
    expect(hasUnexportedEdits(state)).toBe(false)
  })
})

function reduceAll(state: EditorState, actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state)
}
