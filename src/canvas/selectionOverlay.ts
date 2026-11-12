import type { Point, Rectangle, SelectionMask, Size, ViewportState } from '../editor/types'
import { imageIndexAtDevicePixel, imageSpanAtDevicePixel } from './coordinates'
import { backingStoreSize, imageDrawBias } from './devicePixels'
import { intersect } from './rendering'

/*
 * The selection overlay: a mint tint over selected pixels and a black-and-white boundary where
 * selected and unselected pixels meet. It is drawn on its own canvas above the image and never
 * touches image pixels.
 *
 * It is rasterised here, in plain typed arrays, at device-pixel resolution and only where it can
 * be seen, in square tiles. Tiles are positioned in device pixels counted from the image's
 * top-left corner ("image-anchored"), which the display viewport puts on a device pixel edge, so:
 *
 * - Memory follows the screen, never the image: no full-resolution overlay is ever allocated, and
 *   tiles away from the selection are never created.
 * - Drawing a frame is one drawImage per visible tile, however complex the selection is. Pixel
 *   work per tile is bounded by its size (and, zoomed out, by the image pixels it covers).
 * - Panning moves the image by whole device pixels, so tiles already rasterised stay valid; only
 *   a change of selection, zoom or device pixel ratio needs new tiles.
 */

/** Overlay tiles are this many device pixels square. */
export const OVERLAY_TILE_SIZE = 256

/** An RGBA colour with 8-bit channels. */
type OverlayColour = readonly [r: number, g: number, b: number, a: number]

/** The mint accent (--color-accent, #6ee7b7) at 35% opacity (89 / 255). */
const SELECTION_TINT: OverlayColour = [110, 231, 183, 89]
const BOUNDARY_DARK: OverlayColour = [0, 0, 0, 255]
const BOUNDARY_LIGHT: OverlayColour = [255, 255, 255, 255]

/** Boundary dashes are this many boundary line widths long. */
const DASH_LENGTH_IN_LINE_WIDTHS = 4

/**
 * How boundary pixels are coloured. Which pixels are boundary never depends on the pattern.
 *
 * - Static (when reduced motion is requested): the Step 8 checkerboard of square cells.
 * - Marching ants: diagonal black and white stripes, one dash length wide, moved one line width
 *   per phase. Along every horizontal or vertical edge they form dashes that travel right or
 *   down by one line width each phase, without changing shape.
 *
 * Either way the selected and unselected sides of an edge take opposite colours, and both
 * colours run along every edge.
 */
export type BoundaryPattern = { readonly kind: 'static' } | { readonly kind: 'marching'; readonly phase: number }

export const STATIC_BOUNDARY: BoundaryPattern = Object.freeze({ kind: 'static' })

/** Marching phases before the stripes repeat: two dash lengths, one line width per phase. */
export const MARCHING_ANTS_PHASES = 2 * DASH_LENGTH_IN_LINE_WIDTHS

const MARCHING_BOUNDARIES: readonly BoundaryPattern[] = Array.from({ length: MARCHING_ANTS_PHASES }, (_, phase) =>
  Object.freeze({ kind: 'marching', phase }),
)

/** The marching-ants pattern at `phase` (any integer, taken modulo the period). Equal phases give the same object. */
export function marchingBoundary(phase: number): BoundaryPattern {
  return MARCHING_BOUNDARIES[((phase % MARCHING_ANTS_PHASES) + MARCHING_ANTS_PHASES) % MARCHING_ANTS_PHASES]
}

/** A colour as one 32-bit value laid out like ImageData bytes, whatever the platform's byte order. */
function packColour([r, g, b, a]: OverlayColour): number {
  return new Uint32Array(new Uint8Array([r, g, b, a]).buffer)[0]
}

/** Overlay pixels as written by rasteriseSelectionOverlay. */
export const OVERLAY_PIXELS = {
  transparent: 0,
  tint: packColour(SELECTION_TINT),
  dark: packColour(BOUNDARY_DARK),
  light: packColour(BOUNDARY_LIGHT),
} as const

/**
 * Width of each side of the boundary, in device pixels: one CSS pixel or a little less, so the
 * boundary looks the same at every device pixel ratio and stays crisp.
 */
export function boundaryLineWidth(devicePixelRatio: number): number {
  return Math.max(1, Math.floor(devicePixelRatio))
}

export interface SelectionOverlayInput {
  readonly selection: SelectionMask
  /** The display (snapped) viewport the image is drawn with, in CSS pixels. */
  readonly viewport: ViewportState
  /** The overlay canvas's size in CSS pixels: the same as the image canvas. */
  readonly viewportSize: Size
  readonly devicePixelRatio: number
  /** The canvas's content box in device pixels, when known: the same as the image canvas's. */
  readonly deviceSize?: Size | null
}

export interface OverlayTile {
  /** Position in the tile grid. */
  readonly column: number
  readonly row: number
  /** The part of the tile that can hold overlay pixels, in image-anchored device pixels. */
  readonly rect: Rectangle
}

