import type { ReactNode } from 'react'
import { editName } from '../../editor/editFeedback'
import type { EditKind } from '../../editor/history/historyEntry'
import { ExportIcon, LogoIcon, OpenIcon, RedoIcon, UndoIcon } from '../icons/icons'
import './AppHeader.css'

interface AppHeaderProps {
  onOpenImage: () => void
  /** The edit Undo would undo, or null when there is nothing to undo. */
  undo: EditKind | null
  /** The edit Redo would redo, or null when there is nothing to redo. */
  redo: EditKind | null
  onUndo: () => void
  onRedo: () => void
}

// Export is a placeholder until its phase and stays disabled.
export function AppHeader({ onOpenImage, undo, redo, onUndo, onRedo }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <LogoIcon className="app-header__logo" />
        <h1 className="app-header__title">
          Minty <span className="app-header__subtitle">Background Remover</span>
        </h1>
      </div>

      <div className="app-header__actions" role="group" aria-label="File and history">
        <button
          type="button"
          className="button"
          title="Open Image (Ctrl+O)"
          aria-keyshortcuts="Control+O"
          onClick={onOpenImage}
        >
          <OpenIcon />
          Open Image
        </button>

        <span className="app-header__divider" aria-hidden="true" />

        <HistoryButton
          verb="Undo"
          edit={undo}
          shortcut="Ctrl+Z"
          keyShortcuts="Control+Z"
          unavailable="nothing to undo"
          icon={<UndoIcon />}
          onClick={onUndo}
        />
        <HistoryButton
          verb="Redo"
          edit={redo}
          shortcut="Ctrl+Y or Ctrl+Shift+Z"
          keyShortcuts="Control+Y Control+Shift+Z"
          unavailable="nothing to redo"
          icon={<RedoIcon />}
          onClick={onRedo}
        />

        <span className="app-header__divider" aria-hidden="true" />

        <button type="button" className="button button--primary" disabled title="Export">
          <ExportIcon />
          Export
        </button>
      </div>
    </header>
  )
}

/**
 * Undo or Redo. Its name says which edit it would undo or redo ("Undo Delete Selection").
 * Unavailable, it is aria-disabled rather than disabled, so keyboard focus stays on it when the
 * last edit has been undone (as for the selection actions).
 */
function HistoryButton({
  verb,
  edit,
  shortcut,
  keyShortcuts,
  unavailable,
  icon,
  onClick,
}: {
  verb: string
  edit: EditKind | null
  shortcut: string
  keyShortcuts: string
  unavailable: string
  icon: ReactNode
  onClick: () => void
}) {
  const name = edit ? `${verb} ${editName(edit)}` : verb
  return (
    <button
      type="button"
      className="button button--icon"
      aria-disabled={edit === null}
      aria-keyshortcuts={keyShortcuts}
      title={edit ? `${name} (${shortcut})` : `${verb} (${shortcut}) — ${unavailable}`}
      onClick={() => {
        if (edit) onClick()
      }}
    >
      {icon}
      <span className="visually-hidden">{name}</span>
    </button>
  )
}
