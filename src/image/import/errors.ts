export const IMPORT_ERROR_CODES = [
  'unsupported-format',
  'file-too-large',
  'dimensions-too-large',
  'decode-failed',
  'svg-size-unknown',
  'svg-unsupported-content',
  'svg-render-blocked',
  'display-failed',
  'no-image-in-clipboard',
  'read-failed',
] as const

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number]

export interface ImportError {
  readonly code: ImportErrorCode
  /** User-facing explanation. */
  readonly message: string
  /** Developer-facing specifics (sizes, causes). Not intended for display. */
  readonly detail?: string
}

/** User-facing messages. The limits quoted match DEFAULT_IMPORT_LIMITS. */
export const IMPORT_ERROR_MESSAGES: Readonly<Record<ImportErrorCode, string>> = {
  'unsupported-format':
    'The selected file type is not supported. Open a PNG, JPEG, WebP or SVG image.',
  'file-too-large': 'This file is too large to open. The maximum file size is 50 MB.',
  'dimensions-too-large':
    'The image is too large to process safely. Images can be up to 16,384 pixels wide or tall and 50 megapixels in total.',
  'decode-failed': 'This image could not be opened. The file may be damaged or incomplete.',
  'svg-size-unknown':
    'This SVG could not be opened because it does not specify a usable size. Give it a width and height, or a viewBox.',
  'svg-unsupported-content':
    'This SVG could not be opened because it contains content that cannot be imported safely, such as scripts, embedded web content or links to other files.',
  'svg-render-blocked':
    'This SVG could not be opened because the browser does not allow its content to be converted to an image.',
  'display-failed':
    'This image was read but could not be displayed. There may not be enough memory available. Try closing other tabs or opening a smaller image.',
  'no-image-in-clipboard':
    'The clipboard does not contain a supported image. Copy a PNG, JPEG, WebP or SVG image and try again.',
  'read-failed': 'The file could not be read. It may have been moved, deleted or be unavailable.',
}

export function createImportError(code: ImportErrorCode, detail?: string): ImportError {
  return detail === undefined
    ? { code, message: IMPORT_ERROR_MESSAGES[code] }
    : { code, message: IMPORT_ERROR_MESSAGES[code], detail }
}

/** Thrown by import stages (such as decoders) to report a specific import error. */
export class ImportFailure extends Error {
  readonly importError: ImportError

  constructor(importError: ImportError) {
    super(importError.detail ?? importError.message)
    this.name = 'ImportFailure'
    this.importError = importError
  }
}

/**
 * Converts anything thrown during import into an ImportError: an ImportFailure keeps
 * its own error, and anything else becomes `fallback` with the cause as detail.
 */
export function toImportError(cause: unknown, fallback: ImportErrorCode): ImportError {
  if (cause instanceof ImportFailure) return cause.importError
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
  return createImportError(fallback, detail)
}
