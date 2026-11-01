/**
 * Alpha-aware RGB colour distance for the Magic Wand (IMAGE_PROCESSING_SPEC.md, Colour Distance).
 *
 * For colours A and B with 8-bit channels:
 *
 *   w  = min(alphaA, alphaB) / 255
 *   D² = (w × (ΔR² + ΔG² + ΔB²) / 3 + ΔA²) / 255²        0 ≤ D ≤ 1
 *
 * B matches A when D ≤ tolerance / 100. Multiplying D² by 3 × 255³ gives a whole number,
 * so matching is an exact integer comparison, with no square roots or rounding.
 */

/** Initial user-facing Magic Wand tolerance. */
export const DEFAULT_TOLERANCE = 20
export const MAX_TOLERANCE = 100

/** colourDistanceSquared at D = 1 (3 × 255³), e.g. opaque black against opaque white. */
export const MAX_COLOUR_DISTANCE_SQUARED = 49_744_125

/**
 * D² scaled by MAX_COLOUR_DISTANCE_SQUARED: a whole number from 0 to 49,744,125.
 *
 * Colour differences count in proportion to the lower alpha, so the hidden RGB of fully
 * transparent pixels never matters; alpha differences always count in full.
 *
 * Channels must be whole numbers from 0 to 255, as read from ImageData. They are not
 * checked, because this runs once per pixel.
 */
export function colourDistanceSquared(
  r1: number, g1: number, b1: number, a1: number,
  r2: number, g2: number, b2: number, a2: number,
): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  const da = a1 - a2
  return Math.min(a1, a2) * (dr * dr + dg * dg + db * db) + 765 * da * da
}

/**
 * The largest colourDistanceSquared that matches at `tolerance`:
 * colours match when colourDistanceSquared(…) <= toleranceThreshold(tolerance).
 *
 * Throws a RangeError unless tolerance is a whole number from 0 to 100. User input is
 * clamped and rounded by the editor before it reaches the algorithm.
 */
export function toleranceThreshold(tolerance: number): number {
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > MAX_TOLERANCE) {
    throw new RangeError(`Invalid tolerance: ${tolerance}; expected a whole number from 0 to ${MAX_TOLERANCE}`)
  }
  // D ≤ t / 100  ⇔  distance ≤ MAX × t² / 100². The product is exact (below 2^53), and
  // distances are whole numbers, so rounding the limit down changes no comparison.
  return Math.floor((MAX_COLOUR_DISTANCE_SQUARED * tolerance * tolerance) / 10_000)
}
