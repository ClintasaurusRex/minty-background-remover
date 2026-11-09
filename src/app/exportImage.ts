import type { EditorAction, EditorState } from '../editor/editorState'
import { exportStartCommand } from '../editor/exportCommands'
import { describeCause } from '../editor/historyCommands'
import type { PixelBuffer } from '../editor/types'

/*
 * Running an export (editor/exportCommands.ts): record it as started, write the PNG, hand it to the
 * browser to download, record the outcome. The steps that touch the browser are injected, so the
 * flow is tested with the real reducer in Node.
 */

export interface ExportTarget {
  /** The latest committed editor state. */
  readonly committedState: () => EditorState
  readonly dispatch: (action: EditorAction) => void
  /**
   * Runs `update` and commits its result before returning (flushSync), so a second click on Export
   * already finds this export running.
   */
  readonly flush: (update: () => void) => void
  /** Writes the PNG file (image/export/pngEncoder.ts). */
  readonly encode: (pixels: PixelBuffer) => Promise<Blob>
  /** Hands the file to the browser as a download named `fileName` (downloadFile.ts). */
  readonly download: (file: Blob, fileName: string) => void
}

/**
 * Exports the open image as export `id`. Does nothing when Export is unavailable (no image, or
 * another export running). A failure to write or download is recorded (`export-failed`) and shown;
 * it never rejects.
 */
export async function runExport(target: ExportTarget, id: number): Promise<void> {
  const start = exportStartCommand(target.committedState(), id)
  if (!start) return
  target.flush(() => target.dispatch(start.action))
  // The reducer refuses a start that no longer fits; then nothing runs.
  if (target.committedState().exporting?.id !== id) return
  try {
    const file = await target.encode(start.pixels)
    target.download(file, start.action.job.fileName)
  } catch (cause) {
    target.dispatch({ type: 'export-failed', id, detail: describeCause(cause) })
    return
  }
  target.dispatch({ type: 'export-finished', id })
}
