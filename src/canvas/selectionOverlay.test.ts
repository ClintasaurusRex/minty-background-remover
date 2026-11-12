import { describe, expect, it } from 'vitest'
import type { Rectangle, SelectionMask } from '../editor/types'
import { createSelectionMask } from '../image/selection/selectionMask'
import { selectAll } from '../image/selection/selectionOperations'
import { maskBytes } from '../image/selection/testFixtures'
import { pixelUnderPointer } from './coordinates'
import { imageDrawBias, snapToDevicePixels } from './devicePixels'
import { intersect, planFrame } from './rendering'
import {
  type BoundaryPattern,
  MARCHING_ANTS_PHASES,
  OVERLAY_PIXELS,
  OVERLAY_TILE_SIZE,
  STATIC_BOUNDARY,
  boundaryLineWidth,
  marchingBoundary,
  overlayContentRect,
  paintOverlayBoundary,
  planSelectionOverlay,
  rasteriseOverlayTile,
  rasteriseSelectionOverlay,
  repaintOverlayBoundary,
  selectionStates,
} from './selectionOverlay'

const { transparent, tint, dark, light } = OVERLAY_PIXELS

/** A mask from a character map: `#` selected, `.` not. */
function mask(...rows: string[]): SelectionMask {
  const { width, height, data } = maskBytes(...rows)
  const selection = createSelectionMask(width, height, data)
  if (!selection) throw new Error('Empty mask')
  return selection
}

/** A deterministic random mask with about `density` of its pixels selected. */
function randomMask(width: number, height: number, density: number, seed: number): SelectionMask {
  let state = seed
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    data[i] = state / 2 ** 32 < density ? 1 : 0
  }
  data[0] = 1 // never empty
  return createSelectionMask(width, height, data)!
}

function rasterise(
  selection: SelectionMask,
  scale: number,
  lineWidth: number,
  rect: Rectangle,
  pattern: BoundaryPattern = STATIC_BOUNDARY,
) {
  const pixels = new Uint32Array(rect.width * rect.height)
  const drawn = rasteriseSelectionOverlay(selection, scale, lineWidth, rect, pixels, rect.width, pattern)
  return { drawn, pixels }
}

/**
 * The overlay as characters: `.` transparent, `T` tint, and boundary pixels on the selected
 * (`i`, inner) or unselected (`o`, outer) side of the edge. Which side a boundary pixel is on
 * follows from its colour and its checkerboard cell.
 */
function picture(selection: SelectionMask, scale: number, lineWidth: number, rect: Rectangle): string[] {
  const { pixels } = rasterise(selection, scale, lineWidth, rect)
  const cell = 4 * lineWidth
  const rows: string[] = []
  for (let r = 0; r < rect.height; r++) {
    let row = ''
    for (let c = 0; c < rect.width; c++) {
      const pixel = pixels[r * rect.width + c]
      const parity = (Math.floor((rect.x + c) / cell) + Math.floor((rect.y + r) / cell)) & 1
      if (pixel === transparent) row += '.'
      else if (pixel === tint) row += 'T'
      else if (pixel === light) row += (1 ^ parity) === 1 ? 'i' : 'o'
      else if (pixel === dark) row += parity === 1 ? 'i' : 'o'
      else row += '?'
    }
    rows.push(row)
  }
  return rows
}

/**
 * Reference rasteriser, one device pixel at a time: boundary where the square window of
 * 2 × lineWidth + 1 pixels holds both states, coloured by the side and the checkerboard cell
 * (static) or the diagonal stripe floor((x + y − phase × lineWidth) / (4 × lineWidth)) (marching).
 */
function referenceRaster(
  selection: SelectionMask,
  scale: number,
  lineWidth: number,
  rect: Rectangle,
  pattern: BoundaryPattern = STATIC_BOUNDARY,
): Uint32Array {
  const m = lineWidth
  const outer = { x: rect.x - m, y: rect.y - m, width: rect.width + 2 * m, height: rect.height + 2 * m }
  const states = selectionStates(selection, scale, outer)
  const cell = 4 * lineWidth
  const pixels = new Uint32Array(rect.width * rect.height)
  for (let r = 0; r < rect.height; r++) {
    for (let c = 0; c < rect.width; c++) {
      let any = false
      let all = true
      for (let dy = 0; dy <= 2 * m; dy++) {
        for (let dx = 0; dx <= 2 * m; dx++) {
          const value = states[(r + dy) * outer.width + c + dx] === 1
          any ||= value
          all &&= value
        }
      }
      const selected = states[(r + m) * outer.width + c + m]
      const x = rect.x + c
      const y = rect.y + r
      const stripe =
        pattern.kind === 'static'
          ? Math.floor(x / cell) + Math.floor(y / cell)
          : Math.floor((x + y - pattern.phase * lineWidth) / cell)
      const parity = (stripe + selected) & 1
      pixels[r * rect.width + c] = any && !all ? (parity === 1 ? light : dark) : selected ? tint : transparent
    }
  }
  return pixels
}

/** Whether any image pixel overlapping device pixel (column, row) is selected, by interval overlap. */
function referenceZoomedOut(selection: SelectionMask, scale: number, column: number, row: number): number {
  const overlaps = (pixel: number, device: number) => pixel < (device + 1) / scale - 1e-9 && pixel + 1 > device / scale + 1e-9
  for (let y = Math.max(0, Math.floor(row / scale) - 1); y <= Math.min(selection.height - 1, Math.ceil((row + 1) / scale)); y++) {
    if (!overlaps(y, row)) continue
    for (let x = Math.max(0, Math.floor(column / scale) - 1); x <= Math.min(selection.width - 1, Math.ceil((column + 1) / scale)); x++) {
      if (overlaps(x, column) && selection.data[y * selection.width + x] === 1) return 1
    }
  }
  return 0
}

