import { type ChangeEvent, type Dispatch, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { toImageData } from '../canvas/imageData'
import type { EditorAction } from '../editor/editorState'
import { createImportRunner } from '../editor/importRunner'
import { createImportSources } from '../editor/importSources'
import { createReplaceConfirmation } from '../editor/replaceConfirmation'
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

/**
 * The Open Image file picker and its Ctrl+O shortcut, dropped files, and Ctrl+V paste.
 *
 * Before an image replaces one with unexported edits (`hasUnexportedEdits()`, read just before
 * the import starts), the user is asked to confirm (P3-D12): `question` is the open question,
 * answered with `answerQuestion`. Only one is asked at a time. While it is open, Ctrl+O and
 * paste do nothing and other dropped images are not opened; `isConfirming()` lets other
 * shortcuts do the same.
 */
export function useImageImport(dispatch: Dispatch<EditorAction>, hasUnexportedEdits: () => boolean) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmation] = useState(createReplaceConfirmation)
  useLayoutEffect(() => confirmation.setNeeded(hasUnexportedEdits), [confirmation, hasUnexportedEdits])
  const question = useSyncExternalStore(confirmation.subscribe, confirmation.question)
  const isConfirming = useCallback(() => confirmation.question() !== null, [confirmation])

  const [startImport] = useState(() =>
    createImportRunner(
      // An import that starts is committed at once. Edit commands compute from the latest
      // committed state and are unavailable while an import runs, so no edit can slip in between
      // the decision to replace the image (confirmed, or not needed) and the import replacing it.
      // Drops and pastes start after a short asynchronous check, outside any event, where React
      // would otherwise leave the update pending until its next render.
      (action) => (action.type === 'import-started' ? flushSync(() => dispatch(action)) : dispatch(action)),
      (request, signal) => importImage(request, { decoder, signal }),
      (document) => createImageBitmap(toImageData(document.pixels)),
    ),
  )
  const [sources] = useState(() =>
    createImportSources({
      startImport,
      dispatch,
      chooseDroppedFile,
      choosePastedImage,
      namePastedImage: ({ format }) => pastedImageName(format, new Date()),
      confirmReplace: confirmation.confirmReplace,
    }),
  )

  const openFilePicker = useCallback(() => {
    if (!isConfirming()) inputRef.current?.click()
  }, [isConfirming])

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
        onFiles: (files) => {
          if (!isConfirming()) void sources.openPastedImages(files)
        },
        onNoImage: () => {
          if (!isConfirming()) void sources.openPastedImages([])
        },
      }),
    [sources, isConfirming],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isOpenShortcut(event)) {
        // Also while a confirmation is open, so the browser's own Open dialog never appears.
        event.preventDefault()
        if (!event.repeat) openFilePicker()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openFilePicker])

  return {
    inputRef,
    openFilePicker,
    handleFileChange,
    openDroppedFiles,
    question,
    answerQuestion: confirmation.answer,
    isConfirming,
  }
}

function isOpenShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'o'
}
