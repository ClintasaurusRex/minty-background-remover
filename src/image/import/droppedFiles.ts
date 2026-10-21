import { FORMAT_SNIFF_BYTES, detectImageFormat } from './formats'

/*
 * Choosing which of several dropped files to open. Only one image can be open, so
 * the first file whose content is a supported image is chosen and the rest are
 * ignored. Formats are identified from content, as for every import.
 */

export interface DroppedFileChoice {
  readonly file: File
  /** How many other dropped items were not opened. */
  readonly ignoredCount: number
}

/** MIME types present on a drag that carries files (DataTransfer.types). */
const FILES_TYPE = 'Files'

/**
 * Whether a drag carries files from outside the page. Text, links and images dragged
 * from web pages without a file are not file drags and are left to the browser.
 */
export function isFileDrag(types: readonly string[] | null | undefined): boolean {
  return types?.includes(FILES_TYPE) ?? false
}

/**
 * The first file whose content is a supported image. If none is, the first file is
 * returned anyway so the import reports exactly why it cannot be opened. Returns
 * null when nothing was dropped. Files are checked in order and checking stops at
 * the first supported one, so only a few bytes of each are read.
 */
export async function chooseDroppedFile(
  files: readonly File[],
  isSupported: (file: Blob) => Promise<boolean> = hasSupportedContent,
): Promise<DroppedFileChoice | null> {
  if (files.length === 0) return null
  const ignoredCount = files.length - 1
  for (const file of files) {
    if (await isSupported(file)) return { file, ignoredCount }
  }
  return { file: files[0], ignoredCount }
}

/** Whether the start of a file is a supported image signature. Unreadable files are not. */
export async function hasSupportedContent(file: Blob): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, FORMAT_SNIFF_BYTES).arrayBuffer())
    return detectImageFormat(head) !== null
  } catch {
    return false
  }
}
