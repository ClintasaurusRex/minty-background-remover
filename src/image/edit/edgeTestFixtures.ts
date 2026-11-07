import type { PixelBuffer, SelectionMask } from '../../editor/types'
import { createMagicWandSelection } from '../selection/magicWand'
import { createSelectionMask } from '../selection/selectionMask'
import { combineSelections } from '../selection/selectionOperations'

/*
 * Synthetic images with exact ground truth for the edge cleanup and feather tests, after the
 * Step 7 fixtures: anti-aliased shapes (supersampled coverage) painted over transparency are the
 * truth; the same shapes over a background are what the user opens.
 */

export type Rgb = readonly [number, number, number]
export type Rgba = readonly [number, number, number, number]
/** Whether image point (x, y) is inside the shape (pixel (i, j) covers [i, i + 1) × [j, j + 1)). */
export type Shape = (x: number, y: number) => boolean

export const disc = (cx: number, cy: number, r: number): Shape => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
export const ring = (cx: number, cy: number, inner: number, outer: number): Shape => (x, y) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2
  return d <= outer * outer && d >= inner * inner
}
export const rect = (x0: number, y0: number, x1: number, y1: number): Shape => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1
/** A straight stroke of the given width between two points (round ends). */
export const stroke = (x0: number, y0: number, x1: number, y1: number, width: number): Shape => {
  const dx = x1 - x0
  const dy = y1 - y0
  const length2 = dx * dx + dy * dy
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length2))
    return (x - x0 - t * dx) ** 2 + (y - y0 - t * dy) ** 2 <= (width / 2) ** 2
  }
}
/** A polygon (even-odd rule). */
export const polygon = (points: readonly (readonly [number, number])[]): Shape => (x, y) => {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]
    const [xj, yj] = points[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export interface Layer {
  readonly shape: Shape
  readonly colour: Rgb
  /** 0–1, default 1. */
  readonly opacity?: number
}

export interface Scene {
  /** The shapes over the background: the image the user opens. */
  readonly observed: PixelBuffer
  /** The shapes over transparency. */
  readonly truth: PixelBuffer
}

/**
 * Paints `layers` in order with `samples` × `samples` supersampling, over transparency (truth) and
 * over `background` (observed). Colours are straight RGBA 0–255.
 */
export function scene(width: number, height: number, background: (x: number, y: number) => Rgba, layers: readonly Layer[], samples = 6): Scene {
  const truth = new Uint8ClampedArray(width * height * 4)
  const observed = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Premultiplied foreground, 0–1.
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const layer of layers) {
        let hits = 0
        for (let sy = 0; sy < samples; sy++) {
          for (let sx = 0; sx < samples; sx++) if (layer.shape(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples)) hits++
        }
        const c = (hits / (samples * samples)) * (layer.opacity ?? 1)
        if (c === 0) continue
        r = r * (1 - c) + (layer.colour[0] / 255) * c
        g = g * (1 - c) + (layer.colour[1] / 255) * c
        b = b * (1 - c) + (layer.colour[2] / 255) * c
        a = a * (1 - c) + c
      }
      const k = (y * width + x) * 4
      if (a > 0) {
        truth[k] = Math.round((r / a) * 255)
        truth[k + 1] = Math.round((g / a) * 255)
        truth[k + 2] = Math.round((b / a) * 255)
        truth[k + 3] = Math.round(a * 255)
      }
      const [br, bg, bb, ba] = background(x, y)
      const ba1 = ba / 255
      const oa = a + ba1 * (1 - a)
      if (oa > 0) {
        observed[k] = Math.round(((r + (br / 255) * ba1 * (1 - a)) / oa) * 255)
        observed[k + 1] = Math.round(((g + (bg / 255) * ba1 * (1 - a)) / oa) * 255)
        observed[k + 2] = Math.round(((b + (bb / 255) * ba1 * (1 - a)) / oa) * 255)
        observed[k + 3] = Math.round(oa * 255)
      }
    }
  }
  return { observed: { width, height, data: observed }, truth: { width, height, data: truth } }
}

export const solid = (colour: Rgba) => () => colour
export const WHITE: Rgba = [255, 255, 255, 255]

