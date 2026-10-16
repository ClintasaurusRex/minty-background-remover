import { MAX_ZOOM, MIN_ZOOM } from '../../canvas/viewport'
import { formatDimensions, formatFileSize, formatLabel, formatZoom } from '../../editor/documentInfo'
import type { ImageDocument } from '../../editor/types'
import { FitIcon, ZoomInIcon, ZoomOutIcon } from '../icons/icons'
import './StatusBar.css'

interface StatusBarProps {
  document: ImageDocument | null
  /** Current zoom (1 = 100%), or null when no image is shown. Zoom controls are disabled then. */
  zoom: number | null
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onActualSize: () => void
}

export function StatusBar({ document, zoom, onZoomIn, onZoomOut, onFit, onActualSize }: StatusBarProps) {
  const zoomText = zoom === null ? null : formatZoom(zoom)

  return (
    <footer className="status-bar">
      <div className="status-bar__info">
        {document ? (
          <>
            <span className="status-bar__name" title={document.name}>
              {document.name}
            </span>
            <span className="status-bar__divider" aria-hidden="true" />
            <span>{formatDimensions(document.width, document.height)}</span>
            <span className="status-bar__divider" aria-hidden="true" />
            <span>{formatLabel(document.format)}</span>
            <span className="status-bar__divider" aria-hidden="true" />
            <span>{formatFileSize(document.fileSizeBytes)}</span>
          </>
        ) : (
          <span>No image</span>
        )}
        <span className="status-bar__divider" aria-hidden="true" />
        <span>Tool: None</span>
      </div>

      <div className="status-bar__zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          className="button button--icon"
          disabled={zoom === null || zoom <= MIN_ZOOM}
          title="Zoom Out"
          onClick={onZoomOut}
        >
          <ZoomOutIcon />
          <span className="visually-hidden">Zoom Out</span>
        </button>
        <span className="status-bar__zoom-value">
          <span aria-hidden="true">{zoomText ?? 'N/A'}</span>
          <span className="visually-hidden">
            {zoomText ? `Zoom level ${zoomText}` : 'Zoom level unavailable'}
          </span>
        </span>
        <button
          type="button"
          className="button button--icon"
          disabled={zoom === null || zoom >= MAX_ZOOM}
          title="Zoom In"
          onClick={onZoomIn}
        >
          <ZoomInIcon />
          <span className="visually-hidden">Zoom In</span>
        </button>
        <button type="button" className="button" disabled={zoom === null} title="Fit to Screen" onClick={onFit}>
          <FitIcon />
          Fit
        </button>
        <button
          type="button"
          className="button"
          disabled={zoom === null}
          title="Actual Size (100%)"
          onClick={onActualSize}
        >
          <span aria-hidden="true">100%</span>
          <span className="visually-hidden">Actual Size, 100%</span>
        </button>
      </div>
    </footer>
  )
}