describe('selectionStates', () => {
  it('marks exactly the pixels a click would select, at 100% and above', () => {
    const selection = randomMask(23, 17, 0.5, 7)
    for (const ratio of [1, 1.25, 1.5, 2, 2.5]) {
      for (const zoom of [1, 1.5, 2, 2.5, 3.7, 4.37, 8, 32, 1 / ratio, 1.2]) {
        const scale = zoom * ratio
        if (scale < 1) continue
        const viewport = snapToDevicePixels({ zoom, offset: { x: 5.3, y: 3.9 } }, ratio)
        const origin = { x: Math.round(viewport.offset.x * ratio), y: Math.round(viewport.offset.y * ratio) }
        const rect = { x: -3, y: -3, width: Math.min(120, Math.ceil(23 * scale) + 6), height: Math.min(90, Math.ceil(17 * scale) + 6) }
        const states = selectionStates(selection, scale, rect)
        for (let r = 0; r < rect.height; r++) {
          for (let c = 0; c < rect.width; c++) {
            const point = { x: (origin.x + rect.x + c + 0.5) / ratio, y: (origin.y + rect.y + r + 0.5) / ratio }
            const pixel = pixelUnderPointer(viewport, point, selection, ratio)
            const expected = pixel ? selection.data[pixel.y * selection.width + pixel.x] : 0
            expect(states[r * rect.width + c], `ratio ${ratio}, zoom ${zoom}, device ${c}, ${r}`).toBe(expected)
          }
        }
      }
    }
  })

  it('marks a device pixel when any image pixel it covers is selected, when zoomed out', () => {
    for (const density of [0.03, 0.5]) {
      const selection = randomMask(97, 61, density, 3)
      for (const scale of [0.9, 0.5, 0.37, 1 / 3, 0.25, 0.1, 0.03]) {
        const rect = { x: -2, y: -2, width: Math.ceil(97 * scale) + 4, height: Math.ceil(61 * scale) + 4 }
        const states = selectionStates(selection, scale, rect)
        for (let r = 0; r < rect.height; r++) {
          for (let c = 0; c < rect.width; c++) {
            expect(states[r * rect.width + c], `scale ${scale}, device ${c}, ${r}`).toBe(
              referenceZoomedOut(selection, scale, rect.x + c, rect.y + r),
            )
          }
        }
      }
    }
  })

  it('never loses a single selected pixel when zoomed out', () => {
    for (const [x, y] of [
      [0, 0],
      [4999, 2999],
      [8659, 5772],
      [1234, 77],
    ]) {
      const data = new Uint8Array(8660 * 5773)
      data[y * 8660 + x] = 1
      const selection = createSelectionMask(8660, 5773, data)!
      for (const scale of [0.9, 0.5, 0.1, 0.0187, 0.01]) {
        // Only device pixels next to the selected one can be marked.
        const rect = { x: Math.floor(x * scale) - 4, y: Math.floor(y * scale) - 4, width: 9, height: 9 }
        const states = selectionStates(selection, scale, rect)
        const marked = states.reduce((sum, value) => sum + value, 0)
        expect(marked, `pixel ${x}, ${y} at scale ${scale}`).toBeGreaterThanOrEqual(1)
        expect(marked).toBeLessThanOrEqual(4)
        expect(states[4 * rect.width + 4]).toBe(1)
      }
    }
  })

  it('leaves device pixels outside the image unselected', () => {
    const selection = selectAll(4, 3)
    expect(Array.from(selectionStates(selection, 2, { x: -2, y: -1, width: 12, height: 8 }))).toEqual(
      [
        '............',
        '..11111111..',
        '..11111111..',
        '..11111111..',
        '..11111111..',
        '..11111111..',
        '..11111111..',
        '............',
      ]
        .join('')
        .split('')
        .map((cell) => (cell === '1' ? 1 : 0)),
    )
  })
})