export interface SelectionOverlayPlan {
  readonly backingStore: Size
  /** Device pixels per image pixel (zoom × device pixel ratio). */
  readonly scale: number
  /** Width of each side of the boundary, in device pixels. */
  readonly lineWidth: number
  /** The image's top-left corner in backing-store pixels; always whole numbers. */
  readonly origin: Point
  /** The visible tiles that can hold overlay pixels. A tile is drawn at origin + rect. */
  readonly tiles: readonly OverlayTile[]
  /** Tiles from earlier frames that intersect this area (image-anchored) are worth keeping. */
  readonly keep: Rectangle
}

/**
 * Which overlay tiles a frame needs. The canvas backing store matches the image canvas
 * (planFrame), and the image's corner is placed exactly where the image renderer draws it.
 */
export function planSelectionOverlay({
  selection,
  viewport,
  viewportSize,
  devicePixelRatio,
  deviceSize,
}: SelectionOverlayInput): SelectionOverlayPlan {
  const backingStore = backingStoreSize(viewportSize, devicePixelRatio, deviceSize)
  const scale = viewport.zoom * devicePixelRatio
  const lineWidth = boundaryLineWidth(devicePixelRatio)
  // Already whole numbers for a snapped viewport; rounding removes floating-point noise.
  const origin = {
    x: Math.round(viewport.offset.x * devicePixelRatio),
    y: Math.round(viewport.offset.y * devicePixelRatio),
  }
  const visible = { x: -origin.x, y: -origin.y, width: backingStore.width, height: backingStore.height }
  const content = overlayContentRect(selection, scale, lineWidth)
  const area = intersect(visible, content)
  const size = OVERLAY_TILE_SIZE

  const tiles: OverlayTile[] = []
  if (area) {
    for (let row = Math.floor(area.y / size); row * size < area.y + area.height; row++) {
      for (let column = Math.floor(area.x / size); column * size < area.x + area.width; column++) {
        const rect = intersect({ x: column * size, y: row * size, width: size, height: size }, content)
        if (rect) tiles.push({ column, row, rect })
      }
    }
  }
  const keep = {
    x: visible.x - size,
    y: visible.y - size,
    width: visible.width + 2 * size,
    height: visible.height + 2 * size,
  }
  return { backingStore, scale, lineWidth, origin, tiles, keep }
}

/**
 * The image-anchored device pixels that can hold overlay pixels: those over the selection's
 * bounds, the boundary drawn just outside them, and one more pixel for rounding.
 */
export function overlayContentRect(selection: SelectionMask, scale: number, lineWidth: number): Rectangle {
  const { x, y, width, height } = selection.bounds
  const margin = lineWidth + 1
  const left = Math.floor(x * scale) - margin
  const top = Math.floor(y * scale) - margin
  return {
    x: left,
    y: top,
    width: Math.ceil((x + width) * scale) + margin - left,
    height: Math.ceil((y + height) * scale) + margin - top,
  }
}

/**
 * Whether each device pixel in `rect` (image-anchored) shows the selection, row by row:
 * 1 selected, 0 not. Device pixels outside the image are not selected.
 *
 * - At 100% zoom and above (in device pixels), a device pixel shows the image pixel drawn there,
 *   by the same rule as pointer hit-testing, so the overlay marks exactly the pixels a click
 *   would pick.
 * - Zoomed out, a device pixel covers several image pixels and counts as selected when any of
 *   them is, so no selected pixel ever disappears from view.
 */
export function selectionStates(selection: SelectionMask, scale: number, rect: Rectangle): Uint8Array {
  const rowWords = wordsPerRow(rect.width)
  const bits = new Uint32Array(rowWords * rect.height)
  fillStateBits(selection, scale, rect, bits, rowWords, new Int32Array(rect.height))
  const states = new Uint8Array(rect.width * rect.height)
  for (let r = 0; r < rect.height; r++) {
    for (let c = 0; c < rect.width; c++) {
      states[r * rect.width + c] = (bits[r * rowWords + (c >>> 5)] >>> (c & 31)) & 1
    }
  }
  return states
}

/**
 * Where a tile's boundary pixels are, kept so the boundary can be painted again in another
 * pattern (paintOverlayBoundary) without reading the selection or rasterising the tile again.
 *
 * Only the rows and 32-pixel columns of the tile that hold boundary pixels are kept, one bit per
 * device pixel: at most 16 KB for a 256 × 256 tile, a sixteenth of its pixels.
 */
export interface OverlayBoundary {
  /** The tile's rectangle, in image-anchored device pixels. */
  readonly rect: Rectangle
  readonly lineWidth: number
  /** The part of the tile holding boundary pixels, relative to `rect`; its sides are 32-pixel aligned. */
  readonly area: Rectangle
  /** 32-bit words per row of `edge` and `selected`. */
  readonly words: number
  /** Bit c of word (row × words + (c >> 5)) is set where area column c of that row is boundary. */
  readonly edge: Uint32Array
  /** Bits laid out as `edge`, set where the device pixel shows a selected pixel. */
  readonly selected: Uint32Array
}

