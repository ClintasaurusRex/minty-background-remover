import { CloseIcon } from '../icons/icons'

interface IgnoredFilesNoticeProps {
  count: number
  onDismiss: () => void
}

/** Tells the user that only one of several dropped files was opened. */
export function IgnoredFilesNotice({ count, onDismiss }: IgnoredFilesNoticeProps) {
  return (
    <div className="workspace-message">
      <p className="workspace-message__text">
        Only one image can be opened at a time, so {count === 1 ? '1 other file was' : `${count} other files were`}{' '}
        ignored.
      </p>
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
