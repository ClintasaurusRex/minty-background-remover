import { toImportError } from '../image/import/errors'
import type { ImportRequest, ImportResult } from '../image/import/importImage'
import type { EditorAction, EditorImportResult } from './editorState'
import type { ImageDocument } from './types'

export type RunImport = (request: ImportRequest) => Promise<ImportResult>

export interface ImportOptions {
  /** Other dropped files that were not opened, reported to the user. */
  readonly ignoredFileCount?: number
}

/** Creates the drawable bitmap for a document, e.g. createImageBitmap(document.pixels). */
export type PrepareDisplay = (document: ImageDocument) => Promise<ImageBitmap>

/**
 * Starts imports and reports them to the editor state. Each import gets a new id,
 * and only the latest import is reported as finished, so imports may finish in any
 * order without an older one replacing a newer one.
 *
 * A successful import is only accepted once its bitmap has been created. If that
 * fails, the import fails, and the current image stays open.
 */
export function createImportRunner(
  dispatch: (action: EditorAction) => void,
  runImport: RunImport,
  prepareDisplay: PrepareDisplay,
): (request: ImportRequest, options?: ImportOptions) => Promise<void> {
  let lastImportId = 0
  return async (request, options = {}) => {
    const importId = ++lastImportId
    const isStale = () => importId !== lastImportId
    dispatch({ type: 'import-started', importId, ignoredFileCount: options.ignoredFileCount })

    let imported: ImportResult
    try {
      imported = await runImport(request)
    } catch (cause) {
      // importImage never throws; this guards other implementations.
      imported = { ok: false, error: toImportError(cause, 'decode-failed') }
    }
    // A newer import has started; its result is the one that counts.
    if (isStale()) return

    let result: EditorImportResult
    if (!imported.ok) {
      result = imported
    } else {
      try {
        const bitmap = await prepareDisplay(imported.document)
        if (isStale()) {
          bitmap.close()
          return
        }
        result = { ok: true, document: imported.document, bitmap }
      } catch (cause) {
        if (isStale()) return
        result = { ok: false, error: toImportError(cause, 'display-failed') }
      }
    }
    dispatch({ type: 'import-finished', importId, result })
  }
}
