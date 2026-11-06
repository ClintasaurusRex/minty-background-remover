import { createImportError } from '../image/import/errors'
import type { PastedImageChoice } from '../image/import/clipboardImage'
import type { DroppedFileChoice } from '../image/import/droppedFiles'
import type { ImportRequest } from '../image/import/importImage'
import type { EditorAction } from './editorState'
import type { ImportOptions } from './importRunner'

export interface ImportSourceDependencies {
  readonly startImport: (request: ImportRequest, options?: ImportOptions) => Promise<void>
  readonly dispatch: (action: EditorAction) => void
  readonly chooseDroppedFile: (files: readonly File[]) => Promise<DroppedFileChoice | null>
  readonly choosePastedImage: (blobs: readonly Blob[]) => Promise<PastedImageChoice | null>
  /** Names a pasted image. */
  readonly namePastedImage: (choice: PastedImageChoice) => string
  /**
   * Asked just before an import starts, for every source alike: whether the open image may be
   * replaced. True (or a promise of true) starts the import; false abandons it, keeping the open
   * image, its edits and history. Returning a boolean decides at once, so an import that needs no
   * confirmation starts exactly as before.
   */
  readonly confirmReplace: (request: ImportRequest) => boolean | Promise<boolean>
}

export interface ImportSources {
  readonly openPickedFile: (file: File) => Promise<void>
  /** Imports the first supported dropped file. `skippedCount` counts dropped folders. */
  readonly openDroppedFiles: (files: readonly File[], skippedCount: number) => Promise<void>
  /** Imports the first supported clipboard item, or reports that there is none. */
  readonly openPastedImages: (blobs: readonly Blob[]) => Promise<void>
}

/**
 * The ways an image can be opened: file picker, drop and paste. All go through the
 * normal import runner. Dropped and pasted items are checked (a few bytes each)
 * before the import starts, so another action may happen meanwhile.
 *
 * Every action takes a turn number when it begins. An action that is still being
 * checked is abandoned once a newer one has started importing, so the newest usable
 * action always wins whichever way the image arrived; the runner then does the same
 * for imports already in progress. An action with nothing usable (an empty
 * clipboard, only folders) never starts an import, so it never cancels another.
 *
 * Just before an action would start its import, confirmReplace decides whether the open
 * image may be replaced (it asks the user when the image has unexported edits). Only an
 * action that has something to open asks; one abandoned there leaves everything as it was.
 */
export function createImportSources({
  startImport,
  dispatch,
  chooseDroppedFile,
  choosePastedImage,
  namePastedImage,
  confirmReplace,
}: ImportSourceDependencies): ImportSources {
  let lastTurn = 0
  /** The turn of the newest action that has started an import. */
  let importingTurn = 0
  const begin = () => {
    const turn = ++lastTurn
    const isCurrent = () => turn > importingTurn
    const start = (request: ImportRequest, options?: ImportOptions) => {
      importingTurn = turn
      return startImport(request, options)
    }
    return {
      /** False once a newer action has started importing. */
      isCurrent,
      /** Starts the import once confirmReplace allows it, unless a newer action started importing meanwhile. */
      startImport: async (request: ImportRequest, options?: ImportOptions) => {
        const allowed = confirmReplace(request)
        if (allowed === true) return start(request, options)
        if (allowed === false) return
        if ((await allowed) && isCurrent()) return start(request, options)
      },
    }
  }

  return {
    openPickedFile: (file) => begin().startImport({ blob: file, name: file.name, source: 'file-picker' }),

    openDroppedFiles: async (files, skippedCount) => {
      const turn = begin()
      const choice = await chooseDroppedFile(files)
      if (!turn.isCurrent()) return
      if (!choice) {
        const detail = skippedCount > 0 ? 'Only folders were dropped' : 'No files were dropped'
        dispatch({ type: 'import-rejected', error: createImportError('unsupported-format', detail) })
        return
      }
      await turn.startImport(
        { blob: choice.file, name: choice.file.name, source: 'drop' },
        { ignoredFileCount: choice.ignoredCount + skippedCount },
      )
    },

    openPastedImages: async (blobs) => {
      const turn = begin()
      const choice = await choosePastedImage(blobs)
      if (!turn.isCurrent()) return
      if (!choice) {
        dispatch({ type: 'import-notice-shown', notice: { kind: 'no-clipboard-image' } })
        return
      }
      await turn.startImport({ blob: choice.blob, name: namePastedImage(choice), source: 'paste' })
    },
  }
}
