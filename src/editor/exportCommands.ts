import { type EditorAction, type EditorState, currentContent, isImporting } from './editorState'
import type { PixelBuffer } from './types'

/*
 * Export as PNG (FEATURE_SPEC.md §22; brought forward from Phase 6 by the project owner for the
 * first complete background-removal workflow). As with edits, the decision is made here from the
 * latest committed state; app/useExportCommand.ts writes the file (image/export/pngEncoder.ts) and
 * hands it to the browser, and the reducer records the outcome. Exporting never changes the image,
 * its selection or its history, and never writes to the file that was opened.
 */

/**
 * Whether Export can run now: an image is open, no other image is being opened and no other
 * export is being written.
 *
 * Not while another image opens (owner decision, Phase 3 audit corrections): the import is about to
 * replace the image, so a file started then would save an image that is no longer shown, and
 * possibly after the replace was confirmed because its edits had not been exported. Like the edit
 * actions (editCommands.ts, availableEditActions); the selection does not matter. An export that
 * was already running when the import started still finishes (editorState: `import-finished`).
 */
export function canExport(state: EditorState): boolean {
  return state.document !== null && state.exporting === null && !isImporting(state)
}

export interface ExportStart {
  /** Records the export as running (editorState: `export-started`). */
  readonly action: Extract<EditorAction, { readonly type: 'export-started' }>
  /**
   * The pixels to write: the open image's, as they are now. Buffers are never written once they
   * belong to a document (copy-on-write), so edits made while the export runs do not affect it.
   */
  readonly pixels: PixelBuffer
}

/**
 * Starts exporting the open image as export `id`, or null when Export is unavailable (canExport).
 * Computes nothing from the pixels: constant time.
 */
export function exportStartCommand(state: EditorState, id: number): ExportStart | null {
  const { document } = state
  const content = currentContent(state)
  if (!canExport(state) || !document || !content) return null
  return {
    action: { type: 'export-started', job: { id, fileName: exportFileName(document.name), content } },
    pixels: document.pixels,
  }
}

/** The suggested name's stem is cut to this many characters, so that whole names stay short. */
const MAX_STEM_LENGTH = 200

/**
 * The suggested file name for exporting the image opened as `name`: its name without the
 * extension, followed by "-cleaned.png" (PROJECT_BRIEF.md, Export): "pump-station.jpg" becomes
 * "pump-station-cleaned.png". It always differs from the opened file's name, also ignoring case
 * (as Windows and macOS do), so the original is never overwritten by accepting the suggestion.
 *
 * Characters that Windows or Linux do not allow in file names (and control characters) become "_";
 * spaces and dots at either end are dropped (a leading dot would make a hidden file on Linux).
 * Without anything left, the stem is "image".
 *
 * Long stems are cut to MAX_STEM_LENGTH characters. Cutting can give back the opened name: a
 * 200-character stem followed by "-cleaned.png" loses exactly its "-cleaned" (Phase 3 audit). The
 * stem is then cut by one more character, which makes the suggestion shorter than the opened name.
 */
export function exportFileName(name: string): string {
  const base = name.replace(/^.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  // A leading dot starts a name (".png" is a name, not an extension).
  const stem = dot > 0 ? base.slice(0, dot) : base
  let characters = Array.from(
    stem
      // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
      .replace(/^[\s.]+|[\s.]+$/g, ''),
  ).slice(0, MAX_STEM_LENGTH)
  let fileName = cleanedName(characters)
  while (characters.length > 0 && sameFileName(fileName, base)) {
    characters = characters.slice(0, -1)
    fileName = cleanedName(characters)
  }
  return fileName
}

function cleanedName(stemCharacters: readonly string[]): string {
  // Cutting can leave spaces or dots at the end again.
  const stem = stemCharacters.join('').replace(/[\s.]+$/, '')
  return `${stem || 'image'}-cleaned.png`
}

/** Whether two file names would name the same file on a file system that ignores case. */
function sameFileName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