export interface OverlayTileRaster {
  /** False when nothing in the tile is drawn; the output is then untouched. */
  readonly drawn: boolean
  /** The tile's boundary, or null when it has no boundary pixels (its pixels never change). */
  readonly boundary: OverlayBoundary | null
}

const NOTHING_DRAWN: OverlayTileRaster = Object.freeze({ drawn: false, boundary: null })
const DRAWN_WITHOUT_BOUNDARY: OverlayTileRaster = Object.freeze({ drawn: true, boundary: null })

/**
 * Rasterises the overlay for `rect` (image-anchored device pixels) into `out`, `stride` values
 * per row, as packed RGBA in ImageData byte order (OVERLAY_PIXELS):
 *
 * - Every device pixel within `lineWidth` device pixels (including diagonally) of a pixel in the
 *   other state is boundary, so the boundary is `lineWidth` wide on each side of the edge. Its
 *   pixels are black or white by `pattern` (by default the static checkerboard of square cells,
 *   four line widths wide): selected and unselected pixels take opposite colours, and the colours
 *   alternate along every edge, on both sides of it, so the boundary stays visible on white,
 *   black, transparent and detailed images.
 * - Other selected pixels get the tint; other unselected pixels stay transparent.
 *
 * Patterns are anchored to the image, so they do not shimmer while panning. Returns false,
 * leaving `out` untouched, when nothing in `rect` is drawn.
 *
 * Cost does not depend on how complex the boundary is. Areas entirely inside or outside the
 * selection are recognised with native scans of the mask. Elsewhere, states are kept one bit per
 * device pixel, so finding the boundary takes a few 32-bit operations per 32 pixels; stretches
 * without boundary are written with native fills, and only boundary pixels one at a time.
 */
export function rasteriseSelectionOverlay(
  selection: SelectionMask,
  scale: number,
  lineWidth: number,
  rect: Rectangle,
  out: Uint32Array,
  stride: number,
  pattern: BoundaryPattern = STATIC_BOUNDARY,
): boolean {
  return rasteriseTile(selection, scale, lineWidth, rect, out, stride, pattern, false).drawn
}

/**
 * rasteriseSelectionOverlay for an overlay tile, also returning where its boundary is, so later
 * patterns can be painted with paintOverlayBoundary alone.
 */
export function rasteriseOverlayTile(
  selection: SelectionMask,
  scale: number,
  lineWidth: number,
  rect: Rectangle,
  out: Uint32Array,
  stride: number,
  pattern: BoundaryPattern,
): OverlayTileRaster {
  return rasteriseTile(selection, scale, lineWidth, rect, out, stride, pattern, true)
}

/**
 * Paints the boundary area of a tile (OverlayBoundary.area) in `pattern`, into `out`, which holds
 * just that area: `area.width` values per row. The result is exactly what
 * rasteriseSelectionOverlay writes there with that pattern, tint and transparent pixels included,
 * so the area can be copied to the tile as a whole.
 *
 * The work is one bit test per boundary pixel and native fills elsewhere; the selection is not
 * read.
 */
export function paintOverlayBoundary(boundary: OverlayBoundary, pattern: BoundaryPattern, out: Uint32Array): void {
  const { rect, lineWidth, area, words, edge, selected } = boundary
  paintRows(rect, lineWidth, area, words, edge, selected, null, pattern, out, area.width, -(area.y * area.width + area.x))
}

/** Boundary pixels change between black and white by XOR with this. */
const BLACK_WHITE_FLIP = OVERLAY_PIXELS.dark ^ OVERLAY_PIXELS.light

/**
 * Changes the boundary area in `out` (as for paintOverlayBoundary) from `shown`, the pattern it
 * holds (null when its contents are unknown), to `next`.
 *
 * One marching-ants step (to the next phase) only changes the colour of the boundary pixels where
 * the stripes move: a quarter of them, found 32 at a time with bit masks and flipped between
 * black and white. Anything else is painted in full.
 */
export function repaintOverlayBoundary(
  boundary: OverlayBoundary,
  shown: BoundaryPattern | null,
  next: BoundaryPattern,
  out: Uint32Array,
): void {
  if (shown === next) return
  if (
    shown === null ||
    shown.kind !== 'marching' ||
    next.kind !== 'marching' ||
    next.phase !== (shown.phase + 1) % MARCHING_ANTS_PHASES
  ) {
    paintOverlayBoundary(boundary, next, out)
    return
  }
  const { rect, lineWidth, area, words, edge } = boundary
  const cell = DASH_LENGTH_IN_LINE_WIDTHS * lineWidth
  // The stripe floor((x + y − offset) / cell) changes when the offset grows by one line width
  // exactly where (x + y − offset) mod cell < lineWidth.
  const offset = shown.phase * lineWidth
  const changes = cellBits('changes', rect.x + area.x, area.width + cell, cell, lineWidth)
  for (let k = 0; k < area.height; k++) {
    const shift = (((rect.y + area.y + k - offset) % cell) + cell) % cell
    const row = k * words
    const target = k * area.width
    for (let i = 0; i < words; i++) flipBoundaryPixels(out, target + 32 * i, edge[row + i] & bitsAt(changes, 0, 32 * i + shift))
  }
}

