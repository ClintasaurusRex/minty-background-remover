/*
 * Detects obviously truncated PNG files. Some browsers (Firefox) decode a PNG cut
 * off part-way and fill the rest with transparency, so a truncated file would open
 * as a partly or wholly blank image instead of failing.
 *
 * Only the final chunk's structure is checked: a zero length and the type "IEND".
 * The CRC is not verified and nothing else is parsed, so this catches truncation,
 * not every kind of damage. Files with data appended after IEND are also rejected.
 */

/** The IEND chunk: length (4, always 0), type "IEND" (4), CRC (4). */
export const PNG_IEND_BYTES = 12

/** Signature (8) + IHDR chunk (25) + IEND chunk (12): the smallest possible PNG. */
const PNG_MIN_BYTES = 8 + 25 + PNG_IEND_BYTES

const IEND_LENGTH_AND_TYPE = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]

/** Returns a developer detail if the PNG does not end with an IEND chunk, otherwise null. */
export async function findPngEndingProblem(blob: Blob): Promise<string | null> {
  if (blob.size < PNG_MIN_BYTES) return `PNG is truncated (${blob.size} bytes)`
  const ending = new Uint8Array(await blob.slice(blob.size - PNG_IEND_BYTES).arrayBuffer())
  return hasIendChunk(ending) ? null : 'PNG does not end with an IEND chunk; the file may be truncated'
}

/** Checks the last 12 bytes of a PNG for an IEND chunk's length and type. */
export function hasIendChunk(ending: Uint8Array): boolean {
  return ending.length === PNG_IEND_BYTES && IEND_LENGTH_AND_TYPE.every((value, i) => ending[i] === value)
}
