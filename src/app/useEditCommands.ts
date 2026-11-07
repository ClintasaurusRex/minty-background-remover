import { type Dispatch, type RefObject, useCallback, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { releaseDisplayImage } from '../canvas/displayImage'
import { type EditAction, adjustDeleteCommand, editActionCommand, editShortcut } from '../editor/editCommands'
import { type EditorAction, type EditorState, mergeEdgeSettings } from '../editor/editorState'
import type { EdgeSettings } from '../image/edit/deleteWithEdges'
import { type EditDispatch, dispatchEditAction } from './editDispatch'

export interface EditCommands {
  /** Delete Selection, Undo or Redo, as the controls and shortcuts run them. */
  readonly run: (action: EditAction) => void
  /**
   * A finished Edge cleanup or Feather adjustment (slider released, last key released, Enter,
   * leaving the control): sets the amount, and while the last Delete can still be adjusted makes
   * it again with the amounts now set (Phase 3 Step 9).
   */
  readonly commitEdgeSettings: (change: Partial<EdgeSettings>) => void
}

/**
 * Delete Selection, Undo and Redo: returns the functions the controls call, and handles the
 * Delete, Ctrl + Z, Ctrl + Y and Ctrl + Shift + Z shortcuts wherever focus is except in text
 * fields (editShortcut). Without an open image the keys keep their usual browser behaviour.
 *
 * `stateRef` holds the latest committed editor state, so every action is computed from the
 * current image, selection and history. No edit runs while `isBlocked()` (a confirmation dialog
 * is open).
 *
 * Each action is committed before the handler returns (dispatchEditAction), so a second key
 * press or click always computes from the state the first produced: pressing Delete twice
 * deletes once (the selection is gone), and two Undos undo two edits.
 */
export function useEditCommands(
  stateRef: RefObject<EditorState>,
  dispatch: Dispatch<EditorAction>,
  isBlocked: () => boolean,
): EditCommands {
  const send = useCallback(
    (editorAction: EditorAction) => {
      const target: EditDispatch = {
        dispatch,
        flush: flushSync,
        committedState: () => stateRef.current,
        release: releaseDisplayImage,
      }
      dispatchEditAction(editorAction, target)
    },
    [stateRef, dispatch],
  )

  const run = useCallback(
    (action: EditAction) => {
      if (isBlocked()) return
      const editorAction = editActionCommand(stateRef.current, action)
      if (editorAction) send(editorAction)
    },
    [stateRef, isBlocked, send],
  )

  const commitEdgeSettings = useCallback(
    (change: Partial<EdgeSettings>) => {
      const state = stateRef.current
      // The amount is always set, as for the next Delete.
      dispatch({ type: 'edge-settings-changed', settings: change })
      // Never while the replace confirmation is open: opening it moves focus out of a field being
      // edited, which commits that field, and nothing may change the image while the question is
      // asked. (While another image is opening, adjustDeleteCommand finds nothing to adjust.)
      if (isBlocked()) return
      // Computed from the committed state with the full amounts as they will be: the one just
      // committed, and the other control's, which is not being adjusted.
      const editorAction = adjustDeleteCommand(state, mergeEdgeSettings(state.edgeSettings, change))
      if (editorAction) send(editorAction)
    },
    [stateRef, dispatch, isBlocked, send],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = editShortcut(event)
      if (!action || !stateRef.current.document || isBlocked()) return
      // Ctrl + Z, Ctrl + Y and Ctrl + Shift + Z are taken over even when there is nothing to
      // undo or redo, as Ctrl + A is with everything selected.
      event.preventDefault()
      run(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stateRef, run, isBlocked])

  return { run, commitEdgeSettings }
}