export interface WandClick {
  readonly x: number
  readonly y: number
  readonly tolerance: number
  readonly global?: boolean
  readonly mode?: 'new' | 'add' | 'subtract'
}

/** The selection the application's Magic Wand makes for these clicks. */
export function wand(pixels: PixelBuffer, ...clicks: WandClick[]): SelectionMask {
  let selection: SelectionMask | null = null
  for (const { x, y, tolerance, global = false, mode = 'new' } of clicks) {
    const result = createMagicWandSelection(pixels, { x, y }, { tolerance, floodMode: global ? 'global' : 'contiguous' })
    selection = combineSelections(selection, result, mode)
  }
  if (!selection) throw new Error('The Magic Wand selected nothing')
  return selection
}

/**
 * JPEG-like compression artefacts: each colour channel in 8 × 8 blocks through a DCT, quantised
 * with the standard luminance table at `quality` (1–100), and back. Alpha is kept.
 */
export function blockCompress(pixels: PixelBuffer, quality: number): PixelBuffer {
  const LUMA = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56,
    68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
  ]
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality
  const table = LUMA.map((q) => Math.max(1, Math.floor((q * scale + 50) / 100)))
  const cos = (i: number, u: number) => Math.cos(((2 * i + 1) * u * Math.PI) / 16)
  const alpha = (u: number) => (u === 0 ? Math.SQRT1_2 : 1)
  const { width, height } = pixels
  const out = new Uint8ClampedArray(pixels.data)
  const block = new Float64Array(64)
  const coefficients = new Float64Array(64)
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let c = 0; c < 3; c++) {
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            const x = Math.min(width - 1, bx + i)
            const y = Math.min(height - 1, by + j)
            block[j * 8 + i] = pixels.data[(y * width + x) * 4 + c] - 128
          }
        }
        for (let v = 0; v < 8; v++) {
          for (let u = 0; u < 8; u++) {
            let sum = 0
            for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) sum += block[j * 8 + i] * cos(i, u) * cos(j, v)
            const q = table[v * 8 + u]
            coefficients[v * 8 + u] = Math.round((0.25 * alpha(u) * alpha(v) * sum) / q) * q
          }
        }
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 8; i++) {
            let sum = 0
            for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) sum += alpha(u) * alpha(v) * coefficients[v * 8 + u] * cos(i, u) * cos(j, v)
            const x = bx + i
            const y = by + j
            if (x < width && y < height) out[(y * width + x) * 4 + c] = Math.round(0.25 * sum + 128)
          }
        }
      }
    }
  }
  return { width, height, data: out }
}

/**
 * Mean worst-case composite error (over black and over white, which bounds the error over any
 * background) of `out` against `truth`, over pixels within 3 px of a truth edge: the Step 7
 * report's "mean edge error", in levels 0–255.
 */
export function meanEdgeError(out: PixelBuffer, truth: PixelBuffer): number {
  const { width: W, height: H } = truth
  const t = truth.data
  const o = out.data
  const edge = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = t[(y * W + x) * 4 + 3]
      let isEdge = a !== 0 && a !== 255
      if (!isEdge && x + 1 < W) {
        const b = t[(y * W + x + 1) * 4 + 3]
        isEdge = (b === 0) !== (a === 0) || (b === 255) !== (a === 255)
      }
      if (!isEdge && y + 1 < H) {
        const b = t[((y + 1) * W + x) * 4 + 3]
        isEdge = (b === 0) !== (a === 0) || (b === 255) !== (a === 255)
      }
      if (isEdge) edge[y * W + x] = 1
    }
  }
  let sum = 0
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let near = false
      for (let yy = Math.max(0, y - 3); yy <= Math.min(H - 1, y + 3) && !near; yy++) {
        for (let xx = Math.max(0, x - 3); xx <= Math.min(W - 1, x + 3) && !near; xx++) near = edge[yy * W + xx] === 1
      }
      if (!near) continue
      const k = (y * W + x) * 4
      let worst = 0
      for (let c = 0; c < 3; c++) {
        const op = o[k + c] * o[k + 3]
        const tp = t[k + c] * t[k + 3]
        worst = Math.max(worst, Math.abs(op - tp) / 255, Math.abs(op + 255 * (255 - o[k + 3]) - tp - 255 * (255 - t[k + 3])) / 255)
      }
      sum += worst
      n++
    }
  }
  return sum / Math.max(1, n)
}

