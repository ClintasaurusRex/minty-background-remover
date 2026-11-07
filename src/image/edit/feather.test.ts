import { describe, expect, it } from 'vitest'
import { randomSource } from '../../editor/history/testFixtures'
import type { PixelBuffer, SelectionMask } from '../../editor/types'
import { createSelectionMask } from '../selection/selectionMask'
import { deleteSelectedPixelData, deleteSelectedPixels } from './deleteSelection'
import { deleteSelectionWithEdges } from './deleteWithEdges'
import { emptyBounds } from './edgeBand'
import { featherSelectionEdges } from './feather'
import { LINES, WHITE, changedPixels, edgeCases, randomEdgeCase, rect, scene, solid, stepsToSelection, stroke, wand } from './edgeTestFixtures'

/*
 * Inward feathering with thin features protected (Phase 3 Step 8). Its output was verified byte
 * for byte against the scratch prototype it came from on the 14 Step 7 fixtures.
 */

const feathered = (pixels: PixelBuffer, selection: SelectionMask, feather: number, cleanup = 0, stripRows?: number) => {
  const result = deleteSelectionWithEdges(pixels, selection, { cleanup, feather }, stripRows)
  if (!result) throw new Error('Nothing deleted')
  return result
}
const exactDelete = (pixels: PixelBuffer, selection: SelectionMask) => deleteSelectedPixels(pixels, selection)!.pixels
const black = [0, 0, 0] as const

function allCases() {
  const random = randomSource(21)
  const out: { name: string; pixels: PixelBuffer; selection: SelectionMask }[] = edgeCases().map((c) => ({ name: c.name, pixels: c.observed, selection: c.selection }))
  while (out.length < 130) {
    const c = randomEdgeCase(random)
    if (c && deleteSelectedPixels(c.pixels, c.selection)) out.push({ name: `random ${out.length}`, ...c })
  }
  return out
}

/** Alpha at (x, y). */
const alphaAt = (image: PixelBuffer, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]

describe('feathering: guarantees', () => {
  it('lowers only the alpha of unselected, not fully transparent pixels within the feather distance', { timeout: 60000 }, () => {
    for (const { name, pixels, selection } of allCases()) {
      const deleted = exactDelete(pixels, selection)
      for (const feather of [1, 2, 3, 5]) {
        const out = feathered(pixels, selection, feather).pixels
        for (const p of changedPixels(deleted, out)) {
          const where = `${name}, ${feather} px, pixel ${p}`
          const k = p * 4
          expect(selection.data[p], where).toBe(0)
          expect(pixels.data[k + 3], where).toBeGreaterThan(0)
          expect(stepsToSelection(selection, p, feather), where).toBeLessThanOrEqual(feather)
          expect(out.data[k + 3], where).toBeLessThan(pixels.data[k + 3])
          // Colour is never changed: a pixel faded out keeps its own colour, hidden.
          expect([...out.data.subarray(k, k + 3)], where).toEqual([...pixels.data.subarray(k, k + 3)])
        }
      }
    }
  })

  it('gives the same result however the region is divided into strips', { timeout: 60000 }, () => {
    for (const { name, pixels, selection } of allCases()) {
      for (const [cleanup, feather] of [[0, 1], [0, 3], [0, 5], [2, 2], [5, 5]]) {
        const reference = feathered(pixels, selection, feather, cleanup, 0).pixels.data
        for (const rows of [1, 3, 17, 256]) {
          expect(feathered(pixels, selection, feather, cleanup, rows).pixels.data, `${name}, ${cleanup}/${feather}, ${rows} rows`).toEqual(reference)
        }
      }
    }
  })

  it('never writes the source pixels or the selection, and changes nothing at 0 px', () => {
    const c = edgeCases()[0]
    const pixelsBefore = c.observed.data.slice()
    const selectionBefore = c.selection.data.slice()
    feathered(c.observed, c.selection, 5, 5)
    expect(c.observed.data).toEqual(pixelsBefore)
    expect(c.selection.data).toEqual(selectionBefore)
    const deleted = deleteSelectedPixelData(c.observed, c.selection)!
    const copy = deleted.data.slice()
    expect(featherSelectionEdges(c.observed, c.selection, deleted.data, 0, emptyBounds())).toEqual({ changed: 0, changedFromSource: 0, madeTransparent: 0 })
    expect(deleted.data).toEqual(copy)
  })

  it('feathers from the alpha cleanup left, and restores the original colour under pixels it fades out', () => {
    for (const c of edgeCases()) {
      const cleanedOnly = feathered(c.observed, c.selection, 0, 2).pixels
      const both = feathered(c.observed, c.selection, 5, 2).pixels
      for (let p = 0, k = 0; k < both.data.length; p++, k += 4) {
        expect(both.data[k + 3], `${c.name}, pixel ${p}`).toBeLessThanOrEqual(cleanedOnly.data[k + 3])
        if (both.data[k + 3] === 0 && cleanedOnly.data[k + 3] > 0) {
          expect([...both.data.subarray(k, k + 3)], `${c.name}, pixel ${p}`).toEqual([...c.observed.data.subarray(k, k + 3)])
        }
      }
    }
  })
})

