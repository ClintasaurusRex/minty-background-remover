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
 * Edge cleanup: background-colour decontamination of the pixels next to a deleted selection
 * (Phase 3 Step 7, Candidate B, approved for Step 8; IMAGE_PROCESSING_SPEC.md, Edge Cleanup).
 *
 * After Delete, the unselected pixels along the deleted area are often blends of the object and
 * the background (anti-aliasing, blur, JPEG): left as they are they show a fringe of the old
 * background colour. Cleanup removes the background's share from them, lowering their alpha and
 * correcting their colour, so that the edge looks right over any new background.
 *
 * Model. Colours are premultiplied RGBA vectors (red, green and blue times alpha / 255, and alpha,
 * all 0–255). An edge pixel v is taken to be a blend of a foreground colour F and the local
 * background B with coverage a:
 *
 *     v = a · F + (1 − a) · B + r          (r: what the blend does not explain)
 *
 * - B: the local background, from the ORIGINAL colours of the selected pixels nearby (Delete keeps
 *   them hidden, and cleanup runs inside Delete with the source pixels): the mean of the "core"
 *   selected pixels (every 8-neighbour selected, so not themselves anti-aliased) within 2 pixels,
 *   else of the selected 8-neighbours. Their spread gives a local noise level ν = max(6, 2.5 σ).
 *   Already transparent selected pixels count as transparent background: their hidden colour is
 *   never read, as it is multiplied by alpha 0.
 * - The band: unselected, not fully transparent pixels within `distance` 8-connected steps of the
 *   selection, reached only while the colour keeps moving away from the background: a step whose
 *   contrast to B drops by more than ν stops (the monotone rule). An outline therefore protects
 *   whatever lies behind it, even if it has the background's colour.
 * - F: from the pixel's unselected 8-neighbours. A neighbour deeper in the band offers its own
 *   estimate of F (so estimates propagate outwards from solid material); any other neighbour
 *   offers its colour, a fully transparent one "transparent material". A neighbour is accepted
 *   only if it contrasts with B (≥ 24) and explains the pixel (|r| ≤ max(2ν, 8% of the
 *   contrast)); among accepted ones the most foreground-like (highest contrast) wins. a is the
 *   least-squares projection of v − B on F − B, clamped to 0–1.
 * - Twin rule: a neighbour farther from the selection with the pixel's own colour (within ν)
 *   means the pixel is inside solid material, not a blend; it is left alone. Colour alone cannot
 *   tell a solid grey part next to a black outline from a grey-black blend.
 *
 * Output, per band pixel: unchanged when no neighbour is accepted (no reliable estimate), when the
 * pixel is within noise of the foreground ((1 − a) · contrast ≤ ν), or for twins. Fully
 * transparent when it is within noise of the background (a · contrast ≤ ν) or its new alpha
 * rounds to 0; its colour is then kept, hidden, as Delete keeps it. Otherwise colour F + r and
 * alpha a · alpha(F + r), never above the pixel's own alpha.
 *
 * Guarantees: only band pixels change (unselected, not fully transparent, within `distance` of
 * the selection); alpha never increases; fully transparent pixels and selected pixels are never
 * changed; the image border is never treated as background (only selected pixels are). The
 * selection and the source pixels are never written. The result does not depend on how the
 * region is divided into strips.
 *
 * Limits (Step 7 measurements): colour that was flattened onto the background cannot be
 * recovered (a semi-transparent object saved onto an opaque background stays opaque); cleanup
 * trusts the selection, so a selection that leaked into the object enlarges the damage;
 * pixels the selection already deleted are never brought back.
 */

/** The constants of the model above, measured insensitive in the Step 7 sweep (6.88–6.95 mean edge error at 1 px). */
export const EDGE_CLEANUP_TUNING = {
  /** Smallest noise level ν, in premultiplied levels. */
  noiseMin: 6,
  /** ν = max(noiseMin, noiseK × standard deviation of the background samples). */
  noiseK: 2.5,
  /** A foreground candidate must differ from the background by at least this much. */
  contrastMin: 24,
  /** A candidate must explain the pixel within max(residualAbsK × ν, residualRel × contrast). */
  residualAbsK: 2,
  residualRel: 0.08,
} as const

/** What edge cleanup changed. */
export interface EdgePassResult {
  /** Pixels whose bytes changed. */
  readonly changed: number
  /** Of those, pixels made fully transparent. */
  readonly madeTransparent: number
}

