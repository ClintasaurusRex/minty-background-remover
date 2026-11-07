import type { PixelBuffer, SelectionMask } from '../../editor/types'
import {
  type BoundsTracker,
  type EdgeStrip,
  DEFAULT_STRIP_ROWS,
  NEIGHBOUR_X,
  NEIGHBOUR_Y,
  forEachEdgeSeed,
  forEachEdgeStrip,
  includePixel,
} from './edgeBand'

/*
 * Feathering: softens the edge left by Delete by lowering the alpha of the kept pixels next to
 * the deleted selection, over up to `feather` pixels inward (IMAGE_PROCESSING_SPEC.md,
 * Feathering; Phase 3 Step 8).
 *
 * - d: each kept pixel's distance to the nearest selected pixel (centre to centre), measured
 *   through kept pixels (not selected, not fully transparent in the source) by vector
 *   propagation. Only the deleted selection counts: the image border and pixels that were
 *   already transparent do not start a feather.
 * - Plain inward feathering multiplies alpha by clamp((d − 0.5) / feather, 0, 1). On its own it
 *   fades every 1-pixel line and small text completely (Step 7: 13 of 14 test lines damaged at
 *   1 px), which is unacceptable for technical graphics.
 * - Thin features are protected by the shape's local thickness: h, the largest d reached by
 *   walking uphill from the pixel (each step to a neighbour at least 0.5 pixel deeper; a kept
 *   neighbour deeper than feather + 2 counts as unlimited). The fade is limited to
 *   L = min(feather, h − 1.5) pixels, and pixels with L ≤ 0 are left alone: features up to about
 *   3 pixels across (lines, wiring, small text, dots) are never feathered, and every shape keeps
 *   its middle at full alpha. Measured on the Step 7 fixtures: all 14 thin lines intact with no
 *   faint pixel lost, and medium and 9-pixel text unchanged, at 1 to 5 pixels.
 *
 * alpha' = round(alpha × clamp((d − 0.5) / L, 0, 1)), applied to the alpha left by edge cleanup.
 * Alpha only ever decreases; colour is never changed, except that a pixel faded to alpha 0 gets
 * its original colour back, hidden, as Delete leaves deleted pixels. Changes stay within
 * `feather` pixels of the selection (8-connected steps). Fully transparent and selected pixels are
 * never changed; the source and the selection are never written. The result does not depend on
 * how the region is divided into strips.
 *
 * Known effect: the outer pixels of every shape thicker than about 4 pixels fade, including an
 * outline drawn along that shape's edge, so a thin line attached to an outlined shape can look
 * detached where the outline fades.
 */

/** A neighbour this much deeper (in pixels) counts as uphill when measuring thickness. */
const UPHILL_STEP = 0.5
/** Thickness (h) at which feathering starts: L = min(feather, h − PROTECTED_THICKNESS). */
const PROTECTED_THICKNESS = 1.5
/** Marks pixels not reached (dist²) and unlimited thickness (ridge²). Above every stored value. */
const FAR = 255

/** What feathering changed. */
export interface FeatherResult {
  /** Pixels whose alpha feathering lowered. */
  readonly changed: number
  /** Of those, pixels edge cleanup had left unchanged (so the total of edge pixels changed counts each once). */
  readonly changedFromSource: number
  /** Of those, pixels made fully transparent. */
  readonly madeTransparent: number
}

interface Scratch {
  /** Squared distance to the nearest selected pixel, or FAR. */
  dist2: Uint8Array
  /** Offset from the pixel to that selected pixel. */
  offsetX: Int8Array
  offsetY: Int8Array
  /** Squared thickness h², or FAR for unlimited. */
  ridge2: Uint8Array
  /** Window pixels reached, in the order reached. */
  reached: Int32Array
}

/**
 * Feathers the edge of a selection just deleted (see above), writing into `edited`.
 *
 * `edited` must be the Delete result for `source` and `selection` (deleteSelectedPixelData),
 * possibly after edge cleanup. Every changed pixel is added to `changedBounds`.
 *
 * `feather` is a whole number of pixels, 1 or more (0 changes nothing). `stripRows` exists for
 * tests: the result is the same for any value.
 */
export function featherSelectionEdges(
  source: PixelBuffer,
  selection: SelectionMask,
  edited: Uint8ClampedArray,
  feather: number,
  changedBounds: BoundsTracker,
  stripRows: number = DEFAULT_STRIP_ROWS,
): FeatherResult {
  const totals = { changed: 0, changedFromSource: 0, madeTransparent: 0 }
  if (feather < 1) return totals
  // Distances are needed up to `reach`; a pixel's thickness follows uphill steps (at most
  // 2 × reach of them) and their distances (2 × reach more), so the halo covers 4 × reach.
  const reach = feather + 2
  const halo = 4 * reach + 2
  let scratch: Scratch | null = null
  forEachEdgeStrip(source.width, source.height, selection.bounds, feather, halo, stripRows, (strip) => {
    const size = (strip.right - strip.left) * (strip.bottom - strip.top)
    if (!scratch || scratch.dist2.length < size) {
      scratch = {
        dist2: new Uint8Array(size).fill(FAR),
        offsetX: new Int8Array(size),
        offsetY: new Int8Array(size),
        ridge2: new Uint8Array(size),
        reached: new Int32Array(size),
      }
    }
    featherStrip(source, selection, edited, feather, reach * reach, strip, scratch, totals, changedBounds)
  })
  return totals
}

