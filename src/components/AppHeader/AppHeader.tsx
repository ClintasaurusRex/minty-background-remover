import { ExportIcon, LogoIcon, OpenIcon, RedoIcon, UndoIcon } from '../icons/icons'
import './AppHeader.css'

// File and history actions are placeholders until their phases; all stay disabled.
export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <LogoIcon className="app-header__logo" />
        <h1 className="app-header__title">
          Minty <span className="app-header__subtitle">Background Remover</span>
        </h1>
      </div>

      <div className="app-header__actions" role="group" aria-label="File and history">
        <button type="button" className="button" disabled title="Open Image (Ctrl+O)">
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
