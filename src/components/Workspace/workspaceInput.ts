import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clientToViewport } from '../../canvas/coordinates'
import { cropCursor, hitTestCrop } from '../../canvas/cropOverlay'
import { wheelPanDelta } from '../../canvas/pan'
import { wheelDeltaPixels, wheelZoomFactor } from '../../canvas/wheelZoom'
import {
  DROP_TARGET_IDLE_MS,
  type DropTargetEvent,
  isDropTargetActive,
  updateDropTarget,
} from '../../editor/dropTarget'
import {
  type PanGesture,
  type PanGestureEffect,
  type PanGestureEvent,
  idlePanGesture,
  panOwnsPointerDown,
  updatePanGesture,
} from '../../editor/panGesture'
import type { Point, Rectangle } from '../../editor/types'
import { isFileDrag } from '../../image/import/droppedFiles'
import { isEditableTarget, isInteractiveTarget } from '../../utils/domTargets'

/*
 * Pointer, wheel and keyboard input for the workspace. The decisions live in pure
 * modules (wheelZoom, pan, panGesture); these hooks only connect them to the DOM.
 */

export interface WheelHandlers {
  /** Ctrl + wheel: multiply the zoom by `factor` about `anchor` (canvas CSS px). */
  readonly onWheelZoom: (anchor: Point, factor: number) => void
  /** Plain or Shift + wheel, and trackpad scrolling: move the image by `delta` CSS px. */
  readonly onWheelPan: (delta: Point) => void
}

/**
 * Wheel input while an image is shown. Ctrl + wheel (and trackpad pinch, which
 * browsers report the same way) zooms about the pointer; other wheel input pans.
 * The listener is non-passive so it can stop the browser zooming or scrolling, and
 * it only acts over the workspace. Events are combined into one change per frame.
 */
export function useWheelInput(
  workspaceRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  { onWheelZoom, onWheelPan }: WheelHandlers,
) {
  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !enabled) return

    let zoomFactor = 1
    let zoomAnchor: Point | null = null
    let pan = { x: 0, y: 0 }
    let frame = 0

    const flush = () => {
      frame = 0
      if (zoomAnchor && zoomFactor !== 1) onWheelZoom(zoomAnchor, zoomFactor)
      if (pan.x !== 0 || pan.y !== 0) onWheelPan(pan)
      zoomFactor = 1
      zoomAnchor = null
      pan = { x: 0, y: 0 }
    }

    const onWheel = (event: WheelEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      event.preventDefault()
      if (event.ctrlKey) {
        const pixels = wheelDeltaPixels(event.deltaY, event.deltaMode, workspace.clientHeight)
        if (pixels === 0) return
        zoomFactor *= wheelZoomFactor(pixels)
        zoomAnchor = clientToViewport({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect())
      } else {
        const delta = wheelPanDelta(event, { width: workspace.clientWidth, height: workspace.clientHeight })
        if (delta.x === 0 && delta.y === 0) return
        pan = { x: pan.x + delta.x, y: pan.y + delta.y }
      }
      if (frame === 0) frame = requestAnimationFrame(flush)
    }

    workspace.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      workspace.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(frame)
    }
  }, [workspaceRef, canvasRef, enabled, onWheelZoom, onWheelPan])
}

export interface SpacePanState {
  /** Space is held: show the grab cursor. */
  readonly ready: boolean
  /** A drag is in progress: show the grabbing cursor. */
  readonly dragging: boolean
}

const IDLE: SpacePanState = { ready: false, dragging: false }

/**
 * Space + left drag panning while an image is shown. Space is only taken over when
 * focus is not on an interactive control, so it still presses buttons. The drag
 * uses pointer capture, so it continues outside the workspace, and ends when Space
 * or the button is released, on cancellation, loss of capture, window blur, the
 * image closing or unmount.
 *
 * Panning has priority over tools: every other pointer press in the workspace (any
 * button, outside controls) goes to `onToolPress`, but never one made while Space is
 * held or a drag is in progress.
 */