/** Indices of pixels whose bytes differ between two images of the same size. */
export function changedPixels(a: PixelBuffer, b: PixelBuffer): number[] {
  const changed: number[] = []
  for (let p = 0, k = 0; k < a.data.length; p++, k += 4) {
    if (a.data[k] !== b.data[k] || a.data[k + 1] !== b.data[k + 1] || a.data[k + 2] !== b.data[k + 2] || a.data[k + 3] !== b.data[k + 3]) changed.push(p)
  }
  return changed
}

/** 8-connected steps from pixel `p` to the nearest selected pixel, up to `limit` (limit + 1 if farther). */
export function stepsToSelection(selection: SelectionMask, p: number, limit: number): number {
  const { width, height, data } = selection
  const x = p % width
  const y = (p - x) / width
  for (let r = 0; r <= limit; r++) {
    for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) if (data[yy * width + xx] !== 0) return r
    }
  }
  return limit + 1
}

export interface EdgeCase extends Scene {
  readonly name: string
  /** The Magic Wand selection of the background. */
  readonly selection: SelectionMask
}

let cases: readonly EdgeCase[] | null = null

/**
 * The scenes of the Step 7 comparison, small: each with its truth and its Magic Wand selection.
 * Built once (supersampling takes a moment).
 */
export function edgeCases(): readonly EdgeCase[] {
  if (cases) return cases
  const black: Rgb = [0, 0, 0]
  const make = (name: string, s: Scene, ...clicks: WandClick[]): EdgeCase => ({ name, ...s, selection: wand(s.observed, ...clicks) })
  const icon = scene(64, 64, solid(WHITE), [
    { shape: disc(32, 32, 18), colour: black },
    { shape: rect(26.5, 26.5, 38.5, 38.5), colour: [255, 255, 255] },
  ])
  const logo = scene(80, 60, solid([42, 111, 219, 255]), [
    { shape: ring(25, 30, 12, 16), colour: [255, 255, 255] },
    { shape: polygon([[25, 20], [33, 37], [17, 37]]), colour: [255, 154, 31] },
    { shape: stroke(48, 20, 72, 20, 3), colour: [255, 255, 255] },
    { shape: stroke(48, 30, 70, 44, 2), colour: [255, 255, 255] },
  ])
  const gradient = scene(80, 60, (_x, y) => [Math.round(230 - (42 * y) / 59), Math.round(238 - (35 * y) / 59), Math.round(248 - (24 * y) / 59), 255], [
    { shape: disc(40, 30, 16), colour: [242, 194, 48] },
    { shape: ring(40, 30, 15, 17), colour: [58, 47, 10] },
  ])
  const jpeg = { observed: blockCompress(icon.observed, 80), truth: icon.truth }
  cases = [
    make('icon on white', icon, { x: 0, y: 0, tolerance: 20 }),
    make('anti-aliased logo on blue', logo, { x: 0, y: 0, tolerance: 10 }, { x: 25, y: 40, tolerance: 10, mode: 'add' }),
    make('lines and wiring', LINES(), { x: 0, y: 0, tolerance: 20, global: true }),
    make('gradient background', gradient, { x: 0, y: 0, tolerance: 15 }, { x: 0, y: 59, tolerance: 15, mode: 'add' }),
    make(
      'half-transparent background',
      scene(64, 48, solid([40, 40, 48, 128]), [
        { shape: disc(32, 24, 14), colour: [255, 140, 26] },
        { shape: stroke(8, 40.5, 56, 40.5, 1), colour: [255, 255, 255] },
      ]),
      { x: 0, y: 0, tolerance: 10 },
    ),
    make(
      'shapes touching the border',
      scene(48, 32, solid(WHITE), [
        { shape: disc(0, 16, 12), colour: [27, 58, 107] },
        { shape: rect(10, 28, 40, 32), colour: black },
        { shape: polygon([[36, 0], [48, 0], [48, 12]]), colour: [176, 32, 32] },
      ]),
      { x: 24, y: 14, tolerance: 20, global: true },
    ),
    make(
      'sharp corners',
      scene(80, 60, solid(WHITE), [
        { shape: polygon([[20, 8], [34, 22], [20, 36], [6, 22]]), colour: black },
        { shape: polygon([[46, 6], [49, 40], [43, 40]]), colour: [192, 20, 30] },
        { shape: rect(58, 10, 72, 40), colour: black },
      ]),
      { x: 0, y: 59, tolerance: 20, global: true },
    ),
    make('icon, JPEG artefacts', jpeg, { x: 0, y: 0, tolerance: 12 }),
  ]
  return cases
}

