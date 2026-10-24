import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOLERANCE,
  MAX_COLOUR_DISTANCE_SQUARED,
  MAX_TOLERANCE,
  colourDistanceSquared,
  toleranceThreshold,
} from './colourDistance'

type Rgba = readonly [r: number, g: number, b: number, a: number]
type ColourPair = readonly [Rgba, Rgba]

const WHITE: Rgba = [255, 255, 255, 255]
const BLACK: Rgba = [0, 0, 0, 255]
const TRANSPARENT: Rgba = [0, 0, 0, 0]

/** Every combination of these channel values: 625 colours. */
const CHANNEL_SAMPLES = [0, 1, 128, 254, 255]
const SAMPLE_COLOURS: Rgba[] = CHANNEL_SAMPLES.flatMap((r) =>
  CHANNEL_SAMPLES.flatMap((g) => CHANNEL_SAMPLES.flatMap((b) => CHANNEL_SAMPLES.map((a): Rgba => [r, g, b, a]))),
)

function distance(a: Rgba, b: Rgba): number {
  return colourDistanceSquared(...a, ...b)
}

function matches(a: Rgba, b: Rgba, tolerance: number): boolean {
  return distance(a, b) <= toleranceThreshold(tolerance)
}

/** The normalized distance D, computed from the integer form. */
function normalized(a: Rgba, b: Rgba): number {
  return Math.sqrt(distance(a, b) / MAX_COLOUR_DISTANCE_SQUARED)
}

/** D exactly as written in IMAGE_PROCESSING_SPEC.md, in floating point. */
function specDistance(a: Rgba, b: Rgba): number {
  const w = Math.min(a[3], b[3]) / 255
  const rgb = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  return Math.sqrt(((w * rgb) / 3 + (a[3] - b[3]) ** 2) / 255 ** 2)
}

/** Sample pairs for which `failed` is true; expect it to be empty for a readable failure. */
function failingPairs(failed: (a: Rgba, b: Rgba) => boolean): ColourPair[] {
  const failures: ColourPair[] = []
  for (const a of SAMPLE_COLOURS) {
    for (const b of SAMPLE_COLOURS) {
      if (failed(a, b)) failures.push([a, b])
    }
  }
  return failures
}

