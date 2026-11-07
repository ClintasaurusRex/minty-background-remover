import { describe, expect, it } from 'vitest'
import { randomSource } from '../../editor/history/testFixtures'
import type { PixelBuffer, SelectionMask } from '../../editor/types'
import { createSelectionMask } from '../selection/selectionMask'
import { deleteSelectedPixelData, deleteSelectedPixels } from './deleteSelection'
import { deleteSelectionWithEdges } from './deleteWithEdges'
import { emptyBounds, trackedBounds } from './edgeBand'
import { cleanSelectionEdges } from './edgeCleanup'
import {
  type EdgeCase,
  LINES,
  WHITE,
  changedPixels,
  edgeCases,
  meanEdgeError,
  randomEdgeCase,
  rect,
  ring,
  scene,
  solid,
  stepsToSelection,
  stroke,
  wand,
} from './edgeTestFixtures'

/*
 * Edge cleanup (Candidate B, Phase 3 Step 8). Its output was verified byte for byte against the
 * Step 7 prototype on the 14 Step 7 fixtures (see IMPLEMENTATION_PLAN.md, Step 8); these tests
 * pin its guarantees and its accuracy on small scenes with exact ground truth.
 */

const cleaned = (pixels: PixelBuffer, selection: SelectionMask, cleanup: number, stripRows?: number) => {
  const result = deleteSelectionWithEdges(pixels, selection, { cleanup, feather: 0 }, stripRows)
  if (!result) throw new Error('Nothing deleted')
  return result
}
const exactDelete = (pixels: PixelBuffer, selection: SelectionMask) => deleteSelectedPixels(pixels, selection)!.pixels

/** Random cases with something to delete. */
function randomCases(count: number, seed: number) {
  const random = randomSource(seed)
  const out: { pixels: PixelBuffer; selection: SelectionMask }[] = []
  while (out.length < count) {
    const c = randomEdgeCase(random)
    if (c && deleteSelectedPixels(c.pixels, c.selection)) out.push(c)
  }
  return out
}

const allCases = (): { name: string; pixels: PixelBuffer; selection: SelectionMask }[] => [
  ...edgeCases().map((c) => ({ name: c.name, pixels: c.observed, selection: c.selection })),
  ...randomCases(120, 8).map((c, i) => ({ name: `random ${i}`, ...c })),
]