/** Band pixel states after the estimate. */
const SELF = 1 // solid material (twin) or no contrasting neighbour: unchanged
const UNCERTAIN = 2 // no neighbour explains the pixel: unchanged
const ESTIMATED = 3

/** In the window's depth map, selected pixels already classified (band depths are 1–5). */
const CORE = 255
const NOT_CORE = 254

const length4 = (a: number, b: number, c: number, d: number) => Math.sqrt(a * a + b * b + c * c + d * d)

/** Band pixels of one window, as parallel typed arrays that grow by doubling. */
class BandPixels {
  size = 0
  capacity: number
  index: Int32Array
  count: Uint8Array
  state: Uint8Array
  /** Local background (premultiplied RGBA). */
  background: Float32Array
  /** Foreground estimate (premultiplied RGBA). */
  foreground: Float32Array
  residual: Float32Array
  noise: Float32Array
  /** Contrast between the pixel and its background. */
  contrastToBackground: Float32Array
  coverage: Float32Array
  /** Contrast between the chosen foreground and the background. */
  contrast: Float32Array

  constructor(capacity: number) {
    this.capacity = capacity
    this.index = new Int32Array(capacity)
    this.count = new Uint8Array(capacity)
    this.state = new Uint8Array(capacity)
    this.background = new Float32Array(capacity * 4)
    this.foreground = new Float32Array(capacity * 4)
    this.residual = new Float32Array(capacity * 4)
    this.noise = new Float32Array(capacity)
    this.contrastToBackground = new Float32Array(capacity)
    this.coverage = new Float32Array(capacity)
    this.contrast = new Float32Array(capacity)
  }

  grow(): void {
    const next = new BandPixels(this.capacity * 2)
    next.index.set(this.index)
    next.count.set(this.count)
    next.state.set(this.state)
    next.background.set(this.background)
    next.foreground.set(this.foreground)
    next.residual.set(this.residual)
    next.noise.set(this.noise)
    next.contrastToBackground.set(this.contrastToBackground)
    next.coverage.set(this.coverage)
    next.contrast.set(this.contrast)
    this.capacity = next.capacity
    this.index = next.index
    this.count = next.count
    this.state = next.state
    this.background = next.background
    this.foreground = next.foreground
    this.residual = next.residual
    this.noise = next.noise
    this.contrastToBackground = next.contrastToBackground
    this.coverage = next.coverage
    this.contrast = next.contrast
  }
}

/** Scratch memory reused by every strip of one cleanup. */
interface Scratch {
  /** Per window pixel: band depth (1–distance), CORE / NOT_CORE for selected pixels, or 0. */
  depth: Uint8Array
  /** Per window pixel: band slot + 1, or 0. */
  slotOf: Int32Array
  band: BandPixels
}

/**
 * Cleans the edge of a selection just deleted (see above), writing into `edited`.
 *
 * `edited` must be the Delete result for `source` and `selection`: a fresh copy of `source` with
 * only the selected pixels' alpha changed (deleteSelectedPixelData). Only band pixels of it are
 * written. Every changed pixel is added to `changedBounds`.
 *
 * `distance` is a whole number of pixels, 1 or more (0 changes nothing). `stripRows` exists for
 * tests: the result is the same for any value.
 */
export function cleanSelectionEdges(
  source: PixelBuffer,
  selection: SelectionMask,
  edited: Uint8ClampedArray,
  distance: number,
  changedBounds: BoundsTracker,
  stripRows: number = DEFAULT_STRIP_ROWS,
): EdgePassResult {
  if (distance < 1) return { changed: 0, madeTransparent: 0 }
  const totals = { changed: 0, madeTransparent: 0 }
  let scratch: Scratch | null = null
  // A band pixel's result depends on pixels up to 2 × distance rows away (its layers and the
  // deeper band pixels its estimate comes from), plus their background samples (2 more rows).
  const halo = 2 * distance + 4
  forEachEdgeStrip(source.width, source.height, selection.bounds, distance + 1, halo, stripRows, (strip) => {
    const size = (strip.right - strip.left) * (strip.bottom - strip.top)
    if (!scratch || scratch.depth.length < size) {
      scratch = {
        depth: new Uint8Array(size),
        slotOf: new Int32Array(size),
        band: scratch?.band ?? new BandPixels(Math.max(1024, Math.min(size, 65536))),
      }
    }
    cleanStrip(source, selection, edited, distance, strip, scratch, totals, changedBounds)
  })
  return totals
}