/**
 * Bit i is set where (x + i) mod cell < count, for i < length: with x an image-anchored column, a
 * row y reads it from bit (y − offset) mod cell on to test (column + y − offset) mod cell < count.
 * The words are scratch, valid until the next call with the same name.
 */
function cellBits(name: string, x: number, length: number, cell: number, count: number): Uint32Array {
  const bits = scratch.words(name, (length >>> 5) + 2)
  for (let i = 0; i < length; i++) {
    if ((((x + i) % cell) + cell) % cell < count) bits[i >>> 5] |= 1 << (i & 31)
  }
  return bits
}

/** Swaps black and white at out[base + b] for each set bit b of `flips` (boundary pixels only). */
function flipBoundaryPixels(out: Uint32Array, base: number, flips: number): void {
  while (flips !== 0) {
    const lowest = flips & -flips
    out[base + 31 - Math.clz32(lowest)] ^= BLACK_WHITE_FLIP
    flips ^= lowest
  }
}

function rasteriseTile(
  selection: SelectionMask,
  scale: number,
  lineWidth: number,
  rect: Rectangle,
  out: Uint32Array,
  stride: number,
  pattern: BoundaryPattern,
  keepBoundary: boolean,
): OverlayTileRaster {
  const { x: x0, y: y0, width, height } = rect
  const margin = lineWidth
  const span = 2 * margin + 1
  const outer = { x: x0 - margin, y: y0 - margin, width: width + 2 * margin, height: height + 2 * margin }

  const uniform = uniformState(selection, scale, outer)
  if (uniform === 0) return NOTHING_DRAWN
  if (uniform === 1) {
    for (let r = 0; r < height; r++) out.fill(OVERLAY_PIXELS.tint, r * stride, r * stride + width)
    return DRAWN_WITHOUT_BOUNDARY
  }

  // Device pixel states, one bit each: bit c of row k is column c of `outer`.
  const rowWords = wordsPerRow(outer.width)
  const bits = scratch.words('bits', rowWords * outer.height)
  const rowKeys = scratch.ints('rowKeys', outer.height)
  fillStateBits(selection, scale, outer, bits, rowWords, rowKeys)

  // Bit c of word c >> 5, for each row of `outer`: whether any (rowAny) or all (rowAll) of the
  // `span` pixels from column c + 0 to c + 2 × margin are selected. That is the row's part of the
  // square window around output column c.
  const outWords = (width + 31) >>> 5
  const rowAny = scratch.words('rowAny', outer.height * outWords)
  const rowAll = scratch.words('rowAll', outer.height * outWords)
  for (let k = 0; k < outer.height; k++) {
    const target = k * outWords
    if (rowKeys[k] === EMPTY_ROW) continue // nothing selected: both stay zero
    if (k > 0 && rowKeys[k] === rowKeys[k - 1]) {
      rowAny.copyWithin(target, target - outWords, target)
      rowAll.copyWithin(target, target - outWords, target)
      continue
    }
    const base = k * rowWords
    for (let i = 0; i < outWords; i++) {
      let any = 0
      let all = -1
      for (let j = 0; j < span; j++) {
        const word = bitsAt(bits, base, 32 * i + j)
        any |= word
        all &= word
      }
      rowAny[target + i] = any
      rowAll[target + i] = all
    }
  }

  // The geometry of each output row: boundary pixels (edge) and selected pixels, one bit each.
  // Bits past the tile's width are cleared, so they never count as boundary.
  const edgeRows = scratch.words('edgeRows', height * outWords)
  const selectedRows = scratch.words('selectedRows', height * outWords)
  const repeats = scratch.bytes('repeats', height)
  const lastWordMask = (width & 31) === 0 ? -1 : (1 << (width & 31)) - 1
  // The rows and words holding boundary pixels.
  let edgeTop = height
  let edgeBottom = -1
  let edgeFirstWord = outWords
  let edgeLastWord = -1
  let previousHasEdge = false
  for (let r = 0; r < height; r++) {
    const target = r * outWords
    // Rows with equal keys are equal, so when the row entering the window equals the one leaving
    // it and the centre row is unchanged, this output row repeats the previous one.
    if (r > 0 && rowKeys[r + span - 1] === rowKeys[r - 1] && rowKeys[r + margin] === rowKeys[r + margin - 1]) {
      edgeRows.copyWithin(target, target - outWords, target)
      selectedRows.copyWithin(target, target - outWords, target)
      repeats[r] = 1
      if (previousHasEdge) edgeBottom = r
      continue
    }
    const centreBase = (r + margin) * rowWords
    let hasEdge = false
    for (let i = 0; i < outWords; i++) {
      let any = 0
      let all = -1
      for (let k = r; k < r + span; k++) {
        any |= rowAny[k * outWords + i]
        all &= rowAll[k * outWords + i]
      }
      const mask = i === outWords - 1 ? lastWordMask : -1
      const edge = any & ~all & mask
      edgeRows[target + i] = edge
      selectedRows[target + i] = bitsAt(bits, centreBase, 32 * i + margin) & mask
      if (edge !== 0) {
        hasEdge = true
        if (edgeFirstWord > i) edgeFirstWord = i
        if (edgeLastWord < i) edgeLastWord = i
      }
    }
    previousHasEdge = hasEdge
    if (hasEdge) {
      if (edgeTop > r) edgeTop = r
      edgeBottom = r
    }
  }

  const whole = { x: 0, y: 0, width, height }
  paintRows(rect, lineWidth, whole, outWords, edgeRows, selectedRows, repeats, pattern, out, stride, 0)

  if (!keepBoundary || edgeBottom < 0) return DRAWN_WITHOUT_BOUNDARY
  // Keep the rows and words holding boundary pixels.
  const words = edgeLastWord - edgeFirstWord + 1
  const rows = edgeBottom - edgeTop + 1
  const edge = new Uint32Array(rows * words)
  const selected = new Uint32Array(rows * words)
  for (let k = 0, to = 0; k < rows; k++) {
    for (let i = 0, from = (edgeTop + k) * outWords + edgeFirstWord; i < words; i++, from++, to++) {
      edge[to] = edgeRows[from]
      selected[to] = selectedRows[from]
    }
  }
  const left = 32 * edgeFirstWord
  const area = { x: left, y: edgeTop, width: Math.min(width, 32 * (edgeLastWord + 1)) - left, height: rows }
  return { drawn: true, boundary: { rect, lineWidth, area, words, edge, selected } }
}

