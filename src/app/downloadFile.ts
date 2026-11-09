/*
 * Handing an exported file to the browser as a download. The only browser-specific step of Export:
 * the browser decides where the file goes (the Downloads folder or a Save dialog, as the user has
 * set it up) and never replaces an existing file without asking; the opened file is never written.
 * The desktop application (Phase 7) is expected to replace this with a native Save dialog.
 */

/**
 * How long the file stays readable at its blob: URL after the download is started. Browsers read it
 * when the download begins (Firefox may first ask where to save it), so this only needs to cover
 * that.
 */
const URL_LIFETIME_MS = 60_000

/** Starts downloading `file` as `fileName`. */
export function downloadFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  // Firefox only follows links that are in the document.
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS)
  }
}