export function useSpacePan(
  workspaceRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onPanGesture: (effect: PanGestureEffect) => void,
  onToolPress: (event: PointerEvent) => void,
): SpacePanState {
  const [state, setState] = useState<SpacePanState>(IDLE)

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !enabled) return

    let gesture: PanGesture = idlePanGesture

    const apply = (event: PanGestureEvent): PanGestureEffect | null => {
      const endingDrag = gesture.drag
      const update = updatePanGesture(gesture, event)
      if (update.effect?.type === 'drag-ended' && endingDrag && workspace.hasPointerCapture(endingDrag.pointerId)) {
        workspace.releasePointerCapture(endingDrag.pointerId)
      }
      if (update.gesture !== gesture) {
        gesture = update.gesture
        setState({ ready: gesture.spaceHeld, dragging: gesture.drag !== null })
      }
      if (update.effect) onPanGesture(update.effect)
      return update.effect
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpace(event) || event.ctrlKey || event.altKey || event.metaKey || isInteractiveTarget(event.target)) return
      // Stops the page scrolling; repeats while held are absorbed the same way.
      event.preventDefault()
      apply({ type: 'space-down' })
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isSpace(event) || (!gesture.spaceHeld && !gesture.drag)) return
      event.preventDefault()
      apply({ type: 'space-up' })
    }
    const onPointerDown = (event: PointerEvent) => {
      if (isInteractiveTarget(event.target)) return
      // Decided before the press is applied, since the press itself may start a drag.
      const forPanning = panOwnsPointerDown(gesture)
      const effect = apply({
        type: 'pointer-down',
        pointerId: event.pointerId,
        button: event.button,
        point: { x: event.clientX, y: event.clientY },
      })
      if (effect?.type === 'drag-started') {
        event.preventDefault()
        workspace.setPointerCapture(event.pointerId)
      } else if (!forPanning) {
        onToolPress(event)
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      apply({ type: 'pointer-move', pointerId: event.pointerId, point: { x: event.clientX, y: event.clientY } })
    }
    const onPointerUp = (event: PointerEvent) => apply({ type: 'pointer-up', pointerId: event.pointerId })
    const onPointerCancel = (event: PointerEvent) => apply({ type: 'pointer-cancel', pointerId: event.pointerId })
    const reset = () => apply({ type: 'reset' })
    const onVisibilityChange = () => {
      if (document.hidden) reset()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', onVisibilityChange)
    workspace.addEventListener('pointerdown', onPointerDown)
    workspace.addEventListener('pointermove', onPointerMove)
    workspace.addEventListener('pointerup', onPointerUp)
    workspace.addEventListener('pointercancel', onPointerCancel)
    workspace.addEventListener('lostpointercapture', onPointerCancel)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      workspace.removeEventListener('pointerdown', onPointerDown)
      workspace.removeEventListener('pointermove', onPointerMove)
      workspace.removeEventListener('pointerup', onPointerUp)
      workspace.removeEventListener('pointercancel', onPointerCancel)
      workspace.removeEventListener('lostpointercapture', onPointerCancel)
      reset()
      setState(IDLE)
    }
  }, [workspaceRef, enabled, onPanGesture, onToolPress])

  return enabled ? state : IDLE
}

/**
 * Reports where the pointer is over the canvas (canvas CSS px), or null when it is
 * outside the canvas or no image is shown. Moves during a Space + drag pan, which has
 * pointer capture, are reported too.
 */
export function usePointerPosition(
  workspaceRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  onPointerPosition: (point: Point | null) => void,
) {
  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !enabled) return

    const onPointerMove = (event: PointerEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const point = clientToViewport({ x: event.clientX, y: event.clientY }, rect)
      const inside = point.x >= 0 && point.y >= 0 && point.x < rect.width && point.y < rect.height
      onPointerPosition(inside ? point : null)
    }
    const onPointerLeave = () => onPointerPosition(null)

    workspace.addEventListener('pointerdown', onPointerMove)
    workspace.addEventListener('pointermove', onPointerMove)
    workspace.addEventListener('pointerleave', onPointerLeave)
    return () => {
      workspace.removeEventListener('pointerdown', onPointerMove)
      workspace.removeEventListener('pointermove', onPointerMove)
      workspace.removeEventListener('pointerleave', onPointerLeave)
      onPointerPosition(null)
    }
  }, [workspaceRef, canvasRef, enabled, onPointerPosition])
}

/** A crop drag as the workspace reports it: a press, a move with the button held, the end. */
export type CropPointerEvent =
  | { readonly type: 'start'; readonly point: Point }
  | { readonly type: 'move'; readonly point: Point }
  | { readonly type: 'end' }

/**
 * Crop dragging on the image canvas while the Crop tool is active (Phase 4). A primary-button press
 * that panning did not take reaches `startPress` (from the workspace's tool press); it captures the
 * pointer, so the drag continues outside the canvas and the window, and reports the press. Moves of
 * a captured pointer and its release, cancellation or loss of capture are reported too. Points are
 * canvas CSS px.
 *
 * Without a captured pointer, moving over the canvas sets the `--crop-cursor` custom property to
 * what a press there would grab (cropCursor, against `cropScreen`, the rectangle as drawn); the
 * workspace's stylesheet uses it only while panning is not ready.
 */