/**
 * Writes the overlay pixels of `area` (relative to the tile `rect`) from its geometry: `edge` and
 * `selected` bits, `words` words per row, starting at the area's first row and column. Words
 * without boundary are tint or transparent as a whole and are collected into native fills; only
 * boundary pixels are written one at a time.
 *
 * With `repeats` (1 where a row's geometry equals the previous row's), such rows start as a copy
 * of the previous row: static rows within the same checkerboard cell are then complete, and
 * marching rows only need the boundary pixels where a stripe begins (one in four) swapped, as each
 * row's stripes are the previous row's moved by one pixel.
 *
 * Tile pixel (row r, column c) is written to out[origin + r × stride + c].
 */
function paintRows(
  rect: Rectangle,
  lineWidth: number,
  area: Rectangle,
  words: number,
  edgeRows: Uint32Array,
  selectedRows: Uint32Array,
  repeats: Uint8Array | null,
  pattern: BoundaryPattern,
  out: Uint32Array,
  stride: number,
  origin: number,
): void {
  const { tint } = OVERLAY_PIXELS
  const cell = DASH_LENGTH_IN_LINE_WIDTHS * lineWidth
  const period = 2 * cell
  const marching = pattern.kind === 'marching'
  const left = area.x
  const right = area.x + area.width

  // Colour parity (times 4, a palette offset) of image-anchored column rect.x + left + i. Marching
  // stripes depend on x + y − phase, so each row reads this table from its own shift; whole
  // periods do not change the parity, so shifts stay below one period.
  const parityLength = area.width + (marching ? period : 0)
  const parity = scratch.bytes('columnParity', parityLength)
  for (let i = 0; i < parityLength; i++) parity[i] = (Math.floor((rect.x + left + i) / cell) & 1) << 2
  const offset = marching ? pattern.phase * lineWidth : 0
  // For marching rows with the previous row's geometry: where a stripe begins, (x + y − offset)
  // mod cell = 0, the colours differ from the previous row's.
  const starts = marching && repeats !== null ? cellBits('stripeStarts', rect.x + left, area.width + cell, cell, 1) : null

  let previousRowCell = -1
  for (let k = 0; k < area.height; k++) {
    const r = area.y + k
    const y = rect.y + r
    const target = origin + r * stride
    const rowCell = Math.floor(y / cell) & 1
    if (repeats !== null && k > 0 && repeats[k] === 1) {
      if (!marching && rowCell === previousRowCell) {
        out.copyWithin(target + left, target - stride + left, target - stride + right)
        continue
      }
      if (starts) {
        out.copyWithin(target + left, target - stride + left, target - stride + right)
        const shift = (((y - offset) % cell) + cell) % cell
        const row = k * words
        for (let i = 0; i < words; i++) {
          flipBoundaryPixels(out, target + left + 32 * i, edgeRows[row + i] & bitsAt(starts, 0, 32 * i + shift))
        }
        continue
      }
    }
    previousRowCell = rowCell
    // Static: checkerboard cells, the row's cell swapping the colours. Marching: diagonal stripes.
    const palette = !marching && rowCell === 1 ? PALETTE_ODD_ROW : PALETTE_EVEN_ROW
    const shift = marching ? (((y - offset) % period) + period) % period : 0
    const row = k * words
    // Words without boundary are collected into one fill.
    let runStart = left
    let runValue = -1
    for (let i = 0; i < words; i++) {
      const start = left + 32 * i
      const edge = edgeRows[row + i]
      const selected = selectedRows[row + i]
      if (edge === 0) {
        // No boundary pixel, so no change of state either: the whole word is tint or transparent.
        const value = (selected & 1) === 1 ? tint : 0
        if (value !== runValue) {
          if (runValue !== -1) out.fill(runValue, target + runStart, target + start)
          runValue = value
          runStart = start
        }
        continue
      }
      if (runValue !== -1) {
        out.fill(runValue, target + runStart, target + start)
        runValue = -1
      }
      const end = Math.min(start + 32, right)
      let edgeBits = edge
      let selectedBits = selected
      for (let c = start, column = start - left + shift; c < end; c++, column++) {
        out[target + c] = palette[parity[column] | ((edgeBits & 1) << 1) | (selectedBits & 1)]
        edgeBits >>>= 1
        selectedBits >>>= 1
      }
    }
    if (runValue !== -1) out.fill(runValue, target + runStart, target + right)
  }
}

