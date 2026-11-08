import type { EditNotice } from '../../editor/editorState'
import { editNoticeText } from '../../editor/editFeedback'
import { CloseIcon } from '../icons/icons'

interface EditNoticeMessageProps {
  notice: EditNotice
  onDismiss: () => void
}

/**
 * An edit outcome shown in the workspace as well as announced (isShownEditNotice): Auto Trim with
 * nothing to trim, or one that pushed older Undo steps out of the history. Informational and
 * dismissible, in the style of the import notices; nothing has gone wrong. Give it a new key for
 * each outcome so a repeated one is announced again.
 */
export function EditNoticeMessage({ notice, onDismiss }: EditNoticeMessageProps) {
  return (
    <div className="workspace-message">
      <p className="workspace-message__text">{editNoticeText(notice)}</p>
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