describe('colourDistanceSquared', () => {
  it('is zero for identical colours', () => {
    const colours: Rgba[] = [WHITE, BLACK, TRANSPARENT, [12, 200, 77, 255], [12, 200, 77, 128], [12, 200, 77, 1]]
    for (const colour of colours) expect(distance(colour, colour)).toBe(0)
  })

  it('measures RGB differences between colours of equal alpha', () => {
    expect(distance(BLACK, WHITE)).toBe(MAX_COLOUR_DISTANCE_SQUARED)
    expect(normalized(BLACK, WHITE)).toBe(1)
    // 51 levels on every channel is D = 0.2; 88 levels on one channel is D ≈ 0.199.
    expect(distance(WHITE, [204, 204, 204, 255])).toBe(255 * 3 * 51 ** 2)
    expect(normalized(WHITE, [204, 204, 204, 255])).toBeCloseTo(0.2, 12)
    expect(distance([255, 0, 0, 255], [255, 88, 0, 255])).toBe(255 * 88 ** 2)
    expect(normalized([255, 0, 0, 255], [255, 88, 0, 255])).toBeCloseTo(0.199, 3)
  })

  it('ignores the hidden RGB of fully transparent pixels', () => {
    expect(distance(TRANSPARENT, [255, 128, 7, 0])).toBe(0)
    expect(distance([255, 255, 255, 0], [0, 0, 0, 0])).toBe(0)
    // Against a visible colour only the alpha difference counts, whatever either RGB is.
    expect(distance(TRANSPARENT, [10, 20, 30, 51])).toBe(765 * 51 ** 2)
    expect(distance([255, 255, 255, 0], [200, 100, 0, 51])).toBe(765 * 51 ** 2)
  })

  it('counts alpha differences in full', () => {
    expect(distance(WHITE, [255, 255, 255, 204])).toBe(765 * 51 ** 2)
    expect(normalized(WHITE, [255, 255, 255, 204])).toBeCloseTo(0.2, 12)
    expect(normalized(TRANSPARENT, [0, 0, 0, 51])).toBeCloseTo(0.2, 12)
    expect(normalized(TRANSPARENT, [0, 0, 0, 128])).toBeCloseTo(128 / 255, 12)
  })

  it('puts fully transparent and fully opaque colours at the maximum distance', () => {
    const rgbs = [
      [0, 0, 0],
      [255, 255, 255],
      [12, 200, 77],
    ] as const
    for (const hidden of rgbs) {
      for (const visible of rgbs) {
        expect(distance([...hidden, 0], [...visible, 255])).toBe(MAX_COLOUR_DISTANCE_SQUARED)
      }
    }
  })

  it('scales colour differences in partially transparent pixels by the lower alpha', () => {
    const rgbDistance = 3 * 255 ** 2 // black against white
    expect(distance([0, 0, 0, 128], [255, 255, 255, 128])).toBe(128 * rgbDistance)
    expect(distance([0, 0, 0, 1], [255, 255, 255, 1])).toBe(1 * rgbDistance)
    expect(distance(BLACK, [255, 255, 255, 128])).toBe(128 * rgbDistance + 765 * 127 ** 2)
    expect(normalized([0, 0, 0, 128], [255, 255, 255, 128])).toBeCloseTo(Math.sqrt(128 / 255), 12)
  })

  it('is symmetric', () => {
    expect(failingPairs((a, b) => distance(a, b) !== distance(b, a))).toEqual([])
  })

  it('agrees with the specification formula and is always a whole number', () => {
    expect(
      failingPairs((a, b) => {
        const d = distance(a, b)
        return !Number.isInteger(d) || Math.abs(normalized(a, b) - specDistance(a, b)) > 1e-12
      }),
    ).toEqual([])
  })

  it('never exceeds the maximum for any pair of alpha values', () => {
    // RGB contributes the most for black against white, so this bounds every colour pair.
    const outOfRange: number[][] = []
    for (let a1 = 0; a1 <= 255; a1++) {
      for (let a2 = 0; a2 <= 255; a2++) {
        if (distance([0, 0, 0, a1], [255, 255, 255, a2]) > MAX_COLOUR_DISTANCE_SQUARED) outOfRange.push([a1, a2])
      }
    }
    expect(outOfRange).toEqual([])
  })

  it('does not change the pixels it reads', () => {
    const pixels = Uint8ClampedArray.of(10, 20, 30, 255, 200, 100, 0, 0)
    const before = Array.from(pixels)
    colourDistanceSquared(pixels[0], pixels[1], pixels[2], pixels[3], pixels[4], pixels[5], pixels[6], pixels[7])
    expect(Array.from(pixels)).toEqual(before)
  })
})