/** Row key for a row with nothing selected. */
const EMPTY_ROW = -1

/**
 * Colours by class (bit 1 boundary, bit 0 selected) plus 4 in odd checkerboard columns: on the
 * boundary, the two sides take opposite colours, and the colours swap from cell to cell.
 */
const PALETTE_EVEN_ROW = Uint32Array.of(
  ...[OVERLAY_PIXELS.transparent, OVERLAY_PIXELS.tint, OVERLAY_PIXELS.dark, OVERLAY_PIXELS.light],
  ...[OVERLAY_PIXELS.transparent, OVERLAY_PIXELS.tint, OVERLAY_PIXELS.light, OVERLAY_PIXELS.dark],
)
const PALETTE_ODD_ROW = Uint32Array.of(...PALETTE_EVEN_ROW.subarray(4), ...PALETTE_EVEN_ROW.subarray(0, 4))

/** Words per bit row: one bit per pixel, and at least one zero word after the last pixel. */
function wordsPerRow(width: number): number {
  return (width >>> 5) + 2
}

/** The 32 bits of a bit row (starting at word `base`) from bit `offset` on. */
function bitsAt(bits: Uint32Array, base: number, offset: number): number {
  const word = base + (offset >>> 5)
  const shift = offset & 31
  return shift === 0 ? bits[word] : (bits[word] >>> shift) | (bits[word + 1] << (32 - shift))
}

/**
 * Scratch typed arrays reused between calls, grown as needed. Rasterising is synchronous, so one
 * set is enough. Byte and word buffers are returned zeroed.
 */
const scratch = (() => {
  const bytes = new Map<string, Uint8Array>()
  const words = new Map<string, Uint32Array>()
  const ints = new Map<string, Int32Array>()
  return {
    bytes(name: string, length: number): Uint8Array {
      let buffer = bytes.get(name)
      if (!buffer || buffer.length < length) bytes.set(name, (buffer = new Uint8Array(length)))
      return buffer.subarray(0, length).fill(0)
    },
    words(name: string, length: number): Uint32Array {
      let buffer = words.get(name)
      if (!buffer || buffer.length < length) words.set(name, (buffer = new Uint32Array(length)))
      return buffer.subarray(0, length).fill(0)
    },
    ints(name: string, length: number): Int32Array {
      let buffer = ints.get(name)
      if (!buffer || buffer.length < length) ints.set(name, (buffer = new Int32Array(length)))
      return buffer.subarray(0, length)
    },
  }
})()

/** The image columns (or rows) a run of device pixels can show, before clamping to the image. */
function coveredRange(start: number, length: number, scale: number): { first: number; last: number } {
  if (scale >= 1) {
    return { first: imageIndexAtDevicePixel(start, scale), last: imageIndexAtDevicePixel(start + length - 1, scale) }
  }
  return { first: imageSpanAtDevicePixel(start, scale).first, last: imageSpanAtDevicePixel(start + length - 1, scale).last }
}

/**
 * 0 when no device pixel in `rect` shows the selection, 1 when every one does, -1 otherwise
 * (or when that is not known), found without visiting device pixels one by one.
 */
function uniformState(selection: SelectionMask, scale: number, rect: Rectangle): 0 | 1 | -1 {
  const { width: imageWidth, height: imageHeight, bounds } = selection
  const columns = coveredRange(rect.x, rect.width, scale)
  const rows = coveredRange(rect.y, rect.height, scale)
  const contains = scale >= 1 ? bytesContain : packedContains

  // Nothing selected: only pixels inside the selection's bounds can be selected.
  const left = Math.max(columns.first, bounds.x)
  const right = Math.min(columns.last, bounds.x + bounds.width - 1)
  const top = Math.max(rows.first, bounds.y)
  const bottom = Math.min(rows.last, bounds.y + bounds.height - 1)
  if (left > right || top > bottom) return 0
  if (!contains(selection, left, right, top, bottom, 1)) return 0

  // Everything selected: needs every device pixel inside the image, over selected pixels.
  const inside = columns.first >= 0 && columns.last < imageWidth && rows.first >= 0 && rows.last < imageHeight
  if (inside && !contains(selection, columns.first, columns.last, rows.first, rows.last, 0)) return 1
  return -1
}

