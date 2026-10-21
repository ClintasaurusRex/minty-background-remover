import { createImportError } from '../image/import/errors'
import type { DroppedFileChoice } from '../image/import/droppedFiles'
import type { ImportRequest } from '../image/import/importImage'
import type { EditorAction } from './editorState'
import type { ImportOptions } from './importRunner'

export interface DropImportDependencies {
  readonly chooseFile: (files: readonly File[]) => Promise<DroppedFileChoice | null>
  readonly startImport: (request: ImportRequest, options?: ImportOptions) => Promise<void>
  readonly dispatch: (action: EditorAction) => void
}

export interface DropImporter {
  /** Imports the first supported dropped file. `skippedCount` counts dropped folders. */
  readonly drop: (files: readonly File[], skippedCount: number) => Promise<void>
  /** Call when another import starts (e.g. from the file picker). */
  readonly supersede: () => void
}

/**
 * Opens dropped files through the normal import runner. Choosing the file reads a
 * few bytes of each, so a newer drop or file-picker import may start meanwhile; the
 * older drop is then abandoned, so the newest action always wins.
 */
export function createDropImporter({ chooseFile, startImport, dispatch }: DropImportDependencies): DropImporter {
  let latest = 0
  return {
    supersede: () => {
      latest++
    },
    drop: async (files, skippedCount) => {
      const operation = ++latest
      const choice = await chooseFile(files)
      if (operation !== latest) return
      if (!choice) {
        dispatch({
          type: 'import-rejected',
          error: createImportError('unsupported-format', skippedCount > 0 ? 'Only folders were dropped' : 'No files were dropped'),
        })
        return
      }
      await startImport(
        { blob: choice.file, name: choice.file.name, source: 'drop' },
        { ignoredFileCount: choice.ignoredCount + skippedCount },
      )
    },
  }
}
