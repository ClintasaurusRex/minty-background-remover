import { isEditableTarget } from '../utils/domTargets'

/*
 * The native paste event (Ctrl+V), used instead of the asynchronous Clipboard API so
 * no permission prompt is needed. Only image data the browser provides as files is
 * used; HTML and URLs are ignored, so pasting never fetches anything.
 */

/** The parts of DataTransfer read here, so tests can provide plain objects. */
export interface ClipboardItemLike {
  readonly kind: string
  readonly type: string
  getAsFile(): File | null
}

export interface ClipboardDataLike {
  readonly items?: ArrayLike<ClipboardItemLike>
  readonly files?: ArrayLike<File>
}

/**
 * The file and image items on the clipboard, images first. Copying an image from a
 * browser typically also puts HTML (with the image's URL) and text on the
 * clipboard; those are not files and are skipped.
 */
export function clipboardFiles(data: ClipboardDataLike | null | undefined): File[] {
  if (!data) return []
  const files: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  if (files.length === 0) files.push(...Array.from(data.files ?? []))
  // Prefer items the browser says are images; content decides in the end either way.
  return [...files.filter(isImageType), ...files.filter((file) => !isImageType(file))]
}

function isImageType(file: File): boolean {
  return file.type.startsWith('image/')
}

export interface PasteHandlers {
  /** Image or file data was pasted; the browser's default paste has been prevented. */
  readonly onFiles: (files: File[]) => void
  /** Ctrl+V outside a text field with nothing usable on the clipboard. */
  readonly onNoImage: () => void
}

/**
 * Listens for paste anywhere in the document. Pastes into editable fields, and
 * pastes another handler has already taken, are left alone. The default action is
 * only prevented when files are being imported. Returns a function that removes the
 * listener.
 */
export function installPasteHandler(target: EventTarget, { onFiles, onNoImage }: PasteHandlers): () => void {
  const onPaste = (event: Event) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return
    const files = clipboardFiles((event as Partial<ClipboardEvent>).clipboardData)
    if (files.length === 0) {
      onNoImage()
      return
    }
    event.preventDefault()
    onFiles(files)
  }
  target.addEventListener('paste', onPaste)
  return () => target.removeEventListener('paste', onPaste)
}
