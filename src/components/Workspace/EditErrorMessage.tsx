import type { EditError } from '../../editor/editorState'
import { editErrorMessage } from '../../editor/editFeedback'
import { AlertIcon, CloseIcon } from '../icons/icons'

interface EditErrorMessageProps {
  error: EditError
  onDismiss: () => void
}

/**
 * A dismissible message for a failed edit, Undo or Redo, in the style of import errors. Nothing
 * changed when it is shown. Give it a new key for each failure so a repeated one is announced
 * again.
 */
export function EditErrorMessage({ error, onDismiss }: EditErrorMessageProps) {
  return (
    <div className="workspace-message workspace-message--error" role="alert">
      <AlertIcon className="workspace-message__icon" />
      <p className="workspace-message__text">{editErrorMessage(error)}</p>
      <button
        type="button"
        className="button button--icon workspace-message__dismiss"
        title="Dismiss"
        onClick={onDismiss}
      >
        <CloseIcon />
        <span className="visually-hidden">Dismiss message</span>
      </button>
    </div>
  )
}