describe('edge cleanup: guarantees', () => {
  it('changes only unselected, not fully transparent pixels within the distance', { timeout: 60000 }, () => {
    for (const { name, pixels, selection } of allCases()) {
      for (const distance of [1, 2, 3, 5]) {
        const result = cleaned(pixels, selection, distance)
        for (const p of changedPixels(exactDelete(pixels, selection), result.pixels)) {
          const where = `${name}, ${distance} px, pixel ${p}`
          expect(selection.data[p], where).toBe(0)
          expect(pixels.data[p * 4 + 3], where).toBeGreaterThan(0)
          expect(stepsToSelection(selection, p, distance), where).toBeLessThanOrEqual(distance)
        }
      }
    }
  })

  it('never raises alpha, keeps selected pixels exactly as Delete leaves them, and keeps hidden colour', { timeout: 60000 }, () => {
    for (const { name, pixels, selection } of allCases()) {
      const deleted = exactDelete(pixels, selection)
      for (const distance of [1, 5]) {
        const out = cleaned(pixels, selection, distance).pixels.data
        for (let p = 0, k = 0; k < out.length; p++, k += 4) {
          const where = `${name}, ${distance} px, pixel ${p}`
          expect(out[k + 3], where).toBeLessThanOrEqual(pixels.data[k + 3])
          if (selection.data[p] !== 0) expect([...out.subarray(k, k + 4)], where).toEqual([...deleted.data.subarray(k, k + 4)])
          // A pixel cleanup made fully transparent keeps its original colour, hidden.
          if (out[k + 3] === 0) expect([...out.subarray(k, k + 3)], where).toEqual([...pixels.data.subarray(k, k + 3)])
        }
      }
    }
  })

  it('never reads the colour hidden under already transparent selected pixels', () => {
    const random = randomSource(3)
    for (const c of edgeCases()) {
      const variant = c.observed.data.slice()
      for (let p = 0; p < c.selection.data.length; p++) {
        if (c.selection.data[p] !== 0 && random() < 0.3) {
          variant[p * 4] = Math.floor(random() * 256)
          variant[p * 4 + 1] = Math.floor(random() * 256)
          variant[p * 4 + 2] = Math.floor(random() * 256)
          variant[p * 4 + 3] = 0
        }
      }
      const other = { width: c.observed.width, height: c.observed.height, data: variant }
      const hidden = variant.slice()
      for (let p = 0; p < c.selection.data.length; p++) {
        if (variant[p * 4 + 3] === 0) hidden.set([200, 10, 90], p * 4)
      }
      const sameButHidden = { ...other, data: hidden }
      const a = cleaned(other, c.selection, 3).pixels.data
      const b = cleaned(sameButHidden, c.selection, 3).pixels.data
      // Identical apart from the hidden colours themselves (which Delete keeps).
      for (let k = 0; k < a.length; k += 4) {
        if (variant[k + 3] === 0) expect(a[k + 3], c.name).toBe(0)
        else expect([...a.subarray(k, k + 4)], c.name).toEqual([...b.subarray(k, k + 4)])
      }
    }
  })

  it('gives the same result however the region is divided into strips', { timeout: 60000 }, () => {
    for (const { name, pixels, selection } of allCases()) {
      for (const distance of [1, 3, 5]) {
        const reference = cleaned(pixels, selection, distance, 0).pixels.data
        for (const rows of [1, 2, 7, 256]) expect(cleaned(pixels, selection, distance, rows).pixels.data, `${name}, ${distance} px, ${rows} rows`).toEqual(reference)
      }
    }
  })

  it('never writes the source pixels or the selection', () => {
    for (const { pixels, selection } of allCases().slice(0, 40)) {
      const pixelsBefore = pixels.data.slice()
      const selectionBefore = selection.data.slice()
      cleaned(pixels, selection, 5)
      expect(pixels.data).toEqual(pixelsBefore)
      expect(selection.data).toEqual(selectionBefore)
    }
  })

  it('writes only the edited copy, and changes nothing at distance 0', () => {
    const c = edgeCases()[0]
    const deleted = deleteSelectedPixelData(c.observed, c.selection)!
    const copy = deleted.data.slice()
    const bounds = emptyBounds()
    expect(cleanSelectionEdges(c.observed, c.selection, deleted.data, 0, bounds)).toEqual({ changed: 0, madeTransparent: 0 })
    expect(deleted.data).toEqual(copy)
    expect(trackedBounds(bounds)).toBeNull()
    const result = cleanSelectionEdges(c.observed, c.selection, deleted.data, 1, bounds)
    expect(result.changed).toBeGreaterThan(0)
    expect(changedPixels({ ...c.observed, data: copy }, { ...c.observed, data: deleted.data })).toHaveLength(result.changed)
  })

  it('changes nothing when nothing unselected is left next to the selection', () => {
    for (const c of edgeCases()) {
      const all = createSelectionMask(c.observed.width, c.observed.height, new Uint8Array(c.observed.width * c.observed.height).fill(1))!
      const result = cleaned(c.observed, all, 5)
      expect(result.edgePixels).toBe(0)
      expect(result.pixels.data).toEqual(exactDelete(c.observed, all).data)
    }
  })
})

