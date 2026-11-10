import { type Dispatch, type RefObject, useEffect } from 'react'
import { cropShortcut } from '../editor/cropCommands'
import type { EditAction } from '../editor/editCommands'
import type { EditorAction, EditorState } from '../editor/editorState'

/**
 * Enter applies and Escape cancels the Crop tool's rectangle (Phase 4), wherever focus is except
 * text fields and, for Enter, controls (cropShortcut). Nothing happens while `isBlocked()` (the
 * replace confirmation is open).
 *
 * The listener runs in the capture phase, before the window's other shortcut listeners, so an
 * Escape that cancels a crop is marked handled and does not also clear the selection.
 */
export function useCropCommands(
  stateRef: RefObject<EditorState>,
  dispatch: Dispatch<EditorAction>,
  isBlocked: () => boolean,
  runEditAction: (action: EditAction) => void,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = stateRef.current
      if (!state.document || state.activeTool !== 'crop' || isBlocked()) return
      const pending = state.crop.rect !== null || state.crop.drag !== null
      const shortcut = cropShortcut(event, pending)
      if (!shortcut) return
      event.preventDefault()
      if (shortcut === 'cancel') dispatch({ type: 'crop-cancelled' })
      // Apply Crop's own availability decides (editActionCommand): nothing for the whole image.
      else runEditAction('crop')
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [stateRef, dispatch, isBlocked, runEditAction])
}
