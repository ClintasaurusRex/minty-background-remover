import type { Point, Rectangle, Size, ViewportState } from '../editor/types'
import type { CropHandle } from '../image/crop/cropRectangle'

/*
 * Where the crop rectangle appears in the workspace, and what a pointer press there grabs
 * (Phase 4, Manual Crop). Workspace (viewport) CSS pixels, as for the other overlays; the device
 * pixel ratio is used only to put the rectangle's edges exactly where the image canvas draws the
 * corresponding pixel boundaries.
 *
 * The image canvas draws each device pixel in the colour of the image pixel at its centre
 * (coordinates.ts, imageIndexAtDevicePixel), and the display viewport puts the image's corner on a
 * device pixel edge. The boundary in front of image column x is therefore drawn at device pixel
 * round(x × zoom × ratio) from that corner (a centre exactly on the boundary shows the left or
 * upper pixel, so a half rounds up). cropRectOnScreen puts the overlay's edges there, so the
 * darkened area, the outline and the image's pixels line up exactly at every zoom and ratio.
 */

/** Half the size of a drawn handle square, in CSS pixels. */
export const CROP_HANDLE_RADIUS = 4

/**
 * How far from an edge or corner (CSS pixels) a press still grabs it, outside the rectangle. Inside
 * it, at most a third of the rectangle's on-screen size, so the middle of even a small rectangle
 * moves it.
 */
export const CROP_GRAB_DISTANCE = 8

/** The pixel boundary in front of image coordinate `edge`, in CSS pixels along one axis. */
function screenEdge(offset: number, edge: number, zoom: number, devicePixelRatio: number): number {
  return (Math.round(offset * devicePixelRatio) + Math.round(edge * zoom * devicePixelRatio)) / devicePixelRatio
}

/**
 * The crop rectangle `rect` (image pixels) in workspace CSS pixels, its edges on the device pixel
 * boundaries where the image canvas draws them. `viewport` must be the display viewport.
 */
export function cropRectOnScreen(rect: Readonly<Rectangle>, viewport: ViewportState, devicePixelRatio: number): Rectangle {
  const { zoom, offset } = viewport
  const left = screenEdge(offset.x, rect.x, zoom, devicePixelRatio)
  const top = screenEdge(offset.y, rect.y, zoom, devicePixelRatio)
  const right = screenEdge(offset.x, rect.x + rect.width, zoom, devicePixelRatio)
  const bottom = screenEdge(offset.y, rect.y + rect.height, zoom, devicePixelRatio)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** What a pointer press at a workspace point grabs of the crop rectangle. */
export type CropHit =
  | { readonly kind: 'handle'; readonly handle: CropHandle }
  | { readonly kind: 'inside' }
  | { readonly kind: 'outside' }

const OUTSIDE: CropHit = { kind: 'outside' }
const INSIDE: CropHit = { kind: 'inside' }

/**
 * What a press at `point` grabs of a crop rectangle shown at `screen` (cropRectOnScreen), all in
 * workspace CSS pixels:
 *
 * - A corner, within CROP_GRAB_DISTANCE of it on both axes: resize from that corner.
 * - An edge, within that distance of it and alongside the rectangle: resize from that edge.
 * - Inside the rectangle otherwise: move it.
 * - Anywhere else: outside (a new rectangle).
 *
 * Inside the rectangle the grab distance is at most a third of its size on that axis, so its middle
 * third always moves it, however small it appears.
 */
export function hitTestCrop(screen: Readonly<Rectangle>, point: Point): CropHit {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return OUTSIDE
  const horizontal = edgeZone(point.x, screen.x, screen.width)
  const vertical = edgeZone(point.y, screen.y, screen.height)
  if (horizontal === null || vertical === null) return OUTSIDE
  const handle = `${vertical === 'start' ? 'n' : vertical === 'end' ? 's' : ''}${
    horizontal === 'start' ? 'w' : horizontal === 'end' ? 'e' : ''
  }`
  return handle === '' ? INSIDE : { kind: 'handle', handle: handle as CropHandle }
}

/**
 * Where `value` lies along one axis of a span from `start` with `size`: near its start or end
 * edge, in its middle, or too far outside (null).
 */
function edgeZone(value: number, start: number, size: number): 'start' | 'middle' | 'end' | null {
  const end = start + size
  const inner = Math.min(CROP_GRAB_DISTANCE, size / 3)
  if (value < start - CROP_GRAB_DISTANCE || value > end + CROP_GRAB_DISTANCE) return null
  // Nearer the start than the end (or equally near) when both are within reach.
  if (value <= start + inner && value - start <= end - value) return 'start'
  if (value >= end - inner) return 'end'
  if (value <= start + inner) return 'start'
  return 'middle'
}

/** The CSS cursor for a crop hit: a resize arrow along the handle's axis, a move cursor inside, a crosshair outside. */
export function cropCursor(hit: CropHit): string {
  switch (hit.kind) {
    case 'outside':
      return 'crosshair'
    case 'inside':
      return 'move'
    case 'handle':
      return `${hit.handle}-resize`
  }
}

/** A drawn handle: its centre in workspace CSS pixels. */
export interface CropHandlePosition {
  readonly handle: CropHandle
  readonly x: number
  readonly y: number
}

/**
 * The handles to draw for a crop rectangle shown at `screen`: the four corners always, and the
 * middle of each edge when the edge is long enough on screen for them not to overlap the corners.
 */
export function cropHandlePositions(screen: Readonly<Rectangle>): CropHandlePosition[] {
  const { x, y, width, height } = screen
  const right = x + width
  const bottom = y + height
  const midX = x + width / 2
  const midY = y + height / 2
  const handles: CropHandlePosition[] = [
    { handle: 'nw', x, y },
    { handle: 'ne', x: right, y },
    { handle: 'se', x: right, y: bottom },
    { handle: 'sw', x, y: bottom },
  ]
  const room = CROP_HANDLE_RADIUS * 6
  if (width >= room) handles.push({ handle: 'n', x: midX, y }, { handle: 's', x: midX, y: bottom })
  if (height >= room) handles.push({ handle: 'e', x: right, y: midY }, { handle: 'w', x, y: midY })
  return handles
}

/**
 * Where to put the crop's size label: just above the rectangle's top-left corner, or just inside it
 * when there is no room above (near the top of the workspace). Clamped so it starts inside the
 * workspace horizontally. `labelHeight` in CSS pixels.
 */
export function cropLabelPosition(screen: Readonly<Rectangle>, workspace: Size, labelHeight: number): Point {
  const gap = 4
  const above = screen.y - gap - labelHeight
  const y = above >= 0 ? above : Math.max(0, screen.y) + gap
  const x = Math.min(Math.max(0, screen.x), Math.max(0, workspace.width - 1))
  return { x, y }
}