describe('rasteriseSelectionOverlay', () => {
  it('draws a selected pixel with an inner and an outer boundary at 100%', () => {
    expect(picture(mask('.....', '.....', '..#..', '.....', '.....'), 1, 1, { x: 0, y: 0, width: 5, height: 5 })).toEqual([
      '.....',
      '.ooo.',
      '.oio.',
      '.ooo.',
      '.....',
    ])
  })

  it('outlines the square a pixel is drawn in when zoomed in, and tints its inside', () => {
    expect(picture(mask('#'), 4, 1, { x: -2, y: -2, width: 8, height: 8 })).toEqual([
      '........',
      '.oooooo.',
      '.oiiiio.',
      '.oiTTio.',
      '.oiTTio.',
      '.oiiiio.',
      '.oooooo.',
      '........',
    ])
  })

  it('outlines disconnected regions and holes separately', () => {
    const selection = mask(
      '.........',
      '.###.....',
      '.#.#..##.',
      '.###..##.',
      '.........',
      '.........',
      '....#....',
    )
    expect(picture(selection, 1, 1, { x: -1, y: -1, width: 11, height: 9 })).toEqual([
      '...........',
      '.ooooo.....',
      '.oiiiooooo.',
      '.oioiooiio.',
      '.oiiiooiio.',
      '.ooooooooo.',
      '....ooo....',
      '....oio....',
      '....ooo....',
    ])
  })

  it('tints a full selection and outlines the image edge, inside and out', () => {
    expect(picture(selectAll(6, 4), 1, 1, { x: -2, y: -2, width: 10, height: 8 })).toEqual([
      '..........',
      '.oooooooo.',
      '.oiiiiiio.',
      '.oiTTTTio.',
      '.oiTTTTio.',
      '.oiiiiiio.',
      '.oooooooo.',
      '..........',
    ])
  })

  it('makes the boundary lineWidth device pixels wide on each side', () => {
    expect(picture(mask('#'), 6, 2, { x: -3, y: -3, width: 12, height: 12 })).toEqual([
      '............',
      '.oooooooooo.',
      '.oooooooooo.',
      '.ooiiiiiioo.',
      '.ooiiiiiioo.',
      '.ooiiTTiioo.',
      '.ooiiTTiioo.',
      '.ooiiiiiioo.',
      '.ooiiiiiioo.',
      '.oooooooooo.',
      '.oooooooooo.',
      '............',
    ])
  })

  it('alternates black and white along every edge, on both sides, so it shows on any background', () => {
    for (const lineWidth of [1, 2]) {
      const cell = 4 * lineWidth
      // An edge inside a checkerboard row of cells (after row 2), and one on a cell boundary.
      for (const edge of [2, cell]) {
        const rows = edge + lineWidth + 1
        const selection = mask(...Array.from({ length: rows }, (_, y) => (y < edge ? '#' : '.').repeat(64)))
        const { pixels } = rasterise(selection, 1, lineWidth, { x: 0, y: 0, width: 64, height: rows })
        for (const row of [edge - lineWidth, edge - 1, edge, edge + lineWidth - 1]) {
          for (let x = 0; x < 64; x++) {
            const colour = pixels[row * 64 + x]
            expect([dark, light]).toContain(colour)
            // The colour swaps at every cell along the edge, so both colours are on each side.
            if (x > 0) expect(colour === pixels[row * 64 + x - 1]).toBe(x % cell !== 0)
          }
        }
        // Across the edge the two sides take opposite colours within a cell, and the same colour
        // where the edge is also a cell boundary (the colours swap there too).
        for (let x = 0; x < 64; x++) {
          const inner = pixels[(edge - 1) * 64 + x]
          const outer = pixels[edge * 64 + x]
          expect(inner === outer).toBe(edge % cell === 0)
        }
      }
    }
  })

  it('matches the reference rasteriser for any selection, zoom, line width and tile', () => {
    const masks = [randomMask(61, 47, 0.5, 11), randomMask(61, 47, 0.04, 12), randomMask(61, 47, 0.96, 13), selectAll(61, 47)]
    const rects = [
      { x: -5, y: -3, width: 37, height: 53 },
      { x: 20, y: 11, width: 64, height: 40 },
      { x: -40, y: -40, width: 33, height: 31 },
    ]
    const fullTile = { x: 0, y: 0, width: OVERLAY_TILE_SIZE, height: OVERLAY_TILE_SIZE }
    const check = (selection: SelectionMask, scale: number, lineWidth: number, rect: Rectangle) => {
      const expected = referenceRaster(selection, scale, lineWidth, rect)
      const { drawn, pixels } = rasterise(selection, scale, lineWidth, rect)
      const label = `scale ${scale}, line ${lineWidth}, rect ${JSON.stringify(rect)}`
      expect(drawn, label).toBe(expected.some((pixel) => pixel !== transparent))
      if (!drawn) return
      const mismatch = pixels.findIndex((pixel, i) => pixel !== expected[i])
      expect(mismatch, `${label}: first difference at ${mismatch % rect.width}, ${Math.floor(mismatch / rect.width)}`).toBe(-1)
    }
    for (const selection of masks) {
      for (const scale of [0.3, 0.5, 0.9, 1, 1.5, 2.5, 4.37, 8]) {
        for (const lineWidth of [1, 2, 3]) {
          for (const rect of rects) check(selection, scale, lineWidth, rect)
        }
      }
      for (const scale of [0.5, 1, 2.5]) check(selection, scale, 1, fullTile)
    }
  })

  it('writes only the rectangle it is given and leaves the output untouched when nothing is drawn', () => {
    const selection = randomMask(40, 30, 0.5, 5)
    const rect = { x: 3, y: 2, width: 45, height: 20 }
    const stride = 57
    const out = new Uint32Array(stride * 25).fill(0xdeadbeef)
    expect(rasteriseSelectionOverlay(selection, 1.5, 1, rect, out, stride)).toBe(true)
    for (let r = 0; r < 25; r++) {
      for (let c = 0; c < stride; c++) {
        if (r >= rect.height || c >= rect.width) expect(out[r * stride + c]).toBe(0xdeadbeef)
      }
    }
    const untouched = new Uint32Array(64).fill(0xdeadbeef)
    expect(rasteriseSelectionOverlay(selection, 1, 1, { x: 500, y: 500, width: 8, height: 8 }, untouched, 8)).toBe(false)
    expect(untouched.every((pixel) => pixel === 0xdeadbeef)).toBe(true)
  })

  it('draws nothing outside the content rectangle', () => {
    for (const selection of [mask('...', '.#.', '...'), randomMask(30, 20, 0.3, 9)]) {
      for (const scale of [0.4, 1, 1.5, 3]) {
        for (const lineWidth of [1, 2]) {
          const content = overlayContentRect(selection, scale, lineWidth)
          const around = { x: content.x - 9, y: content.y - 9, width: content.width + 18, height: content.height + 18 }
          const { pixels } = rasterise(selection, scale, lineWidth, around)
          for (let r = 0; r < around.height; r++) {
            for (let c = 0; c < around.width; c++) {
              const inside = intersect({ x: around.x + c, y: around.y + r, width: 1, height: 1 }, content)
              if (!inside) expect(pixels[r * around.width + c]).toBe(transparent)
            }
          }
        }
      }
    }
  })

  it('never modifies the selection', () => {
    const selection = randomMask(50, 40, 0.5, 21)
    const before = { ...selection, data: selection.data.slice(), bounds: { ...selection.bounds } }
    for (const scale of [0.2, 0.5, 1, 2.5]) {
      const plan = planSelectionOverlay({
        selection,
        viewport: { zoom: scale, offset: { x: 3, y: 4 } },
        viewportSize: { width: 300, height: 200 },
        devicePixelRatio: 1,
      })
      const out = new Uint32Array(OVERLAY_TILE_SIZE * OVERLAY_TILE_SIZE)
      for (const tile of plan.tiles) rasteriseSelectionOverlay(selection, plan.scale, plan.lineWidth, tile.rect, out, OVERLAY_TILE_SIZE)
    }
    expect(selection.data).toEqual(before.data)
    expect(selection.bounds).toEqual(before.bounds)
    expect(selection.count).toBe(before.count)
  })
})

