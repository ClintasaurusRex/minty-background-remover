import { type Dispatch, type RefObject, useEffect } from 'react'
import type { EditorAction, EditorState } from '../editor/editorState'
import { clearSelectionCommand, selectAllCommand, selectionShortcut } from '../editor/selectionCommands'

/**
 * Ctrl + A selects all and Escape clears the selection, wherever focus is except in text
 * fields. Without an open image the keys keep their usual browser behaviour, and nothing
 * happens while `isBlocked()` (a confirmation dialog is open: Escape belongs to it).
 *
 * `stateRef` holds the latest committed editor state, so a key press always works from
 * the current image and selection.
 */
export function useSelectionShortcuts(
  stateRef: RefObject<EditorState>,
  dispatch: Dispatch<EditorAction>,
  isBlocked: () => boolean,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = selectionShortcut(event)
      const state = stateRef.current
      if (!shortcut || !state.document || isBlocked()) return
      // Ctrl + A would otherwise select the page's text.
      event.preventDefault()
      const action = shortcut === 'select-all' ? selectAllCommand(state) : clearSelectionCommand(state)
      if (action) dispatch(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stateRef, dispatch, isBlocked])
}
