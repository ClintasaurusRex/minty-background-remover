import { ExportIcon, LogoIcon, OpenIcon, RedoIcon, UndoIcon } from '../icons/icons'
import './AppHeader.css'

interface AppHeaderProps {
  onOpenImage: () => void
}

// History and export actions are placeholders until their phases and stay disabled.
export function AppHeader({ onOpenImage }: AppHeaderProps) {
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

        <button type="button" className="button button--icon" disabled title="Undo (Ctrl+Z)">
          <UndoIcon />
          <span className="visually-hidden">Undo</span>
        </button>
        <button type="button" className="button button--icon" disabled title="Redo (Ctrl+Y)">
          <RedoIcon />
          <span className="visually-hidden">Redo</span>
        </button>

        <span className="app-header__divider" aria-hidden="true" />

        <button type="button" className="button button--primary" disabled title="Export">
          <ExportIcon />
          Export
        </button>
      </div>
    </header>
  )
}