/** Compares pixel arrays quickly, reporting the first difference. */
function expectSamePixels(actual: Uint32Array, expected: Uint32Array, label = '') {
  expect(actual.length, label).toBe(expected.length)
  const mismatch = actual.findIndex((pixel, i) => pixel !== expected[i])
  expect(mismatch, `${label}: first difference at index ${mismatch}`).toBe(-1)
}

/** `.` transparent, `T` tint, `B` boundary (black or white): what a pattern must never change. */
function classes(pixels: Uint32Array): string {
  return Array.from(pixels, (pixel) => (pixel === transparent ? '.' : pixel === tint ? 'T' : pixel === dark || pixel === light ? 'B' : '?')).join('')
}

const ALL_PATTERNS: readonly BoundaryPattern[] = [
  STATIC_BOUNDARY,
  ...Array.from({ length: MARCHING_ANTS_PHASES }, (_, phase) => marchingBoundary(phase)),
]

describe('boundary patterns', () => {
  it('has one shared pattern object per marching phase, taken modulo the period', () => {
    expect(MARCHING_ANTS_PHASES).toBe(8)
    expect(marchingBoundary(3)).toBe(marchingBoundary(3))
    expect(marchingBoundary(3)).toBe(marchingBoundary(11))
    expect(marchingBoundary(-1)).toBe(marchingBoundary(7))
    expect(marchingBoundary(0)).toEqual({ kind: 'marching', phase: 0 })
    expect(STATIC_BOUNDARY).toEqual({ kind: 'static' })
    expect(new Set(ALL_PATTERNS).size).toBe(9)
  })

  it('draws the static checkerboard unless a pattern is given', () => {
    const selection = randomMask(40, 30, 0.5, 3)
    const rect = { x: -4, y: -2, width: 50, height: 37 }
    expectSamePixels(rasterise(selection, 1.5, 1, rect).pixels, rasterise(selection, 1.5, 1, rect, STATIC_BOUNDARY).pixels)
  })

  it('matches the reference rasteriser at every marching phase, zoom, line width and tile', () => {
    const masks = [randomMask(61, 47, 0.5, 31), randomMask(61, 47, 0.05, 32), selectAll(61, 47)]
    const rects = [
      { x: -5, y: -3, width: 37, height: 53 },
      { x: 20, y: 11, width: 70, height: 40 },
      { x: -40, y: -40, width: 33, height: 31 },
    ]
    for (const selection of masks) {
      for (const scale of [0.3, 0.9, 1, 1.5, 2.5, 8]) {
        for (const lineWidth of [1, 2, 3]) {
          for (const rect of rects) {
            for (const pattern of ALL_PATTERNS) {
              const expected = referenceRaster(selection, scale, lineWidth, rect, pattern)
              const { pixels } = rasterise(selection, scale, lineWidth, rect, pattern)
              const mismatch = pixels.findIndex((pixel, i) => pixel !== expected[i])
              expect(mismatch, `scale ${scale}, line ${lineWidth}, ${JSON.stringify(rect)}, ${JSON.stringify(pattern)}`).toBe(-1)
            }
          }
        }
      }
    }
  })

  it('never changes which pixels are tint, boundary or transparent, only black and white', () => {
    const selection = mask(
      '..........',
      '.####.....',
      '.#..#..##.',
      '.####..##.',
      '..........',
      '....#.....',
    )
    for (const [scale, lineWidth] of [
      [1, 1],
      [3, 1],
      [4, 2],
      [0.5, 1],
    ]) {
      const rect = { x: -3, y: -3, width: Math.ceil(10 * scale) + 6, height: Math.ceil(6 * scale) + 6 }
      const expected = classes(rasterise(selection, scale, lineWidth, rect).pixels)
      for (const pattern of ALL_PATTERNS) {
        expect(classes(rasterise(selection, scale, lineWidth, rect, pattern).pixels), JSON.stringify(pattern)).toBe(expected)
      }
    }
  })

  it('moves the dashes one line width along horizontal and vertical edges per phase', () => {
    for (const lineWidth of [1, 2]) {
      const size = 64
      // A selected square well inside the rectangle: two horizontal and two vertical edges.
      const selection = mask(...Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x >= 16 && x < 48 && y >= 16 && y < 48 ? '#' : '.')).join('')))
      const rect = { x: 0, y: 0, width: size, height: size }
      const at = (pixels: Uint32Array, x: number, y: number) => pixels[y * size + x]
      for (let phase = 0; phase < MARCHING_ANTS_PHASES; phase++) {
        const now = rasterise(selection, 1, lineWidth, rect, marchingBoundary(phase)).pixels
        const next = rasterise(selection, 1, lineWidth, rect, marchingBoundary(phase + 1)).pixels
        for (let k = 0; k < lineWidth; k++) {
          // Rows just inside and outside the top and bottom edges, away from the corners.
          for (const y of [16 + k, 15 - k, 47 - k, 48 + k]) {
            for (let x = 16 + 2 * lineWidth; x < 48 - 3 * lineWidth; x++) expect(at(next, x + lineWidth, y)).toBe(at(now, x, y))
          }
          // Columns just inside and outside the left and right edges.
          for (const x of [16 + k, 15 - k, 47 - k, 48 + k]) {
            for (let y = 16 + 2 * lineWidth; y < 48 - 3 * lineWidth; y++) expect(at(next, x, y + lineWidth)).toBe(at(now, x, y))
          }
        }
      }
    }
  })

  it('keeps black and white on both sides of every edge, opposite across it, at every phase', () => {
    for (const lineWidth of [1, 2]) {
      const cell = 4 * lineWidth
      for (const edge of [2, cell]) {
        const rows = edge + lineWidth + 1
        const selection = mask(...Array.from({ length: rows }, (_, y) => (y < edge ? '#' : '.').repeat(64)))
        for (let phase = 0; phase < MARCHING_ANTS_PHASES; phase++) {
          const { pixels } = rasterise(selection, 1, lineWidth, { x: 0, y: 0, width: 64, height: rows }, marchingBoundary(phase))
          for (const row of [edge - lineWidth, edge - 1, edge, edge + lineWidth - 1]) {
            const colours = new Set(pixels.subarray(row * 64, row * 64 + 64))
            expect(colours).toEqual(new Set([dark, light]))
            // Dashes of `cell` pixels: the colour changes every `cell` pixels along the edge.
            let changes = 0
            for (let x = 1; x < 64; x++) if (pixels[row * 64 + x] !== pixels[row * 64 + x - 1]) changes++
            expect(changes).toBeGreaterThanOrEqual(64 / cell - 1)
            expect(changes).toBeLessThanOrEqual(64 / cell + 1)
          }
          // Across the edge the sides differ except where a dash ends (one pixel per line width
          // and dash, as the stripes are diagonal).
          let same = 0
          for (let x = 0; x < 64; x++) if (pixels[(edge - 1) * 64 + x] === pixels[edge * 64 + x]) same++
          expect(same, `line ${lineWidth}, edge ${edge}, phase ${phase}`).toBeLessThanOrEqual(64 / cell + 1)
        }
      }
    }
  })

  it('outlines the image edge inside and out at every phase', () => {
    for (const pattern of ALL_PATTERNS) {
      const { pixels } = rasterise(selectAll(6, 4), 1, 1, { x: -2, y: -2, width: 10, height: 8 }, pattern)
      expect(classes(pixels).match(/.{10}/g)).toEqual([
        '..........',
        '.BBBBBBBB.',
        '.BBBBBBBB.',
        '.BBTTTTBB.',
        '.BBTTTTBB.',
        '.BBBBBBBB.',
        '.BBBBBBBB.',
        '..........',
      ])
    }
  })
})

