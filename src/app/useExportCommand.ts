import { type Dispatch, type RefObject, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { EditorAction, EditorState } from '../editor/editorState'
import { encodePng } from '../image/export/pngEncoder'
import { downloadFile } from './downloadFile'
import { runExport } from './exportImage'

/**
 * Export as PNG: returns the function the Export button calls. `stateRef` holds the latest
 * committed editor state. Nothing runs while `isBlocked()` (a confirmation dialog is open).
 */
export function useExportCommand(
  stateRef: RefObject<EditorState>,
  dispatch: Dispatch<EditorAction>,
  isBlocked: () => boolean,
): () => void {
  const lastId = useRef(0)
  return useCallback(() => {
    if (isBlocked()) return
    const id = ++lastId.current
    void runExport(
      {
        committedState: () => stateRef.current,
        dispatch,
        flush: flushSync,
        encode: (pixels) => encodePng(pixels),
        download: downloadFile,
      },
      id,
    )
  }, [stateRef, dispatch, isBlocked])
}
