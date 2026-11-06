import { useId, useLayoutEffect, useRef } from 'react'
import type { ImageSource } from '../../editor/types'
import './DiscardEditsDialog.css'

interface DiscardEditsDialogProps {
  /** The image that would be opened. */
  imageName: string
  source: ImageSource
  /** Keep the current image, its edits and history. Also Escape. */
  onCancel: () => void
  /** Open the new image, discarding the current one's edits and history. */
  onContinue: () => void
}

/**
 * Asks before an image with unexported edits is replaced (P3-D12). A modal dialog
 * (showModal): the rest of the page is inert, focus starts on Cancel, Escape cancels, and focus
 * returns to where it was when the dialog closes.
 *
 * `onCancel` should keep its identity: the dialog is opened again when it changes.
 */
export function DiscardEditsDialog({ imageName, source, onCancel, onContinue }: DiscardEditsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const textId = useId()

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    cancelRef.current?.focus()
    // Escape: answered here, so the dialog is closed by unmounting like any other answer.
    const handleCancel = (event: Event) => {
      event.preventDefault()
      onCancel()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      // Closing while still in the page lets the browser return focus to where it was. This also
      // runs for React Strict Mode's extra clean-up, after which the effect opens it again.
      if (dialog.open) dialog.close()
    }
  }, [onCancel])

  const incoming = source === 'paste' ? 'the pasted image' : `“${imageName}”`

  return (
    <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={textId}>
      <h2 id={titleId} className="confirm-dialog__title">
        Discard unexported edits?
      </h2>
      <p id={textId} className="confirm-dialog__text">
        The current image has edits that have not been exported. Opening {incoming} will replace it and discard
        those edits and its Undo history.
      </p>
      <div className="confirm-dialog__actions">
        <button ref={cancelRef} type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button confirm-dialog__continue" onClick={onContinue}>
          Continue
        </button>
      </div>
    </dialog>
  )
}