describe('overlay tile boundaries', () => {
  /** Rasterises a tile keeping its boundary, at `pattern`. */
  function tile(selection: SelectionMask, scale: number, lineWidth: number, rect: Rectangle, pattern: BoundaryPattern) {
    const pixels = new Uint32Array(rect.width * rect.height)
    const raster = rasteriseOverlayTile(selection, scale, lineWidth, rect, pixels, rect.width, pattern)
    return { ...raster, pixels }
  }

  /** The tile pixels inside `area`, row by row. */
  function crop(pixels: Uint32Array, stride: number, area: Rectangle): Uint32Array {
    const out = new Uint32Array(area.width * area.height)
    for (let r = 0; r < area.height; r++) {
      out.set(pixels.subarray((area.y + r) * stride + area.x, (area.y + r) * stride + area.x + area.width), r * area.width)
    }
    return out
  }

  const cases: { selection: SelectionMask; scale: number; lineWidth: number; rect: Rectangle }[] = [
    { selection: randomMask(61, 47, 0.5, 41), scale: 1, lineWidth: 1, rect: { x: -5, y: -3, width: 70, height: 53 } },
    { selection: randomMask(61, 47, 0.03, 42), scale: 2.5, lineWidth: 2, rect: { x: 20, y: 11, width: 100, height: 90 } },
    { selection: randomMask(200, 150, 0.5, 43), scale: 0.4, lineWidth: 1, rect: { x: -1, y: -1, width: 82, height: 62 } },
    { selection: mask('...', '.#.', '...'), scale: 30, lineWidth: 3, rect: { x: 0, y: 0, width: 90, height: 90 } },
    { selection: selectAll(300, 300), scale: 1, lineWidth: 1, rect: { x: -2, y: 256, width: 256, height: 46 } },
  ]

  it('produces the same pixels as rasteriseSelectionOverlay', () => {
    for (const { selection, scale, lineWidth, rect } of cases) {
      for (const pattern of [STATIC_BOUNDARY, marchingBoundary(5)]) {
        expectSamePixels(tile(selection, scale, lineWidth, rect, pattern).pixels, rasterise(selection, scale, lineWidth, rect, pattern).pixels)
      }
    }
  })

  it('keeps an area that holds every boundary pixel, on 32-pixel columns, at most 16 KB a tile', () => {
    for (const { selection, scale, lineWidth, rect } of cases) {
      const { drawn, boundary, pixels } = tile(selection, scale, lineWidth, rect, STATIC_BOUNDARY)
      expect(drawn).toBe(true)
      if (!boundary) throw new Error('expected a boundary')
      const { area } = boundary
      expect(area.x % 32).toBe(0)
      expect(area.x + area.width === rect.width || (area.x + area.width) % 32 === 0).toBe(true)
      expect(boundary.words).toBe(Math.ceil((area.x + area.width) / 32) - area.x / 32)
      expect(boundary.edge.length).toBe(boundary.words * area.height)
      expect(boundary.selected.length).toBe(boundary.edge.length)
      expect(boundary.edge.byteLength + boundary.selected.byteLength).toBeLessThanOrEqual(2 * 4 * ((rect.width + 31) >> 5) * rect.height)
      for (let r = 0; r < rect.height; r++) {
        for (let c = 0; c < rect.width; c++) {
          const isBoundary = pixels[r * rect.width + c] === dark || pixels[r * rect.width + c] === light
          const inArea = c >= area.x && c < area.x + area.width && r >= area.y && r < area.y + area.height
          if (isBoundary) expect(inArea, `${c}, ${r}`).toBe(true)
          if (inArea) {
            const bit = (boundary.edge[(r - area.y) * boundary.words + ((c - area.x) >> 5)] >>> ((c - area.x) & 31)) & 1
            expect(bit, `${c}, ${r}`).toBe(isBoundary ? 1 : 0)
          }
        }
      }
      // The first and last rows of the area hold boundary pixels.
      expect(boundary.edge.subarray(0, boundary.words).some((word) => word !== 0)).toBe(true)
      expect(boundary.edge.subarray(boundary.edge.length - boundary.words).some((word) => word !== 0)).toBe(true)
    }
  })

  it('has no boundary for tiles that are all tint or not drawn', () => {
    const selection = selectAll(600, 600)
    expect(tile(selection, 1, 1, { x: 100, y: 100, width: 256, height: 256 }, marchingBoundary(0))).toMatchObject({ drawn: true, boundary: null })
    expect(tile(mask('#..', '...'), 1, 1, { x: 40, y: 40, width: 16, height: 16 }, marchingBoundary(0))).toMatchObject({ drawn: false, boundary: null })
  })

  it('paints the area exactly as rasterising with each pattern would, without reading the selection', () => {
    for (const { selection, scale, lineWidth, rect } of cases) {
      const { boundary } = tile(selection, scale, lineWidth, rect, STATIC_BOUNDARY)
      if (!boundary) throw new Error('expected a boundary')
      for (const pattern of ALL_PATTERNS) {
        const expected = crop(rasterise(selection, scale, lineWidth, rect, pattern).pixels, rect.width, boundary.area)
        const out = new Uint32Array(boundary.area.width * boundary.area.height).fill(0xdeadbeef)
        paintOverlayBoundary(boundary, pattern, out)
        expectSamePixels(out, expected, JSON.stringify(pattern))
      }
    }
  })

  it('steps to the next phase by flipping only the pixels that change, matching a full paint', () => {
    for (const { selection, scale, lineWidth, rect } of cases) {
      const { boundary } = tile(selection, scale, lineWidth, rect, marchingBoundary(0))
      if (!boundary) throw new Error('expected a boundary')
      const out = new Uint32Array(boundary.area.width * boundary.area.height)
      paintOverlayBoundary(boundary, marchingBoundary(0), out)
      // Two full cycles, wrapping from the last phase to the first.
      for (let step = 1; step <= 2 * MARCHING_ANTS_PHASES; step++) {
        const before = out.slice()
        repaintOverlayBoundary(boundary, marchingBoundary(step - 1), marchingBoundary(step), out)
        const expected = new Uint32Array(out.length)
        paintOverlayBoundary(boundary, marchingBoundary(step), expected)
        expectSamePixels(out, expected, `step ${step}`)
        // Only black and white swapped, on about a quarter of the boundary pixels.
        let flipped = 0
        let unexpected = 0
        let boundaryPixels = 0
        for (let i = 0; i < out.length; i++) {
          if (out[i] === dark || out[i] === light) boundaryPixels++
          if (out[i] !== before[i]) {
            flipped++
            if (!((before[i] === dark && out[i] === light) || (before[i] === light && out[i] === dark))) unexpected++
          }
        }
        expect(unexpected).toBe(0)
        expect(flipped).toBeLessThanOrEqual(Math.ceil(boundaryPixels / 4) + 4 * boundary.area.height)
      }
    }
  })

  it('paints in full when the pattern jumps, is static, or the area contents are unknown', () => {
    const { selection, scale, lineWidth, rect } = cases[0]
    const { boundary } = tile(selection, scale, lineWidth, rect, STATIC_BOUNDARY)
    if (!boundary) throw new Error('expected a boundary')
    const size = boundary.area.width * boundary.area.height
    const painted = (pattern: BoundaryPattern) => {
      const out = new Uint32Array(size)
      paintOverlayBoundary(boundary, pattern, out)
      return out
    }
    const transitions: [BoundaryPattern | null, BoundaryPattern][] = [
      [marchingBoundary(2), marchingBoundary(5)],
      [marchingBoundary(4), marchingBoundary(3)],
      [STATIC_BOUNDARY, marchingBoundary(1)],
      [marchingBoundary(6), STATIC_BOUNDARY],
      [null, marchingBoundary(1)],
    ]
    for (const [shown, next] of transitions) {
      const out = shown ? painted(shown) : new Uint32Array(size).fill(0xdeadbeef)
      repaintOverlayBoundary(boundary, shown, next, out)
      expectSamePixels(out, painted(next), `${JSON.stringify(shown)} to ${JSON.stringify(next)}`)
    }
    const unchanged = new Uint32Array(size).fill(0xdeadbeef)
    repaintOverlayBoundary(boundary, marchingBoundary(3), marchingBoundary(3), unchanged)
    expect(unchanged.every((pixel) => pixel === 0xdeadbeef)).toBe(true)
  })

  it('keeps work and memory per tile bounded for a million disconnected pixels', () => {
    // 2048 × 1024 checkerboard: 1,048,576 selected pixels, none sharing an edge.
    const width = 2048
    const height = 1024
    const data = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) for (let x = (y & 1); x < width; x += 2) data[y * width + x] = 1
    const selection = createSelectionMask(width, height, data)!
    expect(selection.count).toBe(1_048_576)
    const plan = planSelectionOverlay({
      selection,
      viewport: { zoom: 1, offset: { x: 0, y: 0 } },
      viewportSize: { width: 1920, height: 1080 },
      devicePixelRatio: 1,
    })
    // A frame never needs more tiles than cover the view, however many pixels are selected.
    expect(plan.tiles.length).toBeLessThanOrEqual(Math.ceil(1920 / 256 + 1) * Math.ceil(1080 / 256 + 1))
    const out = new Uint32Array(OVERLAY_TILE_SIZE * OVERLAY_TILE_SIZE)
    let geometryBytes = 0
    for (const { rect } of plan.tiles) {
      const { boundary } = rasteriseOverlayTile(selection, plan.scale, plan.lineWidth, rect, out, OVERLAY_TILE_SIZE, marchingBoundary(0))
      if (!boundary) throw new Error('every tile has boundary')
      geometryBytes += boundary.edge.byteLength + boundary.selected.byteLength
      // Every pixel is boundary: a step flips a quarter of them and paints the same as in full.
      const area = new Uint32Array(boundary.area.width * boundary.area.height)
      paintOverlayBoundary(boundary, marchingBoundary(0), area)
      repaintOverlayBoundary(boundary, marchingBoundary(0), marchingBoundary(1), area)
      const expected = new Uint32Array(area.length)
      paintOverlayBoundary(boundary, marchingBoundary(1), expected)
      expectSamePixels(area, expected)
    }
    expect(geometryBytes).toBeLessThanOrEqual(plan.tiles.length * 16 * 1024)
  })
})

