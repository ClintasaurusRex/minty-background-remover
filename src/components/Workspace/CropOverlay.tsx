import { CROP_HANDLE_RADIUS, cropHandlePositions, cropLabelPosition, cropRectOnScreen } from '../../canvas/cropOverlay'
import { formatDimensions } from '../../editor/documentInfo'
import type { WorkspaceMetrics } from '../../editor/editorState'
import type { Rectangle, Size, ViewportState } from '../../editor/types'
import { wholeImageRect } from '../../image/crop/cropRectangle'

interface CropOverlayProps {
  /** The crop rectangle in image pixels (pendingCrop), or null for none. */
  rect: Rectangle | null
  /** The open image's size. */
  imageSize: Size
  /** The display (snapped) viewport: the one the image is drawn and hit-tested with. */
  viewport: ViewportState
  workspace: WorkspaceMetrics
}

/** Height of the size label, in CSS pixels (its line height plus padding, Workspace.css). */
const LABEL_HEIGHT = 22

/**
 * The Crop tool's rectangle over the image (Phase 4): the image outside it darkened, its outline,
 * its handles and its size. Drawn in workspace CSS pixels with the display viewport, its edges on
 * the device pixels where the canvas draws the corresponding pixel boundaries (cropRectOnScreen),
 * so it lines up with the image at every zoom and device pixel ratio.
 *
 * Purely visual: pointer events pass through to the image canvas (the workspace hit-tests them,
 * canvas/cropOverlay.ts), it is hidden from assistive technology (the options row's fields give the
 * position and size), and it never touches the image's pixels, so it can never reach an export.
 */
export function CropOverlay({ rect, imageSize, viewport, workspace }: CropOverlayProps) {
  if (!rect) return null
  const ratio = workspace.devicePixelRatio
  const image = cropRectOnScreen(wholeImageRect(imageSize), viewport, ratio)
  const crop = cropRectOnScreen(rect, viewport, ratio)
  const label = cropLabelPosition(crop, workspace.size, LABEL_HEIGHT)
  // The image outside the rectangle: the image's area with the rectangle cut out (even-odd).
  const shade = `${rectPath(image)} ${rectPath(crop)}`
  const handleSize = CROP_HANDLE_RADIUS * 2
  // Lines a whole number of device pixels thick (as the selection boundary), centred half a line
  // from the edge so they cover whole device pixels just outside and just inside it.
  const line = Math.max(1, Math.floor(ratio)) / ratio
  const half = line / 2

  return (
    <div className="crop-overlay" aria-hidden="true">
      <svg className="crop-overlay__svg" width={workspace.size.width} height={workspace.size.height}>
        <path className="crop-overlay__shade" d={shade} fillRule="evenodd" />
        {/* A dark line just outside and a light line just inside, so the edge shows on any image. */}
        <rect
          className="crop-overlay__outline-dark"
          x={crop.x - half}
          y={crop.y - half}
          width={crop.width + line}
          height={crop.height + line}
          strokeWidth={line}
        />
        {crop.width > 2 * line && crop.height > 2 * line && (
          <rect
            className="crop-overlay__outline"
            x={crop.x + half}
            y={crop.y + half}
            width={crop.width - line}
            height={crop.height - line}
            strokeWidth={line}
          />
        )}
        {cropHandlePositions(crop).map(({ handle, x, y }) => (
          <rect
            key={handle}
            className="crop-overlay__handle"
            x={x - CROP_HANDLE_RADIUS}
            y={y - CROP_HANDLE_RADIUS}
            width={handleSize}
            height={handleSize}
          />
        ))}
      </svg>
      <span className="crop-overlay__label" style={{ left: label.x, top: label.y }}>
        {formatDimensions(rect.width, rect.height)}
      </span>
    </div>
  )
}

function rectPath({ x, y, width, height }: Rectangle): string {
  return `M${x} ${y}h${width}v${height}h${-width}Z`
}
