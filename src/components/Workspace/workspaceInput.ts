import { type RefObject, useEffect, useState } from 'react'
import { clientToViewport } from '../../canvas/coordinates'
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
  updatePanGesture,
} from '../../editor/panGesture'
import type { Point } from '../../editor/types'
import { isFileDrag } from '../../image/import/droppedFiles'

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
 */
export function useSpacePan(
  workspaceRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onPanGesture: (effect: PanGestureEffect) => void,
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
      if (!isSpace(event) || event.ctrlKey || event.altKey || event.metaKey || isInteractive(event.target)) return
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
      if (isInteractive(event.target)) return
      const effect = apply({
        type: 'pointer-down',
        pointerId: event.pointerId,
        button: event.button,
        point: { x: event.clientX, y: event.clientY },
      })
      if (effect?.type === 'drag-started') {
        event.preventDefault()
        workspace.setPointerCapture(event.pointerId)
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
  }, [workspaceRef, enabled, onPanGesture])

  return enabled ? state : IDLE
}

/**
 * Dropping files on the workspace. Only drags that carry files are handled; text and
 * links are left to the browser. Returns whether a file is being dragged over the
 * workspace, for the drop highlight. Dropping a file anywhere else in the window
 * is cancelled, so the browser cannot navigate away from the app to show it.
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
    // Outside the workspace: refuse the drop instead of letting the browser open the file.
    const onWindowDragOver = (event: DragEvent) => {
      if (!carriesFiles(event) || inside(event.target)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    }
    const onWindowDrop = (event: DragEvent) => {
      if (!carriesFiles(event) || inside(event.target)) return
      event.preventDefault()
      update({ type: 'reset' })
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

/** Elements where Space has its own meaning (pressing, typing, toggling). */
const INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'a[href]',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(',')

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}
