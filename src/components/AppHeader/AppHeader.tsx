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
  /** Export's state: no image open, ready (with the suggested file name), or writing a file. */
  exportStatus: ExportStatus
  onExport: () => void
}

export type ExportStatus =
  /** No image is open. */
  | { readonly kind: 'unavailable' }
  /** An image is open, but another one is being opened to replace it. */
  | { readonly kind: 'importing' }
  | { readonly kind: 'ready'; readonly fileName: string }
  | { readonly kind: 'running' }

const EXPORT_TITLES: Readonly<Record<Exclude<ExportStatus['kind'], 'ready'>, string>> = {
  unavailable: 'Export — no image open',
  importing: 'Export — not available while another image is opening',
  running: 'Exporting the image as PNG…',
}

export function AppHeader({ onOpenImage, undo, redo, onUndo, onRedo, exportStatus, onExport }: AppHeaderProps) {
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

        <ExportButton status={exportStatus} onClick={onExport} />
      </div>
    </header>
  )
}

/**
 * Export as PNG. Unavailable (no image, another image opening, or an export being written), it is
 * aria-disabled rather than disabled, so keyboard focus stays on it while it shows "Exporting…" or
 * while an image opens. Its title, which says why, is also its accessible description. Its width
 * stays the same, so the header never shifts.
 */
function ExportButton({ status, onClick }: { status: ExportStatus; onClick: () => void }) {
  const title = status.kind === 'ready' ? `Export as PNG: ${status.fileName}` : EXPORT_TITLES[status.kind]
  return (
    <button
      type="button"
      className="button button--primary app-header__export"
      aria-disabled={status.kind !== 'ready'}
      title={title}
      onClick={() => {
        if (status.kind === 'ready') onClick()
      }}
    >
      <ExportIcon />
      {status.kind === 'running' ? 'Exporting…' : 'Export'}
    </button>
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
