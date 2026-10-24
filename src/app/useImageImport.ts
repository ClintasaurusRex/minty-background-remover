import { type ChangeEvent, type Dispatch, useCallback, useEffect, useRef, useState } from 'react'
import type { EditorAction } from '../editor/editorState'
import { createImportRunner } from '../editor/importRunner'
import { createImportSources } from '../editor/importSources'
import { createBrowserDecoder } from '../image/import/browserDecoder'
import { choosePastedImage, pastedImageName } from '../image/import/clipboardImage'
import { chooseDroppedFile } from '../image/import/droppedFiles'
import { importImage } from '../image/import/importImage'
import { installPasteHandler } from './clipboardPaste'

/**
 * Hints for the file picker only. The format is always identified from the file's
 * content, so a mislabelled file is still opened or rejected correctly.
 */
export const IMAGE_FILE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg'

const decoder = createBrowserDecoder()

/** The Open Image file picker and its Ctrl+O shortcut, dropped files, and Ctrl+V paste. */
export function useImageImport(dispatch: Dispatch<EditorAction>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [startImport] = useState(() =>
    createImportRunner(
      dispatch,
      (request, signal) => importImage(request, { decoder, signal }),
      (document) => createImageBitmap(document.pixels),
    ),
  )
  const [sources] = useState(() =>
    createImportSources({
      startImport,
      dispatch,
      chooseDroppedFile,
      choosePastedImage,
      namePastedImage: ({ format }) => pastedImageName(format, new Date()),
    }),
  )

  const openFilePicker = useCallback(() => inputRef.current?.click(), [])

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      // Clear the selection so choosing the same file again still triggers a change.
      event.currentTarget.value = ''
      if (file) void sources.openPickedFile(file)
    },
    [sources],
  )

  const openDroppedFiles = useCallback(
    (files: readonly File[], skippedCount: number) => void sources.openDroppedFiles(files, skippedCount),
    [sources],
  )

  useEffect(
    () =>
      installPasteHandler(document, {
        onFiles: (files) => void sources.openPastedImages(files),
        onNoImage: () => void sources.openPastedImages([]),
      }),
    [sources],
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