describe('edge cleanup: accuracy on scenes with exact ground truth', () => {
  // Mean edge error (worst case over any background, levels) after exact Delete, and an upper
  // limit after 1 px of cleanup (measured values in the comments).
  const EXPECTED: Record<string, [deleteError: number, cleanedBelow: number]> = {
    'icon on white': [7.25, 1], // 0.47
    'anti-aliased logo on blue': [11.04, 1.5], // 0.92
    'lines and wiring': [10.12, 5.5], // 4.62
    'gradient background': [6.35, 1.5], // 0.93
    'half-transparent background': [3.07, 0.3], // 0.05
    'shapes touching the border': [5.01, 0.6], // 0.31
    'sharp corners': [6.81, 1.5], // 0.90
    'icon, JPEG artefacts': [9.11, 2], // 1.37
  }

  it.each(edgeCases().map((c) => [c.name, c] as const))('removes the background fringe: %s', (name, c: EdgeCase) => {
    const [deleteError, cleanedBelow] = EXPECTED[name]
    expect(meanEdgeError(exactDelete(c.observed, c.selection), c.truth)).toBeCloseTo(deleteError, 2)
    for (const distance of [1, 2, 5]) {
      const error = meanEdgeError(cleaned(c.observed, c.selection, distance).pixels, c.truth)
      expect(error, `${distance} px`).toBeLessThan(cleanedBelow)
    }
  })

  it('removes background colour from RGB as well as lowering alpha', () => {
    const c = edgeCases().find((e) => e.name === 'anti-aliased logo on blue')!
    const deleted = exactDelete(c.observed, c.selection)
    const out = cleaned(c.observed, c.selection, 1).pixels.data
    let both = 0
    for (const p of changedPixels(deleted, { ...deleted, data: out })) {
      const k = p * 4
      const rgbChanged = out[k] !== deleted.data[k] || out[k + 1] !== deleted.data[k + 1] || out[k + 2] !== deleted.data[k + 2]
      if (rgbChanged && out[k + 3] > 0 && out[k + 3] < deleted.data[k + 3]) both++
    }
    expect(both).toBeGreaterThan(50)
  })

  it('keeps every thin line, wire and single pixel, with its faint anti-aliasing', () => {
    const lines = LINES()
    const selection = wand(lines.observed, { x: 0, y: 0, tolerance: 20, global: true })
    for (const distance of [1, 2, 3, 4, 5]) {
      const out = cleaned(lines.observed, selection, distance).pixels.data
      for (let p = 0; p < selection.data.length; p++) {
        if (selection.data[p] !== 0) continue
        const truth = lines.truth.data[p * 4 + 3]
        // Cores within 32 levels of the truth, faint anti-aliasing never lost (Step 7 criteria).
        if (truth >= 128) expect(out[p * 4 + 3], `${distance} px, pixel ${p}`).toBeGreaterThanOrEqual(truth - 32)
        else if (truth >= 38) expect(out[p * 4 + 3], `${distance} px, pixel ${p}`).toBeGreaterThanOrEqual(truth - 48)
      }
    }
  })

  it('keeps small text intact', () => {
    const black = [0, 0, 0] as const
    const glyphs = [
      stroke(5, 5, 5, 12, 1), stroke(5, 5, 9, 5, 1), stroke(5, 8.5, 8, 8.5, 1), stroke(5, 12, 9, 12, 1), // E
      stroke(12, 5, 17, 5, 1), stroke(14.5, 5, 14.5, 12, 1), // T
      stroke(20, 5, 20, 9.5, 1), stroke(20, 9.5, 24, 9.5, 1), stroke(23, 5, 23, 12, 1), // 4
      stroke(27, 12, 30, 5, 1), stroke(30, 5, 33, 12, 1), stroke(28.3, 9.5, 31.7, 9.5, 1), // A
    ]
    const text = scene(40, 18, solid(WHITE), glyphs.map((shape) => ({ shape, colour: black })))
    const selection = wand(text.observed, { x: 0, y: 0, tolerance: 20, global: true })
    for (const distance of [1, 3, 5]) {
      const out = cleaned(text.observed, selection, distance).pixels.data
      for (let p = 0; p < selection.data.length; p++) {
        const truth = text.truth.data[p * 4 + 3]
        if (selection.data[p] !== 0 || truth < 38) continue
        expect(out[p * 4 + 3], `${distance} px, pixel ${p}`).toBeGreaterThanOrEqual(truth >= 128 ? truth - 32 : truth - 48)
      }
    }
  })

  it('restores the alpha of sharp corners', () => {
    const c = edgeCases().find((e) => e.name === 'sharp corners')!
    const tipError = (image: PixelBuffer, cx: number, cy: number) => {
      let sum = 0
      let n = 0
      for (let y = Math.floor(cy - 3); y <= cy + 3; y++) {
        for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > 2.5) continue
          const k = (y * image.width + x) * 4
          sum += Math.abs(image.data[k + 3] - c.truth.data[k + 3])
          n++
        }
      }
      return sum / n
    }
    const deleted = exactDelete(c.observed, c.selection)
    const out = cleaned(c.observed, c.selection, 1).pixels
    // The diamond's four 90° corners: about 32 levels of alpha error after Delete, none after cleanup.
    for (const [x, y] of [[20, 8], [34, 22], [20, 36], [6, 22]]) {
      expect(tipError(deleted, x, y)).toBeGreaterThan(25)
      expect(tipError(out, x, y)).toBeLessThan(2)
    }
    // The spike's faint tip pixels were selected by the Magic Wand: cleanup cannot bring them back.
    expect(tipError(out, 46, 6)).toBeCloseTo(tipError(deleted, 46, 6), 5)
  })

  it('leaves hard-edged graphics exactly as Delete leaves them', () => {
    const hard = scene(40, 30, solid(WHITE), [
      { shape: rect(5, 5, 15, 25), colour: [0, 0, 0] },
      { shape: rect(18, 8, 35, 12), colour: [200, 30, 30] },
      { shape: rect(18, 15, 19, 28), colour: [0, 90, 200] },
    ])
    const selection = wand(hard.observed, { x: 0, y: 0, tolerance: 20 })
    for (const distance of [1, 3, 5]) {
      const result = cleaned(hard.observed, selection, distance)
      expect(result.edgePixels).toBe(0)
      expect(result.pixels.data).toEqual(exactDelete(hard.observed, selection).data)
    }
  })

  it('never treats the image border as background', () => {
    const c = edgeCases().find((e) => e.name === 'shapes touching the border')!
    const out = cleaned(c.observed, c.selection, 5).pixels
    const { width, height } = out
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue
        const k = (y * width + x) * 4
        // Solid object pixels on the border keep full alpha.
        if (c.truth.data[k + 3] === 255 && c.selection.data[y * width + x] === 0) expect(out.data[k + 3], `${x}, ${y}`).toBe(255)
      }
    }
    // A shape filling the image's left columns, with nothing selected near the border: untouched there.
    const left = scene(30, 10, solid(WHITE), [{ shape: rect(0, 0, 12.5, 10), colour: [20, 20, 20] }])
    const selection = wand(left.observed, { x: 29, y: 5, tolerance: 20 })
    const changed = changedPixels(exactDelete(left.observed, selection), cleaned(left.observed, selection, 5).pixels)
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.every((p) => p % 30 >= 7)).toBe(true)
  })

  it('protects solid material next to an outline (twin rule) and what lies behind an outline (monotone rule)', () => {
    // White background | solid mid-grey 4 px | black 2 px | grey: a grey/black blend in colour only.
    const grey = scene(30, 8, solid(WHITE), [
      { shape: rect(10, 0, 14, 8), colour: [128, 128, 128] },
      { shape: rect(14, 0, 16, 8), colour: [0, 0, 0] },
      { shape: rect(16, 0, 30, 8), colour: [128, 128, 128] },
    ])
    const greySelection = wand(grey.observed, { x: 0, y: 0, tolerance: 10 })
    for (const distance of [1, 2, 3]) expect(cleaned(grey.observed, greySelection, distance).edgePixels, `${distance} px`).toBe(0)
    // Known limit (as in Step 7, rasterised SVG): once the distance covers the grey part's width
    // (4 px), the last grey column has only the black outline deeper in and is taken for a 50%
    // grey/black blend.
    for (const distance of [4, 5]) {
      const reached = cleaned(grey.observed, greySelection, distance)
      const changed = changedPixels(exactDelete(grey.observed, greySelection), reached.pixels)
      expect(changed.map((p) => p % 30), `${distance} px`).toEqual(Array(8).fill(13))
      expect(reached.pixels.data[13 * 4 + 3], `${distance} px`).toBeCloseTo(128, -1)
    }

    // A black ring around a white inside that is not selected: the inside keeps its pixels.
    const outlined = scene(40, 40, solid(WHITE), [{ shape: ring(20, 20, 8, 11), colour: [0, 0, 0] }])
    const outside = wand(outlined.observed, { x: 0, y: 0, tolerance: 20 })
    const result = cleaned(outlined.observed, outside, 5).pixels.data
    for (let y = 15; y < 25; y++) {
      for (let x = 15; x < 25; x++) expect(result[(y * 40 + x) * 4 + 3], `${x}, ${y}`).toBe(255)
    }
  })

  it('leaves a pixel alone when no neighbour explains it as a blend', () => {
    // A red pixel between the white background and black: neither a blend of white and black nor
    // of white and red at partial coverage.
    const data = new Uint8ClampedArray(7 * 3 * 4)
    for (let p = 0; p < 21; p++) data.set(p % 7 < 2 ? [255, 255, 255, 255] : p % 7 === 2 ? [255, 0, 0, 255] : [0, 0, 0, 255], p * 4)
    data.set([150, 60, 60, 255], (1 * 7 + 2) * 4)
    const pixels = { width: 7, height: 3, data }
    const selection = createSelectionMask(7, 3, Uint8Array.from({ length: 21 }, (_, p) => (p % 7 < 2 ? 1 : 0)))!
    const out = cleaned(pixels, selection, 3).pixels.data
    expect([...out.subarray((7 + 2) * 4, (7 + 2) * 4 + 4)]).toEqual([150, 60, 60, 255])
  })
})
