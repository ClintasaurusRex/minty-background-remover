import { type ChangeEvent, type Dispatch, useCallback, useEffect, useRef, useState } from 'react'
import { createDropImporter } from '../editor/dropImport'
import type { EditorAction } from '../editor/editorState'
import { createImportRunner } from '../editor/importRunner'
import { createBrowserDecoder } from '../image/import/browserDecoder'
import { chooseDroppedFile } from '../image/import/droppedFiles'
import { importImage } from '../image/import/importImage'

/**
 * Hints for the file picker only. The format is always identified from the file's
 * content, so a mislabelled file is still opened or rejected correctly.
 */
export const IMAGE_FILE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg'

const decoder = createBrowserDecoder()

/** The Open Image file picker, its Ctrl+O shortcut, and dropped files. */
export function useImageImport(dispatch: Dispatch<EditorAction>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [startImport] = useState(() =>
    createImportRunner(
      dispatch,
      (request) => importImage(request, { decoder }),
      (document) => createImageBitmap(document.pixels),
    ),
  )
  const [dropImporter] = useState(() => createDropImporter({ chooseFile: chooseDroppedFile, startImport, dispatch }))

  const openFilePicker = useCallback(() => inputRef.current?.click(), [])

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      // Clear the selection so choosing the same file again still triggers a change.
      event.currentTarget.value = ''
      if (!file) return
      dropImporter.supersede()
      void startImport({ blob: file, name: file.name, source: 'file-picker' })
    },
    [startImport, dropImporter],
  )

  const openDroppedFiles = useCallback(
    (files: readonly File[], skippedCount: number) => void dropImporter.drop(files, skippedCount),
    [dropImporter],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOpenShortcut(event)) {
        event.preventDefault()
        if (!event.repeat) openFilePicker()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openFilePicker])

  return { inputRef, openFilePicker, handleFileChange, openDroppedFiles }
}

function isOpenShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'o'
}