describe('feathering after cleanup', () => {
  it('restores the original colour, hidden, under a pixel cleanup recoloured and feathering faded out', () => {
    // White (deleted) | one faint grey column, a 1.6% blend of black | black.
    const data = new Uint8ClampedArray(20 * 5 * 4)
    for (let p = 0; p < 100; p++) data.set(p % 20 < 5 ? [255, 255, 255, 255] : p % 20 === 5 ? [251, 251, 251, 255] : [0, 0, 0, 255], p * 4)
    const pixels = { width: 20, height: 5, data }
    const selection = createSelectionMask(20, 5, Uint8Array.from({ length: 100 }, (_, p) => (p % 20 < 5 ? 1 : 0)))!
    const at = (image: PixelBuffer) => [...image.data.subarray((2 * 20 + 5) * 4, (2 * 20 + 5) * 4 + 4)]
    // Cleanup alone: black at alpha 4 (the background's share removed).
    expect(at(feathered(pixels, selection, 0, 1).pixels)).toEqual([0, 0, 0, 4])
    // Feathered 5 px on top: alpha 4 × 0.1 rounds to 0, and the pixel keeps its own colour, hidden.
    expect(at(feathered(pixels, selection, 5, 1).pixels)).toEqual([251, 251, 251, 0])
  })
})

describe('feathering: what it does', () => {
  it('fades a thick shape inward over the feather distance: alpha × (d − 0.5) / feather', () => {
    const square = scene(60, 60, solid(WHITE), [{ shape: rect(10, 10, 50, 50), colour: black }])
    const selection = wand(square.observed, { x: 0, y: 0, tolerance: 20 })
    for (const [feather, expected] of [
      [1, [128, 255, 255]],
      [3, [43, 128, 213, 255, 255]],
      [5, [26, 77, 128, 179, 230, 255]],
    ] as const) {
      const out = feathered(square.observed, selection, feather).pixels
      // Along the middle of the left edge, inward.
      expect(expected.map((_, i) => alphaAt(out, 10 + i, 30)), `${feather} px`).toEqual(expected)
      // The middle of the square is untouched; nothing outside it appears.
      expect(alphaAt(out, 30, 30)).toBe(255)
      expect(alphaAt(out, 9, 30)).toBe(0)
    }
  })

  it('never feathers thin lines, wiring, single pixels or small text', () => {
    const lines = LINES()
    const lineSelection = wand(lines.observed, { x: 0, y: 0, tolerance: 20, global: true })
    const glyphs = [stroke(5, 5, 5, 12, 1), stroke(5, 5, 9, 5, 1), stroke(5, 8.5, 8, 8.5, 1), stroke(5, 12, 9, 12, 1), stroke(12, 5, 17, 5, 1), stroke(14.5, 5, 14.5, 12, 1)]
    const text = scene(24, 18, solid(WHITE), glyphs.map((shape) => ({ shape, colour: black })))
    const textSelection = wand(text.observed, { x: 0, y: 0, tolerance: 20, global: true })
    for (const feather of [1, 2, 3, 4, 5]) {
      expect(feathered(lines.observed, lineSelection, feather).edgePixels, `lines, ${feather} px`).toBe(0)
      expect(feathered(text.observed, textSelection, feather).edgePixels, `text, ${feather} px`).toBe(0)
    }
  })

  it('leaves features up to 4 px across alone and keeps the middle of wider ones', () => {
    const bars = scene(60, 60, solid(WHITE), [1, 2, 3, 4, 5, 6].map((w, i) => ({ shape: rect(5, 4 + i * 9, 55, 4 + i * 9 + w), colour: black })))
    const selection = wand(bars.observed, { x: 0, y: 0, tolerance: 20, global: true })
    const columns = (out: PixelBuffer) => [1, 2, 3, 4, 5, 6].map((w, i) => Array.from({ length: w }, (_, j) => alphaAt(out, 30, 4 + i * 9 + j)))
    expect(columns(feathered(bars.observed, selection, 1).pixels)).toEqual([
      [255], [255, 255], [255, 255, 255], [255, 255, 255, 255], [128, 255, 255, 255, 128], [128, 255, 255, 255, 255, 128],
    ])
    // The fade is limited by the bar's thickness: 1.5 px for a 5 px bar, however large the feather.
    for (const feather of [3, 5]) {
      expect(columns(feathered(bars.observed, selection, feather).pixels)).toEqual([
        [255], [255, 255], [255, 255, 255], [255, 255, 255, 255], [85, 255, 255, 255, 85], [85, 255, 255, 255, 255, 85],
      ])
    }
  })

  it('starts only at the deleted selection: never at the image border or at pixels already transparent', () => {
    // A shape filling the left of the image; the white right part is deleted.
    const atBorder = scene(40, 20, solid(WHITE), [{ shape: rect(0, 0, 25, 20), colour: [30, 60, 120] }])
    const right = wand(atBorder.observed, { x: 39, y: 10, tolerance: 20 })
    const out = feathered(atBorder.observed, right, 5).pixels
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) expect(alphaAt(out, x, y), `${x}, ${y}`).toBe(255)
    expect(alphaAt(out, 24, 10)).toBeLessThan(255)

    // An opaque square on transparency, with only the area to its right selected: the other sides
    // border transparency already there and are not feathered.
    const data = new Uint8ClampedArray(40 * 20 * 4)
    for (let y = 5; y < 15; y++) for (let x = 5; x < 35; x++) data.set(x < 20 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * 40 + x) * 4)
    const mask = Uint8Array.from({ length: 800 }, (_, p) => (p % 40 >= 20 && p % 40 < 35 && p >= 5 * 40 && p < 15 * 40 ? 1 : 0))
    const pixels = { width: 40, height: 20, data }
    const result = feathered(pixels, createSelectionMask(40, 20, mask)!, 3).pixels
    // Left, top and bottom sides (next to old transparency): untouched, apart from the corners
    // near the deleted area.
    for (let y = 5; y < 15; y++) expect(alphaAt(result, 5, y)).toBe(255)
    for (let x = 5; x < 16; x++) {
      expect(alphaAt(result, x, 5)).toBe(255)
      expect(alphaAt(result, x, 14)).toBe(255)
    }
    expect(alphaAt(result, 19, 10)).toBe(43)
  })
})