describe('toleranceThreshold', () => {
  it('matches only identical colours at 0, plus transparent pixels whatever their hidden RGB', () => {
    expect(toleranceThreshold(0)).toBe(0)
    expect(matches([12, 200, 77, 255], [12, 200, 77, 255], 0)).toBe(true)
    expect(matches([12, 200, 77, 255], [13, 200, 77, 255], 0)).toBe(false)
    expect(matches([12, 200, 77, 255], [12, 200, 77, 254], 0)).toBe(false)
    expect(matches([12, 200, 77, 1], [12, 201, 77, 1], 0)).toBe(false)
    expect(matches(TRANSPARENT, [255, 128, 7, 0], 0)).toBe(true)
  })

  it('places the boundaries at the default tolerance of 20 exactly', () => {
    expect(DEFAULT_TOLERANCE).toBe(20)
    const cases: { name: string; inside: ColourPair; outside: ColourPair }[] = [
      {
        name: '51 levels on every channel',
        inside: [WHITE, [204, 204, 204, 255]],
        outside: [WHITE, [203, 203, 203, 255]],
      },
      {
        name: '88 levels on one channel',
        inside: [[255, 0, 0, 255], [255, 88, 0, 255]],
        outside: [[255, 0, 0, 255], [255, 89, 0, 255]],
      },
      {
        name: 'opaque against alpha 204',
        inside: [WHITE, [255, 255, 255, 204]],
        outside: [WHITE, [255, 255, 255, 203]],
      },
      {
        name: 'transparent against alpha 51, any colour',
        inside: [TRANSPARENT, [90, 160, 30, 51]],
        outside: [TRANSPARENT, [90, 160, 30, 52]],
      },
      {
        name: 'black against white, both at alpha 10',
        inside: [[0, 0, 0, 10], [255, 255, 255, 10]],
        outside: [[0, 0, 0, 11], [255, 255, 255, 11]],
      },
    ]
    for (const { name, inside, outside } of cases) {
      expect(matches(...inside, DEFAULT_TOLERANCE), `${name}: inside`).toBe(true)
      expect(matches(...outside, DEFAULT_TOLERANCE), `${name}: outside`).toBe(false)
    }
    // Three of the inside cases sit exactly on the limit, D = 0.2.
    expect(distance(WHITE, [204, 204, 204, 255])).toBe(toleranceThreshold(20))
    expect(distance(WHITE, [255, 255, 255, 204])).toBe(toleranceThreshold(20))
    expect(distance(TRANSPARENT, [90, 160, 30, 51])).toBe(toleranceThreshold(20))
  })

  it('matches every colour at 100', () => {
    expect(toleranceThreshold(100)).toBe(MAX_COLOUR_DISTANCE_SQUARED)
    expect(matches(TRANSPARENT, WHITE, 100)).toBe(true)
    expect(failingPairs((a, b) => !matches(a, b, 100))).toEqual([])
  })

  it('keeps fully transparent and fully opaque colours apart below 100', () => {
    for (let tolerance = 0; tolerance < 100; tolerance++) {
      expect(matches(TRANSPARENT, WHITE, tolerance)).toBe(false)
      expect(matches([255, 255, 255, 0], BLACK, tolerance)).toBe(false)
    }
  })

  it('never matches fewer colours at a higher tolerance', () => {
    for (let tolerance = 0; tolerance < 100; tolerance++) {
      expect(toleranceThreshold(tolerance + 1)).toBeGreaterThan(toleranceThreshold(tolerance))
    }
    for (const seed of [WHITE, TRANSPARENT, [128, 128, 128, 128] as const]) {
      let previous = SAMPLE_COLOURS.map(() => false)
      for (let tolerance = 0; tolerance <= 100; tolerance++) {
        const current = SAMPLE_COLOURS.map((colour) => matches(seed, colour, tolerance))
        expect(previous.every((matched, i) => !matched || current[i])).toBe(true)
        previous = current
      }
    }
  })

  it('is the largest whole-number distance with D ≤ tolerance / 100', () => {
    // Exact in BigInt: threshold ≤ MAX × t² / 100² < threshold + 1.
    const max = BigInt(MAX_COLOUR_DISTANCE_SQUARED)
    for (let tolerance = 0; tolerance <= 100; tolerance++) {
      const threshold = BigInt(toleranceThreshold(tolerance))
      const limit = max * BigInt(tolerance) ** 2n
      expect(threshold * 10_000n <= limit && (threshold + 1n) * 10_000n > limit, `tolerance ${tolerance}`).toBe(true)
    }
  })

  it('agrees with D ≤ tolerance / 100 from the specification', () => {
    for (const tolerance of [0, 1, 20, 50, 99, 100]) {
      const limit = tolerance / 100
      expect(
        failingPairs((a, b) => {
          const d = specDistance(a, b)
          // Floating point cannot decide pairs exactly on the limit; the cases above cover them.
          if (Math.abs(d - limit) < 1e-9) return false
          return matches(a, b, tolerance) !== d <= limit
        }),
      ).toEqual([])
    }
  })

  it('rejects tolerances that are not whole numbers from 0 to 100', () => {
    expect(MAX_TOLERANCE).toBe(100)
    for (const tolerance of [-1, 101, 20.5, 0.2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => toleranceThreshold(tolerance)).toThrow(RangeError)
    }
  })
})