function featherStrip(
  source: PixelBuffer,
  selection: SelectionMask,
  out: Uint8ClampedArray,
  feather: number,
  maxDist2: number,
  strip: EdgeStrip,
  scratch: Scratch,
  totals: { changed: number; changedFromSource: number; madeTransparent: number },
  changedBounds: BoundsTracker,
): void {
  const { width: W, height: H } = source
  const src = source.data
  const sel = selection.data
  const { left, right, top, bottom, ownTop, ownBottom } = strip
  const ww = right - left
  const wh = bottom - top
  const { dist2, offsetX, offsetY, ridge2, reached } = scratch
  const kept = (index: number) => sel[index] === 0 && src[index * 4 + 3] !== 0

  // Seeds: kept pixels next to the selection, measured to the nearest selected neighbour (the
  // first one in neighbour order when several are as near).
  let count = 0
  forEachEdgeSeed(src, selection, strip, (index, local) => {
    const x = index % W
    const y = (index - x) / W
    let best = FAR
    let bx = 0
    let by = 0
    for (let k = 0; k < 8; k++) {
      const nx = x + NEIGHBOUR_X[k]
      const ny = y + NEIGHBOUR_Y[k]
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || sel[ny * W + nx] === 0) continue
      const d2 = NEIGHBOUR_X[k] * NEIGHBOUR_X[k] + NEIGHBOUR_Y[k] * NEIGHBOUR_Y[k]
      if (d2 < best) {
        best = d2
        bx = NEIGHBOUR_X[k]
        by = NEIGHBOUR_Y[k]
      }
    }
    dist2[local] = best
    offsetX[local] = bx
    offsetY[local] = by
    reached[count++] = local
  })

  // Vector propagation through kept pixels, one 8-connected layer at a time: a neighbour takes the
  // offset to the same selected pixel when that is nearer than what it has.
  for (let layerStart = 0; layerStart < count; ) {
    const layerEnd = count
    for (let r = layerStart; r < layerEnd; r++) {
      const local = reached[r]
      const lx = local % ww
      const ly = (local - lx) / ww
      for (let k = 0; k < 8; k++) {
        const qx = lx + NEIGHBOUR_X[k]
        const qy = ly + NEIGHBOUR_Y[k]
        if (qx < 0 || qy < 0 || qx >= ww || qy >= wh) continue
        const lq = qy * ww + qx
        const sx = offsetX[local] - NEIGHBOUR_X[k]
        const sy = offsetY[local] - NEIGHBOUR_Y[k]
        const d2 = sx * sx + sy * sy
        // The window-local test first: most neighbours are already reached more closely.
        if (d2 > maxDist2 || d2 >= dist2[lq]) continue
        if (!kept((qy + top) * W + qx + left)) continue
        if (dist2[lq] === FAR) reached[count++] = lq
        dist2[lq] = d2
        offsetX[lq] = sx
        offsetY[lq] = sy
      }
    }
    layerStart = layerEnd
  }

  // Thickness, deepest pixels first (counting sort on dist², at most maxDist2 + 1 values): the
  // largest distance reachable uphill, or FAR when a kept neighbour lies beyond the distances
  // measured (or outside the window).
  const starts = new Int32Array(maxDist2 + 2)
  for (let r = 0; r < count; r++) starts[maxDist2 - dist2[reached[r]] + 1]++
  for (let i = 1; i < starts.length; i++) starts[i] += starts[i - 1]
  const order = new Int32Array(count)
  for (let r = 0; r < count; r++) order[starts[maxDist2 - dist2[reached[r]]]++] = reached[r]
  for (let r = 0; r < count; r++) {
    const local = order[r]
    const lx = local % ww
    const ly = (local - lx) / ww
    const d = Math.sqrt(dist2[local])
    let best = dist2[local]
    for (let k = 0; k < 8 && best !== FAR; k++) {
      const x = lx + left + NEIGHBOUR_X[k]
      const y = ly + top + NEIGHBOUR_Y[k]
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      const inWindow = x >= left && x < right && y >= top && y < bottom
      const q2 = inWindow ? dist2[local + NEIGHBOUR_Y[k] * ww + NEIGHBOUR_X[k]] : FAR
      if (q2 !== FAR) {
        // Reached, so kept.
        const lq = local + NEIGHBOUR_Y[k] * ww + NEIGHBOUR_X[k]
        if (Math.sqrt(q2) >= d + UPHILL_STEP && ridge2[lq] > best) best = ridge2[lq]
      } else if (kept(y * W + x)) {
        // Kept but beyond the distances measured (or outside the window): deep.
        best = FAR
      }
    }
    ridge2[local] = best
  }

  // Alpha for the strip's own rows.
  for (let r = 0; r < count; r++) {
    const local = reached[r]
    const lx = local % ww
    const y = (local - lx) / ww + top
    if (y < ownTop || y >= ownBottom) continue
    const index = y * W + lx + left
    const k = index * 4
    const alpha = out[k + 3]
    if (alpha === 0) continue
    const ridge = ridge2[local]
    const fade = ridge === FAR ? feather : Math.min(feather, Math.sqrt(ridge) - PROTECTED_THICKNESS)
    if (fade <= 0) continue
    const factor = Math.min(1, Math.max(0, (Math.sqrt(dist2[local]) - 0.5) / fade))
    if (factor >= 1) continue
    const next = Math.round(alpha * factor)
    if (next === alpha) continue
    const wasSource = out[k] === src[k] && out[k + 1] === src[k + 1] && out[k + 2] === src[k + 2] && alpha === src[k + 3]
    out[k + 3] = next
    if (next === 0) {
      out[k] = src[k]
      out[k + 1] = src[k + 1]
      out[k + 2] = src[k + 2]
      totals.madeTransparent++
    }
    totals.changed++
    if (wasSource) totals.changedFromSource++
    includePixel(changedBounds, index, W)
  }

  for (let r = 0; r < count; r++) dist2[reached[r]] = FAR
}
