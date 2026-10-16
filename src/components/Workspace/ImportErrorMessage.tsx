import type { ImportError } from '../../image/import/errors'
import { AlertIcon, CloseIcon } from '../icons/icons'

interface ImportErrorMessageProps {
  error: ImportError
  onDismiss: () => void
}

/** A dismissible import failure message. The current image, if any, stays open. */
export function ImportErrorMessage({ error, onDismiss }: ImportErrorMessageProps) {
  return (
    <div className="workspace-message workspace-message--error" role="alert">
      <AlertIcon className="workspace-message__icon" />
      <p className="workspace-message__text">{error.message}</p>
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