/**
 * Thin lines on white (80 × 60): aliased 1 px lines, anti-aliased 1 px lines at about 18° and 5°,
 * a 0.6 px hairline, a red 1 px wire and two single pixels.
 */
export function LINES(): Scene {
  const black: Rgb = [0, 0, 0]
  return scene(80, 60, solid(WHITE), [
    { shape: rect(5, 5, 75, 6), colour: black },
    { shape: rect(5, 8, 6, 55), colour: black },
    { shape: stroke(12, 14, 74, 34, 1), colour: black },
    { shape: stroke(12, 40, 74, 45, 1), colour: black },
    { shape: stroke(12, 52, 74, 57, 0.6), colour: black },
    { shape: stroke(20, 20.5, 40, 20.5, 1), colour: [208, 0, 0] },
    { shape: rect(50, 10, 51, 11), colour: black },
    { shape: rect(60, 12, 61, 13), colour: black },
  ])
}

/**
 * Random test images for property checks: either structured (a flat or noisy background with
 * anti-aliased shapes, some partly transparent, selected by the Magic Wand, sometimes Global)
 * or pure noise with a random mask. Small, so that many run quickly.
 */
export function randomEdgeCase(random: () => number): { pixels: PixelBuffer; selection: SelectionMask } | null {
  const width = 1 + Math.floor(random() * 40)
  const height = 1 + Math.floor(random() * 40)
  if (random() < 0.3) {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256)
    // Some fully transparent pixels with colour hidden under them.
    for (let p = 0; p < width * height; p++) if (random() < 0.1) data[p * 4 + 3] = 0
    const mask = new Uint8Array(width * height)
    for (let p = 0; p < mask.length; p++) mask[p] = random() < 0.5 ? 1 : 0
    const selection = createSelectionMask(width, height, mask)
    return selection && { pixels: { width, height, data }, selection }
  }
  const colour = (): Rgb => [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)]
  const bg = colour()
  const bgAlpha = random() < 0.2 ? Math.floor(random() * 256) : 255
  const noise = random() < 0.4 ? 1 + Math.floor(random() * 12) : 0
  const layers: Layer[] = []
  for (let n = 1 + Math.floor(random() * 4); n > 0; n--) {
    const x = random() * width
    const y = random() * height
    const size = 0.5 + random() * Math.max(width, height) * 0.4
    const kind = random()
    const shape = kind < 0.4 ? disc(x, y, size) : kind < 0.7 ? rect(x, y, x + size, y + size * random()) : stroke(x, y, random() * width, random() * height, 0.5 + random() * 3)
    layers.push({ shape, colour: colour(), opacity: random() < 0.2 ? random() : 1 })
  }
  const s = scene(width, height, (x, y) => {
    const n = noise ? (((x * 7349 + y * 1597) % 13) / 12 - 0.5) * 2 * noise : 0
    return [bg[0] + n, bg[1] + n, bg[2] + n, bgAlpha]
  }, layers, 3)
  const seed = { x: Math.floor(random() * width), y: Math.floor(random() * height) }
  const selection = createMagicWandSelection(s.observed, seed, { tolerance: 5 + Math.floor(random() * 30), floodMode: random() < 0.3 ? 'global' : 'contiguous' })
  return selection && { pixels: s.observed, selection }
}
