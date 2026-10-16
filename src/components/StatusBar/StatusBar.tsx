import { FitIcon, ZoomInIcon, ZoomOutIcon } from '../icons/icons'
import './StatusBar.css'

// Image info and zoom are placeholders until Phase 1; zoom controls stay disabled.
export function StatusBar() {
  return (
    <footer className="status-bar">
      <div className="status-bar__info">
        <span>No image</span>
        <span className="status-bar__divider" aria-hidden="true" />
        <span>Tool: None</span>
      </div>

      <div className="status-bar__zoom" role="group" aria-label="Zoom">
        <button type="button" className="button button--icon" disabled title="Zoom Out">
          <ZoomOutIcon />
          <span className="visually-hidden">Zoom Out</span>
        </button>
        <span className="status-bar__zoom-value">
          <span aria-hidden="true">N/A</span>
          <span className="visually-hidden">Zoom level unavailable</span>
        </span>
        <button type="button" className="button button--icon" disabled title="Zoom In">
          <ZoomInIcon />
          <span className="visually-hidden">Zoom In</span>
        </button>
        <button type="button" className="button" disabled title="Fit to Screen">
          <FitIcon />
          Fit
        </button>
      </div>
    </footer>
  )
}
