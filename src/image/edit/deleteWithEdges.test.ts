import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPixelPatch, createPixelPatch } from '../../editor/history/pixelPatch'
import { randomImage, randomMask, randomSource } from '../../editor/history/testFixtures'
import type { PixelBuffer, Rectangle, SelectionMask } from '../../editor/types'
import { copyPixelData } from '../pixelBuffer'
import { createSelectionMask } from '../selection/selectionMask'
import { deleteSelectedPixels } from './deleteSelection'
import { MAX_EDGE_PIXELS, NO_EDGE_TREATMENT, deleteSelectionWithEdges } from './deleteWithEdges'
import { changedPixels, disc, edgeCases, randomEdgeCase, rect, ring, scene, solid, stroke, wand } from './edgeTestFixtures'

// Counts full-image copies: one per Delete that changes something, whatever the edge settings.
vi.mock('../pixelBuffer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pixelBuffer')>()
  return { ...actual, copyPixelData: vi.fn(actual.copyPixelData) }
})
const copies = vi.mocked(copyPixelData)

beforeEach(() => {
  copies.mockClear()
})

const SETTINGS = [
  [1, 0],
  [2, 0],
  [5, 0],
  [0, 1],
  [0, 5],
  [2, 2],
  [5, 5],
] as const

function randomCases(count: number, seed: number) {
  const random = randomSource(seed)
  const out: { pixels: PixelBuffer; selection: SelectionMask }[] = []
  while (out.length < count) {
    const c = randomEdgeCase(random)
    if (c && deleteSelectedPixels(c.pixels, c.selection)) out.push(c)
  }
  return out
}