describe('planSelectionOverlay', () => {
  const configurations = [
    { zoom: 1, offset: { x: 120, y: 80 }, devicePixelRatio: 1 },
    { zoom: 0.25, offset: { x: -40.5, y: 13.25 }, devicePixelRatio: 1.25 },
    { zoom: 8, offset: { x: -3001.7, y: -811.2 }, devicePixelRatio: 1.5 },
    { zoom: 32, offset: { x: -20000, y: -9000 }, devicePixelRatio: 2 },
    { zoom: 0.37, offset: { x: 7.3, y: -100.6 }, devicePixelRatio: 1.75 },
  ]
  const viewportSize = { width: 1000.8, height: 600 }

  it('uses the image canvas backing store and draws from exactly where the image is drawn', () => {
    const selection = randomMask(2000, 1500, 0.5, 2)
    for (const { zoom, offset, devicePixelRatio } of configurations) {
      const viewport = snapToDevicePixels({ zoom, offset }, devicePixelRatio)
      const overlay = planSelectionOverlay({ selection, viewport, viewportSize, devicePixelRatio })
      const frame = planFrame({ imageSize: selection, viewport, viewportSize, devicePixelRatio })
      expect(overlay.backingStore).toEqual(frame.backingStore)
      expect(overlay.scale).toBe(zoom * devicePixelRatio)
      if (frame.image) {
        // The image's corner, on a whole device pixel; the image itself is drawn the bias past it
        // and the overlay's pixels follow imageIndexAtDevicePixel, which allows for that.
        expect(overlay.origin).toEqual(frame.checker!.origin)
        expect(overlay.origin.x).toBeCloseTo(frame.image.transform.e - imageDrawBias(overlay.scale), 9)
        expect(overlay.origin.y).toBeCloseTo(frame.image.transform.f - imageDrawBias(overlay.scale), 9)
        expect(overlay.scale).toBeCloseTo(frame.image.transform.a, 12)
      }
    }
  })

  it('plans non-overlapping tiles covering exactly the visible part of the content', () => {
    for (const selection of [randomMask(2000, 1500, 0.5, 2), mask('#'), selectAll(3000, 20)]) {
      for (const { zoom, offset, devicePixelRatio } of configurations) {
        const viewport = snapToDevicePixels({ zoom, offset }, devicePixelRatio)
        const plan = planSelectionOverlay({ selection, viewport, viewportSize, devicePixelRatio })
        const visible = { x: -plan.origin.x, y: -plan.origin.y, width: plan.backingStore.width, height: plan.backingStore.height }
        const content = overlayContentRect(selection, plan.scale, plan.lineWidth)
        const size = OVERLAY_TILE_SIZE
        let covered = 0
        const seen = new Set<string>()
        for (const { column, row, rect } of plan.tiles) {
          expect(seen.has(`${column},${row}`)).toBe(false)
          seen.add(`${column},${row}`)
          expect(intersect(rect, { x: column * size, y: row * size, width: size, height: size })).toEqual(rect)
          expect(intersect(rect, content)).toEqual(rect)
          const shown = intersect(rect, visible)
          expect(shown).not.toBeNull()
          covered += shown!.width * shown!.height
        }
        const needed = intersect(visible, content)
        expect(covered).toBe(needed ? needed.width * needed.height : 0)
      }
    }
  })

  it('needs one small tile for a small selection in a 50-megapixel image', () => {
    const data = new Uint8Array(8660 * 5773)
    data[3000 * 8660 + 5000] = 1
    const selection = createSelectionMask(8660, 5773, data)!
    const plan = planSelectionOverlay({
      selection,
      viewport: { zoom: 0.1, offset: { x: 20, y: 10 } },
      viewportSize: { width: 1920, height: 1080 },
      devicePixelRatio: 1,
    })
    expect(plan.tiles).toHaveLength(1)
    expect(plan.tiles[0].rect.width * plan.tiles[0].rect.height).toBeLessThanOrEqual(25)
  })

  it('keeps the number of tiles within the visible area, however complex the selection', () => {
    // Every pixel differs from its neighbours: the most complex boundary possible.
    const size = 4096
    const data = new Uint8Array(size * size)
    for (let y = 0; y < size; y++) for (let x = (y & 1); x < size; x += 2) data[y * size + x] = 1
    const selection = createSelectionMask(size, size, data)!
    const viewportSize = { width: 1920, height: 1080 }
    for (const devicePixelRatio of [1, 1.5, 2]) {
      for (const zoom of [0.05, 0.25, 1, 1.5, 8, 32]) {
        const plan = planSelectionOverlay({ selection, viewport: { zoom, offset: { x: -77, y: -33 } }, viewportSize, devicePixelRatio })
        const columns = Math.ceil(plan.backingStore.width / OVERLAY_TILE_SIZE) + 1
        const rows = Math.ceil(plan.backingStore.height / OVERLAY_TILE_SIZE) + 1
        expect(plan.tiles.length).toBeLessThanOrEqual(columns * rows)
        const pixels = plan.tiles.reduce((sum, { rect }) => sum + rect.width * rect.height, 0)
        expect(pixels).toBeLessThanOrEqual(columns * rows * OVERLAY_TILE_SIZE ** 2)
      }
    }
  })

  it('plans nothing when the selection is out of view', () => {
    const selection = mask('#....', '.....')
    const plan = planSelectionOverlay({
      selection,
      viewport: { zoom: 10, offset: { x: -500, y: 0 } },
      viewportSize: { width: 400, height: 300 },
      devicePixelRatio: 1,
    })
    expect(plan.tiles).toEqual([])
  })

  it('keeps tiles anchored to the image while panning', () => {
    const selection = randomMask(900, 700, 0.5, 4)
    const devicePixelRatio = 1.25
    const start = snapToDevicePixels({ zoom: 2.5, offset: { x: -300.3, y: -200.1 } }, devicePixelRatio)
    const panned = snapToDevicePixels({ zoom: 2.5, offset: { x: start.offset.x + 37.6, y: start.offset.y - 12 } }, devicePixelRatio)
    const input = { selection, viewportSize: { width: 800, height: 500 }, devicePixelRatio }
    const before = planSelectionOverlay({ ...input, viewport: start })
    const after = planSelectionOverlay({ ...input, viewport: panned })
    expect(after.origin.x - before.origin.x).toBe(Math.round(37.6 * devicePixelRatio))
    expect(after.origin.y - before.origin.y).toBe(-15)
    const tilesBefore = new Map(before.tiles.map((tile) => [`${tile.column},${tile.row}`, tile.rect]))
    let shared = 0
    for (const tile of after.tiles) {
      const rect = tilesBefore.get(`${tile.column},${tile.row}`)
      if (!rect) continue
      shared++
      expect(tile.rect).toEqual(rect)
      const now = rasterise(selection, after.scale, after.lineWidth, tile.rect).pixels
      const earlier = rasterise(selection, before.scale, before.lineWidth, rect).pixels
      expect(now.findIndex((pixel, i) => pixel !== earlier[i])).toBe(-1)
    }
    expect(shared).toBeGreaterThan(0)
  })

  it('keeps tiles near the visible area', () => {
    const plan = planSelectionOverlay({
      selection: mask('#'),
      viewport: { zoom: 1, offset: { x: 10, y: 20 } },
      viewportSize: { width: 300, height: 200 },
      devicePixelRatio: 2,
    })
    expect(plan.keep).toEqual({ x: -20 - OVERLAY_TILE_SIZE, y: -40 - OVERLAY_TILE_SIZE, width: 600 + 2 * OVERLAY_TILE_SIZE, height: 400 + 2 * OVERLAY_TILE_SIZE })
  })
})

describe('boundaryLineWidth', () => {
  it('is about one CSS pixel in whole device pixels, never less than one', () => {
    expect([0.5, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4].map(boundaryLineWidth)).toEqual([1, 1, 1, 1, 1, 2, 2, 3, 4])
  })
})