/**
 * Whether any pixel in columns left ..= right of rows top ..= bottom has `value` (1 selected, 0
 * not). These read the mask bytes with native indexOf, or the packed mask 32 pixels at a time.
 */
type RegionContains = (
  selection: SelectionMask,
  left: number,
  right: number,
  top: number,
  bottom: number,
  value: 0 | 1,
) => boolean

const bytesContain: RegionContains = ({ width, data }, left, right, top, bottom, value) => {
  for (let y = top; y <= bottom; y++) {
    const base = y * width
    if (data.subarray(base + left, base + right + 1).indexOf(value) !== -1) return true
  }
  return false
}

const packedContains: RegionContains = (selection, left, right, top, bottom, value) => {
  const packed = packedMask(selection)
  // Unselected pixels are found as set bits of the inverted words.
  const invert = value === 0 ? -1 : 0
  for (let y = top; y <= bottom; y++) {
    const row = y * selection.width
    if (anyBitSet(packed, 0, row + left, row + right, invert)) return true
  }
  return false
}

/**
 * The selection packed one bit per pixel, in mask order: pixel i is bit i & 31 of word i >> 5
 * (followed by a zero word, so reads past the last pixel are safe). Built once per mask, the
 * first time it is shown zoomed out, and kept only as long as the mask is (masks never change).
 * Memory: one eighth of the mask.
 */
const packedMasks = new WeakMap<SelectionMask, Uint32Array>()

/** Whether 32-bit words of mask bytes hold pixel i in bits 8 × (i & 3), i.e. little-endian order. */
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1

function packedMask(selection: SelectionMask): Uint32Array {
  const cached = packedMasks.get(selection)
  if (cached) return cached
  const { width, height, data, bounds } = selection
  const packed = new Uint32Array(((width * height) >>> 5) + 2)
  // Only the rows of the bounds can hold selected pixels.
  const end = (bounds.y + bounds.height) * width
  let i = bounds.y * width
  if (LITTLE_ENDIAN && data.byteOffset % 4 === 0) {
    // 32 pixels at a time, from eight aligned words of four mask bytes (each 0 or 1).
    for (; i < end && (i & 31) !== 0; i++) packed[i >>> 5] |= data[i] << (i & 31)
    const quads = new Uint32Array(data.buffer, data.byteOffset, data.length >>> 2)
    for (; i + 32 <= end; i += 32) {
      let word = 0
      for (let k = 0, q = i >>> 2; k < 8; k++, q++) {
        const quad = quads[q]
        word |= ((quad | (quad >>> 7) | (quad >>> 14) | (quad >>> 21)) & 15) << (4 * k)
      }
      packed[i >>> 5] = word
    }
  }
  for (; i < end; i++) packed[i >>> 5] |= data[i] << (i & 31)
  packedMasks.set(selection, packed)
  return packed
}

/**
 * Whether any of bits first ..= last (counted from word `base`) is set, after XOR with `invert`
 * (0, or -1 to look for clear bits instead).
 */
function anyBitSet(words: Uint32Array, base: number, first: number, last: number, invert: number): boolean {
  let word = base + (first >>> 5)
  const lastWord = base + (last >>> 5)
  let value = (words[word] ^ invert) & (-1 << (first & 31))
  while (word < lastWord) {
    if (value !== 0) return true
    value = words[++word] ^ invert
  }
  const end = last & 31
  return (value & (end === 31 ? -1 : (1 << (end + 1)) - 1)) !== 0
}

/**
 * Writes the states of selectionStates into `bits` (zeroed), one bit per device pixel and
 * `rowWords` words per row. `rowKeys` receives a key per row: rows with equal keys are equal.
 * Only the selection's bounds are read.
 */
function fillStateBits(
  selection: SelectionMask,
  scale: number,
  rect: Rectangle,
  bits: Uint32Array,
  rowWords: number,
  rowKeys: Int32Array,
): void {
  if (scale >= 1) fillBitsZoomedIn(selection, scale, rect, bits, rowWords, rowKeys)
  else fillBitsZoomedOut(selection, scale, rect, bits, rowWords, rowKeys)
}

/**
 * Each device pixel shows one image pixel. Device rows showing the same image row are copied, so
 * at high zoom most rows cost a memory copy.
 */
