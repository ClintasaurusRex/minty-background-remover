import type { ImportNotice } from '../../editor/editorState'
import { CloseIcon } from '../icons/icons'

interface ImportNoticeMessageProps {
  notice: ImportNotice
  onDismiss: () => void
}

/** A dismissible informational message: quieter than an import error, in the same compact style. */
export function ImportNoticeMessage({ notice, onDismiss }: ImportNoticeMessageProps) {
  return (
    <div className="workspace-message">
      <p className="workspace-message__text">{noticeText(notice)}</p>
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

function noticeText(notice: ImportNotice): string {
  switch (notice.kind) {
    case 'ignored-files':
      return `Only one image can be opened at a time, so ${
        notice.count === 1 ? '1 other file was' : `${notice.count} other files were`
      } ignored.`
    case 'no-clipboard-image':
      return 'There is no image to paste. Copy a PNG, JPEG, WebP or SVG image, then press Ctrl+V.'
  }
}
