import { type Dispatch, type RefObject, useCallback, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { releaseDisplayImage } from '../canvas/displayImage'
import { type EditAction, editActionCommand, editShortcut } from '../editor/editCommands'
import type { EditorAction, EditorState } from '../editor/editorState'
import { dispatchEditAction } from './editDispatch'

/**
 * Delete Selection, Undo and Redo: returns the function the controls call, and handles the
 * Delete, Ctrl + Z, Ctrl + Y and Ctrl + Shift + Z shortcuts wherever focus is except in text
 * fields (editShortcut). Without an open image the keys keep their usual browser behaviour.
 *
 * `stateRef` holds the latest committed editor state, so every action is computed from the
 * current image, selection and history. Nothing runs while `isBlocked()` (a confirmation dialog
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
): (action: EditAction) => void {
  const run = useCallback(
    (action: EditAction) => {
      if (isBlocked()) return
      const editorAction = editActionCommand(stateRef.current, action)
      if (!editorAction) return
      dispatchEditAction(editorAction, {
        dispatch,
        flush: flushSync,
        committedState: () => stateRef.current,
        release: releaseDisplayImage,
      })
    },
    [stateRef, dispatch, isBlocked],
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

  return run
}