function cleanStrip(
  source: PixelBuffer,
  selection: SelectionMask,
  out: Uint8ClampedArray,
  distance: number,
  strip: EdgeStrip,
  scratch: Scratch,
  totals: { changed: number; madeTransparent: number },
  changedBounds: BoundsTracker,
): void {
  const { width: W, height: H } = source
  const src = source.data
  const sel = selection.data
  const { left: wx0, right: wx1, top: wy0, bottom: wy1, ownTop, ownBottom } = strip
  const ww = wx1 - wx0
  const { depth, slotOf } = scratch
  const band = scratch.band
  band.size = 0
  const coreTouched: number[] = []
  const v = new Float64Array(4)
  const p = new Float64Array(4)

  /** The premultiplied colour of source pixel `index`. */
  const read = (index: number, into: Float64Array) => {
    const k = index * 4
    const A = src[k + 3]
    const a = A / 255
    into[0] = src[k] * a
    into[1] = src[k + 1] * a
    into[2] = src[k + 2] * a
    into[3] = A
  }
  const addBandPixel = (index: number, local: number, layer: number): number => {
    // Growing replaces the typed arrays inside the same object: always index through `band`.
    if (band.size === band.capacity) band.grow()
    const s = band.size++
    band.index[s] = index
    band.count[s] = 0
    band.state[s] = 0
    band.noise[s] = 0
    band.background[s * 4] = 0
    band.background[s * 4 + 1] = 0
    band.background[s * 4 + 2] = 0
    band.background[s * 4 + 3] = 0
    slotOf[local] = s + 1
    depth[local] = layer
    return s
  }

  // Layer 1: the seeds, unselected pixels with a selected 8-neighbour.
  forEachEdgeSeed(src, selection, strip, (index, local) => addBandPixel(index, local, 1))

  // Core selected pixels (every 8-neighbour within the image selected), decided when first
  // needed and remembered in `depth` for pixels of the window.
  const isCore = (x: number, y: number): boolean => {
    const inWindow = y >= wy0 && y < wy1 && x >= wx0 && x < wx1
    const local = inWindow ? (y - wy0) * ww + (x - wx0) : -1
    if (inWindow) {
      const known = depth[local]
      if (known === CORE) return true
      if (known === NOT_CORE) return false
    }
    let core = sel[y * W + x] !== 0
    for (let k = 0; k < 8 && core; k++) {
      const nx = x + NEIGHBOUR_X[k]
      const ny = y + NEIGHBOUR_Y[k]
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && sel[ny * W + nx] === 0) core = false
    }
    if (inWindow) {
      depth[local] = core ? CORE : NOT_CORE
      coreTouched.push(local)
    }
    return core
  }

  // Background per seed: core selected pixels within 2 pixels, else selected 8-neighbours (a seed
  // always has one).
  for (let s = 0, seeds = band.size; s < seeds; s++) {
    const index = band.index[s]
    const gx = index % W
    const gy = (index - gx) / W
    let c0 = 0
    let c1 = 0
    let c2 = 0
    let c3 = 0
    let squares = 0
    let n = 0
    for (let pass = 0; pass < 2 && n === 0; pass++) {
      const r = pass === 0 ? 2 : 1
      for (let y = gy - r; y <= gy + r; y++) {
        if (y < 0 || y >= H) continue
        for (let x = gx - r; x <= gx + r; x++) {
          if (x < 0 || x >= W || sel[y * W + x] === 0) continue
          if (pass === 0 && !isCore(x, y)) continue
          read(y * W + x, p)
          c0 += p[0]
          c1 += p[1]
          c2 += p[2]
          c3 += p[3]
          squares += p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + p[3] * p[3]
          n++
        }
      }
    }
    c0 /= n
    c1 /= n
    c2 /= n
    c3 /= n
    const variance = Math.max(0, squares / n - (c0 * c0 + c1 * c1 + c2 * c2 + c3 * c3))
    band.background[s * 4] = c0
    band.background[s * 4 + 1] = c1
    band.background[s * 4 + 2] = c2
    band.background[s * 4 + 3] = c3
    band.noise[s] = Math.max(EDGE_CLEANUP_TUNING.noiseMin, EDGE_CLEANUP_TUNING.noiseK * Math.sqrt(variance))
    read(index, v)
    band.contrastToBackground[s] = length4(v[0] - c0, v[1] - c1, v[2] - c2, v[3] - c3)
  }
  // layerStart[k] is where layer k begins in `band`.
  const layerStart = [0, 0, band.size]

  // Layers 2 to distance: inward from the previous layer while the contrast to the background does
  // not drop by more than the noise (monotone rule). A pixel reached from several pixels of the
  // previous layer averages their backgrounds and noise levels.
  for (let k = 1; k < distance; k++) {
    const from = layerStart[k]
    const to = layerStart[k + 1]
    for (let s = from; s < to; s++) {
      const index = band.index[s]
      const gx = index % W
      const gy = (index - gx) / W
      const ps = s * 4
      const b0 = band.background[ps]
      const b1 = band.background[ps + 1]
      const b2 = band.background[ps + 2]
      const b3 = band.background[ps + 3]
      const floor = band.contrastToBackground[s] - band.noise[s]
      for (let j = 0; j < 8; j++) {
        const qx = gx + NEIGHBOUR_X[j]
        const qy = gy + NEIGHBOUR_Y[j]
        if (qx < wx0 || qy < wy0 || qx >= wx1 || qy >= wy1) continue
        const q = qy * W + qx
        if (sel[q] !== 0 || src[q * 4 + 3] === 0) continue
        const lq = (qy - wy0) * ww + (qx - wx0)
        const dq = depth[lq]
        if (dq !== 0 && dq !== k + 1) continue
        read(q, v)
        if (length4(v[0] - b0, v[1] - b1, v[2] - b2, v[3] - b3) < floor) continue
        const t = dq === 0 ? addBandPixel(q, lq, k + 1) : slotOf[lq] - 1
        band.background[t * 4] += b0
        band.background[t * 4 + 1] += b1
        band.background[t * 4 + 2] += b2
        band.background[t * 4 + 3] += b3
        band.noise[t] += band.noise[s]
        band.count[t]++
      }
    }
    const next = band.size
    for (let t = to; t < next; t++) {
      const c = band.count[t]
      for (let q = 0; q < 4; q++) band.background[t * 4 + q] /= c
      band.noise[t] /= c
      read(band.index[t], v)
      band.contrastToBackground[t] = length4(
        v[0] - band.background[t * 4],
        v[1] - band.background[t * 4 + 1],
        v[2] - band.background[t * 4 + 2],
        v[3] - band.background[t * 4 + 3],
      )
    }
    layerStart.push(next)
    if (next === to) break
  }
  const layers = layerStart.length - 2

  // Foreground estimates, from the deepest layer outwards, so that deeper estimates are known.
  const f = new Float64Array(4)
  const w = new Float64Array(4)
  const { contrastMin, residualAbsK, residualRel } = EDGE_CLEANUP_TUNING
  for (let k = layers; k >= 1; k--) {
    for (let s = layerStart[k]; s < layerStart[k + 1]; s++) {
      const index = band.index[s]
      const gx = index % W
      const gy = (index - gx) / W
      read(index, v)
      const ps = s * 4
      const s0 = band.background[ps]
      const s1 = band.background[ps + 1]
      const s2 = band.background[ps + 2]
      const s3 = band.background[ps + 3]
      const dv0 = v[0] - s0
      const dv1 = v[1] - s1
      const dv2 = v[2] - s2
      const dv3 = v[3] - s3
      let bestResidual = Infinity
      let bestCoverage = 0
      let bestContrast = -1
      let found = false
      let anyContrast = false
      let twin = false
      let f0 = 0
      let f1 = 0
      let f2 = 0
      let f3 = 0
      for (let j = 0; j < 8; j++) {
        const qx = gx + NEIGHBOUR_X[j]
        const qy = gy + NEIGHBOUR_Y[j]
        if (qx < wx0 || qy < wy0 || qx >= wx1 || qy >= wy1) continue
        const q = qy * W + qx
        if (sel[q] !== 0) continue
        const lq = (qy - wy0) * ww + (qx - wx0)
        const dq = depth[lq]
        // Twin rule: a neighbour farther from the selection with this pixel's colour.
        if ((dq > k || dq === 0) && src[q * 4 + 3] !== 0) {
          read(q, w)
          if (length4(w[0] - v[0], w[1] - v[1], w[2] - v[2], w[3] - v[3]) <= band.noise[s]) {
            twin = true
            break
          }
        }
        if (dq > k) {
          const t = (slotOf[lq] - 1) * 4
          f[0] = band.foreground[t]
          f[1] = band.foreground[t + 1]
          f[2] = band.foreground[t + 2]
          f[3] = band.foreground[t + 3]
        } else read(q, f)
        const u0 = f[0] - s0
        const u1 = f[1] - s1
        const u2 = f[2] - s2
        const u3 = f[3] - s3
        const c2 = u0 * u0 + u1 * u1 + u2 * u2 + u3 * u3
        if (c2 < contrastMin * contrastMin) continue
        anyContrast = true
        let a = (dv0 * u0 + dv1 * u1 + dv2 * u2 + dv3 * u3) / c2
        a = a < 0 ? 0 : a > 1 ? 1 : a
        const r = length4(dv0 - a * u0, dv1 - a * u1, dv2 - a * u2, dv3 - a * u3)
        const c = Math.sqrt(c2)
        if (r > Math.max(residualAbsK * band.noise[s], residualRel * c)) continue
        if (c > bestContrast + 1e-9 || (Math.abs(c - bestContrast) <= 1e-9 && r < bestResidual)) {
          bestResidual = r
          bestCoverage = a
          bestContrast = c
          found = true
          f0 = f[0]
          f1 = f[1]
          f2 = f[2]
          f3 = f[3]
        }
      }
      if (twin || !found) {
        // Unchanged; outer pixels see its own colour as its foreground.
        band.state[s] = twin || !anyContrast ? SELF : UNCERTAIN
        band.foreground[ps] = v[0]
        band.foreground[ps + 1] = v[1]
        band.foreground[ps + 2] = v[2]
        band.foreground[ps + 3] = v[3]
        continue
      }
      band.state[s] = ESTIMATED
      band.foreground[ps] = f0
      band.foreground[ps + 1] = f1
      band.foreground[ps + 2] = f2
      band.foreground[ps + 3] = f3
      band.coverage[s] = bestCoverage
      band.contrast[s] = bestContrast
      band.residual[ps] = dv0 - bestCoverage * (f0 - s0)
      band.residual[ps + 1] = dv1 - bestCoverage * (f1 - s1)
      band.residual[ps + 2] = dv2 - bestCoverage * (f2 - s2)
      band.residual[ps + 3] = dv3 - bestCoverage * (f3 - s3)
    }
  }

  // Results for the strip's own rows.
  for (let s = 0; s < band.size; s++) {
    if (band.state[s] !== ESTIMATED) continue
    const index = band.index[s]
    const gy = (index / W) | 0
    if (gy < ownTop || gy >= ownBottom) continue
    const a = band.coverage[s]
    const c = band.contrast[s]
    const noise = band.noise[s]
    // Within noise of the foreground: nothing to remove.
    if ((1 - a) * c <= noise) continue
    const ps = s * 4
    const k = index * 4
    const sourceAlpha = src[k + 3]
    // The decontaminated colour F + r, premultiplied.
    const r0 = band.foreground[ps] + band.residual[ps]
    const r1 = band.foreground[ps + 1] + band.residual[ps + 1]
    const r2 = band.foreground[ps + 2] + band.residual[ps + 2]
    const r3 = band.foreground[ps + 3] + band.residual[ps + 3]
    const alpha = Math.min(sourceAlpha, Math.round(a * r3))
    if (a * c <= noise || alpha <= 0) {
      // Background, or too faint to keep: transparent, its colour kept hidden as Delete keeps it.
      if (out[k + 3] !== 0) {
        out[k + 3] = 0
        totals.changed++
        totals.madeTransparent++
        includePixel(changedBounds, index, W)
      }
      continue
    }
    // r3 > 0 here, since alpha > 0. Straight colour, clamped to 0–255.
    out[k] = clampByte(Math.round((r0 * 255) / r3))
    out[k + 1] = clampByte(Math.round((r1 * 255) / r3))
    out[k + 2] = clampByte(Math.round((r2 * 255) / r3))
    out[k + 3] = alpha
    if (out[k] !== src[k] || out[k + 1] !== src[k + 1] || out[k + 2] !== src[k + 2] || alpha !== sourceAlpha) {
      totals.changed++
      includePixel(changedBounds, index, W)
    }
  }

  // Clear what this strip used, for the next strip.
  for (let t = 0; t < band.size; t++) {
    const index = band.index[t]
    const gx = index % W
    const local = ((index - gx) / W - wy0) * ww + (gx - wx0)
    depth[local] = 0
    slotOf[local] = 0
  }
  for (const local of coreTouched) depth[local] = 0
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}
