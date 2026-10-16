import { type ChangeEvent, type Dispatch, useCallback, useEffect, useRef, useState } from 'react'
import type { EditorAction } from '../editor/editorState'
import { createImportRunner } from '../editor/importRunner'
import { createBrowserDecoder } from '../image/import/browserDecoder'
import { importImage } from '../image/import/importImage'

/**
 * Hints for the file picker only. The format is always identified from the file's
 * content, so a mislabelled file is still opened or rejected correctly.
 */
export const IMAGE_FILE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg'

const decoder = createBrowserDecoder()

/** The Open Image file picker and its Ctrl+O shortcut. */
export function useImageImport(dispatch: Dispatch<EditorAction>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [startImport] = useState(() =>
    createImportRunner(
      dispatch,
      (request) => importImage(request, { decoder }),
      (document) => createImageBitmap(document.pixels),
    ),
  )

  const openFilePicker = useCallback(() => inputRef.current?.click(), [])

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0]
      // Clear the selection so choosing the same file again still triggers a change.
      event.currentTarget.value = ''
      if (file) void startImport({ blob: file, name: file.name, source: 'file-picker' })
    },
    [startImport],
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

  return { inputRef, openFilePicker, handleFileChange }
}

function isOpenShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'o'
}