function tightBounds(width: number, changed: readonly number[]): Rectangle | null {
  if (changed.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (const p of changed) {
    const x = p % width
    const y = (p - x) / width
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

describe('deleteSelectionWithEdges with both settings at 0', () => {
  it('is exactly the Step 6 Delete: the same bytes, count and bounds', () => {
    const random = randomSource(5)
    for (let i = 0; i < 200; i++) {
      const width = 1 + Math.floor(random() * 30)
      const height = 1 + Math.floor(random() * 30)
      const pixels = randomImage(width, height, random)
      const selection = randomMask(width, height, random, random())
      const expected = deleteSelectedPixels(pixels, selection)
      const result = deleteSelectionWithEdges(pixels, selection, NO_EDGE_TREATMENT)
      if (!expected) {
        expect(result).toBeNull()
        continue
      }
      expect(result!.pixels.data).toEqual(expected.pixels.data)
      expect(result!.count).toBe(expected.count)
      expect(result!.bounds).toEqual(expected.bounds)
      expect(result!.edgePixels).toBe(0)
    }
    for (const c of edgeCases()) {
      const expected = deleteSelectedPixels(c.observed, c.selection)!
      const result = deleteSelectionWithEdges(c.observed, c.selection, { cleanup: 0, feather: 0 })!
      expect({ ...result, pixels: Array.from(result.pixels.data) }).toEqual({ ...expected, pixels: Array.from(expected.pixels.data), edgePixels: 0 })
    }
  })
})

describe('deleteSelectionWithEdges', () => {
  it('deletes every selected pixel exactly as Delete does, and changes only unselected pixels besides', () => {
    for (const { pixels, selection } of [...edgeCases().map((c) => ({ pixels: c.observed, selection: c.selection })), ...randomCases(60, 9)]) {
      const exact = deleteSelectedPixels(pixels, selection)!
      for (const [cleanup, feather] of SETTINGS) {
        const result = deleteSelectionWithEdges(pixels, selection, { cleanup, feather })!
        expect(result.count).toBe(exact.count)
        const differences = changedPixels(exact.pixels, result.pixels)
        expect(differences.every((p) => selection.data[p] === 0)).toBe(true)
        expect(result.edgePixels).toBe(differences.length)
      }
    }
  })

  it('reports the smallest rectangle containing every changed pixel, deleted or edge', () => {
    for (const { pixels, selection } of [...edgeCases().map((c) => ({ pixels: c.observed, selection: c.selection })), ...randomCases(60, 10)]) {
      for (const [cleanup, feather] of SETTINGS) {
        const result = deleteSelectionWithEdges(pixels, selection, { cleanup, feather })!
        expect(result.bounds).toEqual(tightBounds(pixels.width, changedPixels(pixels, result.pixels)))
      }
    }
  })

  it('records changes that Undo and Redo restore byte for byte, colour and alpha', () => {
    for (const { pixels, selection } of [...edgeCases().map((c) => ({ pixels: c.observed, selection: c.selection })), ...randomCases(40, 11)]) {
      for (const [cleanup, feather] of SETTINGS) {
        const result = deleteSelectionWithEdges(pixels, selection, { cleanup, feather })!
        const patch = createPixelPatch(pixels, result.pixels, result.bounds)!
        const undone = applyPixelPatch(result.pixels, patch)
        expect(undone.data).toEqual(pixels.data)
        expect(applyPixelPatch(undone, patch).data).toEqual(result.pixels.data)
      }
    }
  })

  it('makes one copy of the image, and none when nothing is deleted', () => {
    const c = edgeCases()[1]
    deleteSelectionWithEdges(c.observed, c.selection, { cleanup: 5, feather: 5 })
    expect(copies).toHaveBeenCalledTimes(1)
    copies.mockClear()
    expect(deleteSelectionWithEdges(c.observed, null, { cleanup: 5, feather: 5 })).toBeNull()
    // Only already transparent pixels selected: nothing is deleted, so the edge is not treated either.
    const data = c.observed.data.slice()
    for (let p = 0; p < c.selection.data.length; p++) if (c.selection.data[p]) data[p * 4 + 3] = 0
    expect(deleteSelectionWithEdges({ ...c.observed, data }, c.selection, { cleanup: 5, feather: 5 })).toBeNull()
    expect(copies).not.toHaveBeenCalled()
  })

  it('never writes the pixels or the selection given', () => {
    for (const c of edgeCases()) {
      const pixels = c.observed.data.slice()
      const selection = c.selection.data.slice()
      deleteSelectionWithEdges(c.observed, c.selection, { cleanup: 5, feather: 5 })
      expect(c.observed.data).toEqual(pixels)
      expect(c.selection.data).toEqual(selection)
    }
  })

  it('treats nothing beyond the Delete when the whole image is selected', () => {
    const c = edgeCases()[0]
    const everything = createSelectionMask(c.observed.width, c.observed.height, new Uint8Array(c.observed.width * c.observed.height).fill(1))!
    const result = deleteSelectionWithEdges(c.observed, everything, { cleanup: 5, feather: 5 })!
    expect(result.edgePixels).toBe(0)
    expect(result.pixels.data).toEqual(deleteSelectedPixels(c.observed, everything)!.pixels.data)
  })

  it('treats only the edge next to the deleted pixels: transparency already in the image stops it', () => {
    // White (selected) | a column already fully transparent | a grey and black object.
    const data = new Uint8ClampedArray(30 * 6 * 4)
    for (let p = 0; p < 180; p++) {
      const x = p % 30
      data.set(x < 6 ? [255, 255, 255, 255] : x === 6 ? [255, 255, 255, 0] : x === 7 ? [128, 128, 128, 255] : [0, 0, 0, 255], p * 4)
    }
    const pixels = { width: 30, height: 6, data }
    const selection = createSelectionMask(30, 6, Uint8Array.from({ length: 180 }, (_, p) => (p % 30 < 6 ? 1 : 0)))!
    for (const [cleanup, feather] of SETTINGS) {
      const result = deleteSelectionWithEdges(pixels, selection, { cleanup, feather })!
      expect(result.edgePixels, `${cleanup}/${feather}`).toBe(0)
      expect(result.pixels.data).toEqual(deleteSelectedPixels(pixels, selection)!.pixels.data)
    }
  })

  it('treats both edges of a Global selection of separate areas', () => {
    const two = scene(60, 30, solid([255, 255, 255, 255]), [
      { shape: disc(15, 15, 8), colour: [0, 0, 0] },
      { shape: ring(45, 15, 5, 9), colour: [200, 0, 0] },
    ])
    // Global: the background and the ring's inside, two areas.
    const selection = wand(two.observed, { x: 0, y: 0, tolerance: 20, global: true })
    expect(selection.data[15 * 60 + 45]).toBe(1)
    const changed = changedPixels(deleteSelectedPixels(two.observed, selection)!.pixels, deleteSelectionWithEdges(two.observed, selection, { cleanup: 1, feather: 0 })!.pixels)
    const insideRing = changed.filter((p) => (Math.abs((p % 60) - 45) < 6 && Math.abs(Math.floor(p / 60) - 15) < 6))
    expect(insideRing.length).toBeGreaterThan(0)
    expect(changed.length).toBeGreaterThan(insideRing.length)
  })

  it('rejects amounts that are not whole numbers from 0 to 5', () => {
    const c = edgeCases()[0]
    expect(MAX_EDGE_PIXELS).toBe(5)
    for (const bad of [-1, 6, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => deleteSelectionWithEdges(c.observed, c.selection, { cleanup: bad, feather: 0 })).toThrow(RangeError)
      expect(() => deleteSelectionWithEdges(c.observed, c.selection, { cleanup: 0, feather: bad })).toThrow(RangeError)
    }
    expect(copies).not.toHaveBeenCalled()
  })

  it('gives exactly the results verified against the Step 7 prototype (regression lock)', () => {
    // FNV-1a hashes of the output bytes for cleanup / feather 1/0, 3/0, 0/2, 2/2 and 5/5. A change
    // means the algorithm changed: compare it with the Step 7 fixtures again before updating these.
    const GOLDEN: Record<string, readonly number[]> = {
      'icon on white': [0x86923acc, 0x86923acc, 0xc9815944, 0xa6ee16c4, 0xe44c2404],
      'anti-aliased logo on blue': [0x31ef2a85, 0x31ef2a85, 0x6c153615, 0x5cb292f5, 0x72b1c2ad],
      'lines and wiring': [0x01ab035d, 0x01ab035d, 0xcf8d5694, 0x01ab035d, 0x01ab035d],
      'gradient background': [0xabc23b55, 0x3639e731, 0x9abe7fbd, 0xd3896a01, 0x4d1b48ad],
      'half-transparent background': [0xaf4911c5, 0xaf4911c5, 0x402c3ecd, 0xeceef20d, 0x3b57bb4d],
      'shapes touching the border': [0xc521572d, 0xc521572d, 0x299c2d37, 0xc8a4193b, 0x16929511],
      'sharp corners': [0xcb76cb4d, 0xcb76cb4d, 0xa0c42341, 0x694f4211, 0xdea22af9],
      'icon, JPEG artefacts': [0x39533593, 0xf1746da3, 0xc94965b3, 0x825e8af3, 0x08ea0193],
    }
    const hash = (bytes: ArrayLike<number>) => {
      let h = 0x811c9dc5
      for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619)
      return h >>> 0
    }
    for (const c of edgeCases()) {
      const hashes = [[1, 0], [3, 0], [0, 2], [2, 2], [5, 5]].map(([cleanup, feather]) => hash(deleteSelectionWithEdges(c.observed, c.selection, { cleanup, feather })!.pixels.data))
      expect(hashes, c.name).toEqual(GOLDEN[c.name])
    }
  })

  it('handles a larger, edge-dense image: one copy, the same result in any strips, exact Undo', { timeout: 60000 }, () => {
    // 1200 × 800: a tiled pattern of shapes, wires and outlines on grey (no timing is asserted).
    const tileScene = scene(120, 80, solid([200, 200, 200, 255]), [
      { shape: disc(40, 40, 22), colour: [120, 125, 135] },
      { shape: ring(40, 40, 21, 23), colour: [40, 42, 50] },
      { shape: rect(70, 20, 110, 40), colour: [42, 90, 160] },
      { shape: stroke(5, 70, 115, 62, 1), colour: [0, 0, 0] },
    ], 3)
    const width = 1200
    const height = 800
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(tileScene.observed.data.subarray(((y % 80) * 120 + (x % 120)) * 4, ((y % 80) * 120 + (x % 120)) * 4 + 4), (y * width + x) * 4)
    const pixels = { width, height, data }
    const selection = wand(pixels, { x: 0, y: 0, tolerance: 10 })
    const result = deleteSelectionWithEdges(pixels, selection, { cleanup: 3, feather: 3 })!
    expect(copies).toHaveBeenCalledTimes(1)
    expect(result.edgePixels).toBeGreaterThan(10000)
    expect(deleteSelectionWithEdges(pixels, selection, { cleanup: 3, feather: 3 }, 0)!.pixels.data).toEqual(result.pixels.data)
    expect(deleteSelectionWithEdges(pixels, selection, { cleanup: 3, feather: 3 }, 50)!.pixels.data).toEqual(result.pixels.data)
    const patch = createPixelPatch(pixels, result.pixels, result.bounds)!
    expect(applyPixelPatch(result.pixels, patch).data).toEqual(pixels.data)
  })
})