export function useCropPointer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  cropScreen: Rectangle | null,
  onCropPointer: (event: CropPointerEvent) => void,
): (event: PointerEvent) => void {
  const screenRef = useRef(cropScreen)
  useLayoutEffect(() => {
    screenRef.current = cropScreen
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled) return
    const pointAt = (event: PointerEvent) => clientToViewport({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect())
    const showCursor = (point: Point) => {
      const screen = screenRef.current
      canvas.style.setProperty('--crop-cursor', cropCursor(screen ? hitTestCrop(screen, point) : { kind: 'outside' }))
    }
    const onPointerMove = (event: PointerEvent) => {
      if (canvas.hasPointerCapture(event.pointerId)) onCropPointer({ type: 'move', point: pointAt(event) })
      else showCursor(pointAt(event))
    }
    const onPointerEnd = (event: PointerEvent) => {
      if (event.type === 'lostpointercapture' || canvas.hasPointerCapture(event.pointerId)) onCropPointer({ type: 'end' })
    }
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerEnd)
    canvas.addEventListener('pointercancel', onPointerEnd)
    canvas.addEventListener('lostpointercapture', onPointerEnd)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerEnd)
      canvas.removeEventListener('pointercancel', onPointerEnd)
      canvas.removeEventListener('lostpointercapture', onPointerEnd)
      canvas.style.removeProperty('--crop-cursor')
      onCropPointer({ type: 'end' })
    }
  }, [canvasRef, enabled, onCropPointer])

  return useCallback(
    (event: PointerEvent) => {
      const canvas = canvasRef.current
      if (!canvas || !enabled || event.button !== 0) return
      canvas.setPointerCapture(event.pointerId)
      const point = clientToViewport({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect())
      onCropPointer({ type: 'start', point })
    },
    [canvasRef, enabled, onCropPointer],
  )
}

/**
 * Dropping files on the workspace. Only drags that carry files open an image.
 * Returns whether a file is being dragged over the workspace, for the drop
 * highlight. Any other drop in the window (a file outside the workspace, or text
 * and links anywhere) is refused unless it is over a text field, so the browser
 * cannot navigate away from the app to show it.
 */
export function useFileDrop(
  workspaceRef: RefObject<HTMLElement | null>,
  onDropFiles: (files: readonly File[], skippedCount: number) => void,
): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return

    let depth = 0
    let idleTimer = 0
    const update = (event: DropTargetEvent) => {
      depth = updateDropTarget(depth, event)
      const active = isDropTargetActive(depth)
      setActive(active)
      window.clearTimeout(idleTimer)
      if (active) idleTimer = window.setTimeout(() => update({ type: 'reset' }), DROP_TARGET_IDLE_MS)
    }
    const carriesFiles = (event: DragEvent) => isFileDrag(event.dataTransfer ? Array.from(event.dataTransfer.types) : null)
    const inside = (target: EventTarget | null) => target instanceof Node && workspace.contains(target)

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      update({ type: 'enter' })
    }
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      update({ type: 'over' })
    }
    const onDragLeave = (event: DragEvent) => {
      if (depth === 0) return
      update({ type: 'leave', stillInside: inside(event.relatedTarget) })
    }
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      update({ type: 'drop' })
      const { files, skippedCount } = droppedFiles(event.dataTransfer)
      onDropFiles(files, skippedCount)
    }
    // Everything the workspace does not accept: refuse it instead of letting the
    // browser open the file or follow the link.
    const handledElsewhere = (event: DragEvent) =>
      (carriesFiles(event) && inside(event.target)) || isEditableTarget(event.target)
    const onWindowDragOver = (event: DragEvent) => {
      if (handledElsewhere(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    }
    const onWindowDrop = (event: DragEvent) => {
      if (handledElsewhere(event)) return
      event.preventDefault()
      if (carriesFiles(event)) update({ type: 'reset' })
    }

    workspace.addEventListener('dragenter', onDragEnter)
    workspace.addEventListener('dragover', onDragOver)
    workspace.addEventListener('dragleave', onDragLeave)
    workspace.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onWindowDragOver)
    window.addEventListener('drop', onWindowDrop)
    return () => {
      workspace.removeEventListener('dragenter', onDragEnter)
      workspace.removeEventListener('dragover', onDragOver)
      workspace.removeEventListener('dragleave', onDragLeave)
      workspace.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onWindowDragOver)
      window.removeEventListener('drop', onWindowDrop)
      window.clearTimeout(idleTimer)
      setActive(false)
    }
  }, [workspaceRef, onDropFiles])

  return active
}

/**
 * The dropped files, in order. Folders are skipped and counted. The DataTransfer is
 * only readable during the drop event, so this runs synchronously inside it.
 */
function droppedFiles(transfer: DataTransfer | null): { files: File[]; skippedCount: number } {
  if (!transfer) return { files: [], skippedCount: 0 }
  const files: File[] = []
  let skippedCount = 0
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      skippedCount++
      continue
    }
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  // Some environments only expose DataTransfer.files.
  if (files.length === 0 && skippedCount === 0) files.push(...Array.from(transfer.files))
  return { files, skippedCount }
}

function isSpace(event: KeyboardEvent): boolean {
  return event.code === 'Space' || event.key === ' '
}