function fillBitsZoomedIn(
  selection: SelectionMask,
  scale: number,
  rect: Rectangle,
  bits: Uint32Array,
  rowWords: number,
  rowKeys: Int32Array,
): void {
  const { width: imageWidth, data, bounds } = selection
  const { x: x0, y: y0, width, height } = rect
  const boundsRight = bounds.x + bounds.width
  const boundsBottom = bounds.y + bounds.height

  // The image column shown in each device column. Columns increase with x, so those inside the
  // selection's bounds form one run, first ..= last.
  const bias = imageDrawBias(scale)
  const columns = scratch.ints('columns', width)
  let first = width
  let last = -1
  for (let c = 0; c < width; c++) {
    const x = imageIndexAtDevicePixel(x0 + c, scale, bias)
    columns[c] = x
    if (x >= bounds.x && x < boundsRight) {
      if (first > c) first = c
      last = c
    }
  }

  for (let r = 0; r < height; r++) {
    const y = imageIndexAtDevicePixel(y0 + r, scale, bias)
    if (y < bounds.y || y >= boundsBottom || first > last) {
      rowKeys[r] = EMPTY_ROW
      continue
    }
    rowKeys[r] = y
    const row = r * rowWords
    if (r > 0 && rowKeys[r - 1] === y) {
      bits.copyWithin(row, row - rowWords, row)
      continue
    }
    const base = y * imageWidth
    let word = 0
    for (let c = first; c <= last; c++) {
      word |= data[base + columns[c]] << (c & 31)
      if ((c & 31) === 31) {
        bits[row + (c >>> 5)] = word
        word = 0
      }
    }
    if ((last & 31) !== 31) bits[row + (last >>> 5)] = word
  }
}

/**
 * Each device pixel covers several image pixels and is selected when any of them is. For each
 * device row, the packed rows of the image rows it covers are combined with OR, 32 pixels at a
 * time, then each device column checks its span of the combined row.
 */
function fillBitsZoomedOut(
  selection: SelectionMask,
  scale: number,
  rect: Rectangle,
  bits: Uint32Array,
  rowWords: number,
  rowKeys: Int32Array,
): void {
  const { width: imageWidth, bounds } = selection
  const { x: x0, y: y0, width, height } = rect
  const boundsRight = bounds.x + bounds.width - 1
  const boundsBottom = bounds.y + bounds.height - 1

  // The image columns each device column covers, clamped to the selection's bounds. Spans
  // increase with x and leave no gaps; neighbours share a column that straddles their edge.
  const spanFirst = scratch.ints('spanFirst', width)
  const spanLast = scratch.ints('spanLast', width)
  let firstColumn = -1
  let lastColumn = -1
  for (let c = 0; c < width; c++) {
    const span = imageSpanAtDevicePixel(x0 + c, scale)
    spanFirst[c] = Math.max(bounds.x, span.first)
    spanLast[c] = Math.min(boundsRight, span.last)
    if (spanFirst[c] <= spanLast[c]) {
      if (firstColumn < 0) firstColumn = c
      lastColumn = c
    }
  }
  if (firstColumn < 0) {
    rowKeys.fill(EMPTY_ROW)
    return
  }

  const packed = packedMask(selection)
  // Bit i of the combined row is image column `offset` + i, from the first column any span covers.
  const offset = spanFirst[firstColumn]
  const wordCount = ((spanLast[lastColumn] - offset) >>> 5) + 1
  const combined = scratch.words('combinedRow', wordCount)

  for (let r = 0; r < height; r++) {
    const span = imageSpanAtDevicePixel(y0 + r, scale)
    const top = Math.max(bounds.y, span.first)
    const bottom = Math.min(boundsBottom, span.last)
    if (top > bottom) {
      rowKeys[r] = EMPTY_ROW
      continue
    }
    // Rows are all different, apart from those with nothing to read.
    rowKeys[r] = -2 - r
    const first = top * imageWidth + offset
    for (let i = 0; i < wordCount; i++) combined[i] = bitsAt(packed, 0, first + 32 * i)
    for (let y = top + 1; y <= bottom; y++) {
      const start = y * imageWidth + offset
      for (let i = 0; i < wordCount; i++) combined[i] |= bitsAt(packed, 0, start + 32 * i)
    }
    markColumns(combined, offset, spanFirst, spanLast, firstColumn, lastColumn, bits, r * rowWords)
  }
}

/**
 * Sets the bit (in the bit row starting at word `row`) of every device column whose span of the
 * combined row has a selected pixel. `offset` is the image column of the combined row's bit 0.
 */
function markColumns(
  combined: Uint32Array,
  offset: number,
  spanFirst: Int32Array,
  spanLast: Int32Array,
  firstColumn: number,
  lastColumn: number,
  bits: Uint32Array,
  row: number,
): void {
  for (let c = firstColumn; c <= lastColumn; c++) {
    const first = spanFirst[c] - offset
    const last = spanLast[c] - offset
    const word = first >>> 5
    let selected: boolean
    if (word === last >>> 5) {
      // The usual case: the span lies within one word.
      const length = last - first + 1
      const span = combined[word] >>> (first & 31)
      selected = (length === 32 ? span : span & ((1 << length) - 1)) !== 0
    } else {
      selected = anyBitSet(combined, 0, first, last, 0)
    }
    if (selected) bits[row + (c >>> 5)] |= 1 << (c & 31)
  }
}
