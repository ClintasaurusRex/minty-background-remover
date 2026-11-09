import { useSyncExternalStore } from 'react'
import type { PointerPositionStore } from '../../app/pointerPosition'
import { pixelUnderPointer } from '../../canvas/coordinates'
import { MAX_ZOOM, MIN_ZOOM } from '../../canvas/viewport'
import {
  describeSelection,
  formatDimensions,
  formatFileSize,
  formatLabel,
  formatPixelPosition,
  formatSelection,
  formatZoom,
} from '../../editor/documentInfo'
import { TOOLS } from '../../editor/tools'
import type { ImageDocument, SelectionMask, ToolId, ViewportState } from '../../editor/types'
import { FitIcon, ZoomInIcon, ZoomOutIcon } from '../icons/icons'
import './StatusBar.css'

interface StatusBarProps {
  document: ImageDocument | null
  /** The display (snapped) viewport, or null when no image is shown. Zoom controls are disabled then. */
  viewport: ViewportState | null
  devicePixelRatio: number
  activeTool: ToolId | null
  selection: SelectionMask | null
  /**
   * Whether a finished change of Edge cleanup or Feather would update the last Delete (Phase 3
   * Step 9) rather than only set the next one: shown as a short note after the selection readout.
   */
  adjustsLastDelete?: boolean
  /** Whether the image has edits that have not been exported (hasUnexportedEdits): shown after its name. */
  unexportedEdits?: boolean
  pointer: PointerPositionStore
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onActualSize: () => void
}

export function StatusBar({
  document,
  viewport,
  devicePixelRatio,
  activeTool,
  selection,
  adjustsLastDelete = false,
  unexportedEdits = false,
  pointer,
  onZoomIn,
  onZoomOut,
  onFit,
  onActualSize,
}: StatusBarProps) {
  const zoom = viewport?.zoom ?? null
  const zoomText = zoom === null ? null : formatZoom(zoom)
  const toolLabel = TOOLS.find((tool) => tool.id === activeTool)?.label ?? 'None'

  return (
    <footer className="status-bar">
      <div className="status-bar__info">
        {document ? (
          <>
            <span className="status-bar__name" title={document.name}>
              {document.name}
            </span>
            {unexportedEdits && <UnexportedEditsNote />}
            <span className="status-bar__divider" aria-hidden="true" />
            <span>{formatDimensions(document.width, document.height)}</span>
            <span className="status-bar__divider status-bar__secondary" aria-hidden="true" />
            <span className="status-bar__secondary">{formatLabel(document.format)}</span>
            <span className="status-bar__divider status-bar__secondary" aria-hidden="true" />
            <span className="status-bar__secondary">{formatFileSize(document.fileSizeBytes)}</span>
          </>
        ) : (
          <span>No image</span>
        )}
        <span className="status-bar__divider status-bar__tool" aria-hidden="true" />
        <span className="status-bar__tool">Tool: {toolLabel}</span>
        {document && (
          <>
            <span className="status-bar__divider" aria-hidden="true" />
            {/* Announced when the selection changes, since it is not otherwise visible yet. */}
            <span role="status" title={describeSelection(selection)}>
              <span aria-hidden="true">{selection ? `Selection: ${formatSelection(selection)}` : 'No selection'}</span>
              <span className="visually-hidden">{describeSelection(selection)}</span>
            </span>
            {adjustsLastDelete && <LastDeleteNote />}
            <span className="status-bar__divider" aria-hidden="true" />
            {/* Last, so its changing width never moves the other items. */}
            <PointerPixel pointer={pointer} viewport={viewport} devicePixelRatio={devicePixelRatio} document={document} />
          </>
        )}
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

/**
 * The note that a finished change of Edge cleanup or Feather updates the last Delete (Phase 3
 * Step 9), with its divider. Text, not colour alone; not a live region, since the edit
 * announcements already say what happened.
 */
export function LastDeleteNote() {
  return (
    <>
      <span className="status-bar__divider status-bar__adjust" aria-hidden="true" />
      <span
        className="status-bar__adjust"
        title="Changing Edge cleanup or Feather now updates the last Delete. Select something to set them for the next Delete instead."
      >
        Edge settings update last Delete
      </span>
    </>
  )
}

/**
 * The note after the image's name that it has edits that have not been exported (hasUnexportedEdits).
 * Text, not colour alone; never hidden at narrow widths. Not a live region: Delete, Undo, Redo and
 * Export announce what happened.
 */
export function UnexportedEditsNote() {
  return (
    <span
      className="status-bar__unexported"
      title="This image has edits that have not been exported. Export saves them as a new PNG file."
    >
      Unexported edits
    </span>
  )
}

/**
 * The image pixel under the pointer. It subscribes to the pointer position itself, so
 * pointer movement re-renders only this readout. Not announced to assistive technology,
 * which would be overwhelming.
 */
function PointerPixel({
  pointer,
  viewport,
  devicePixelRatio,
  document,
}: {
  pointer: PointerPositionStore
  viewport: ViewportState | null
  devicePixelRatio: number
  document: ImageDocument
}) {
  const point = useSyncExternalStore(pointer.subscribe, pointer.get)
  const pixel = point && viewport ? pixelUnderPointer(viewport, point, document, devicePixelRatio) : null
  return (
    <span className="status-bar__pointer" title="Image pixel under the pointer (x, y)">
      Pixel: <span className="status-bar__pointer-value">{pixel ? formatPixelPosition(pixel) : '—'}</span>
    </span>
  )
}
