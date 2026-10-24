import type { SelectionMask } from '../../editor/types'
import { fakeImageData } from '../import/testFixtures'

/** An RGBA colour with 8-bit channels. */
export type Rgba = readonly [r: number, g: number, b: number, a: number]

/**
 * Builds RGBA pixels from a character map, one string per row: each character is a colour
 * from `palette`. Spaces are ignored, so rows can be written as `'. # .'` for readability.
 */
export function imageFromRows(palette: Readonly<Record<string, Rgba>>, ...rows: string[]): ImageData {
  const cells = rows.map((row) => row.replaceAll(' ', ''))
  const width = cells[0]?.length ?? 0
  if (cells.some((row) => row.length !== width)) throw new Error('Image rows differ in length')

  const image = fakeImageData(width, cells.length)
  cells.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const colour = palette[row[x]]
      if (!colour) throw new Error(`No palette colour for '${row[x]}'`)
      image.data.set(colour, (y * width + x) * 4)
    }
  })
  return image
}

export interface MaskBytes {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

/**
 * Builds mask bytes from a character map, one string per row: `#` selected, `.` not.
 * Spaces are ignored, so rows can be written as `'. # .'` for readability.
 */
export function maskBytes(...rows: string[]): MaskBytes {
  const cells = rows.map((row) => row.replaceAll(' ', ''))
  const width = cells[0]?.length ?? 0
  if (cells.some((row) => row.length !== width)) throw new Error('Mask rows differ in length')

  const data = new Uint8Array(width * cells.length)
  cells.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const cell = row[x]
      if (cell !== '#' && cell !== '.') throw new Error(`Unexpected mask character '${cell}'`)
      data[y * width + x] = cell === '#' ? 1 : 0
    }
  })
  return { width, height: cells.length, data }
}

/** Renders a mask back to the character map used by maskBytes (without spaces). */
export function maskRows(mask: SelectionMask): string[] {
  const rows: string[] = []
  for (let y = 0; y < mask.height; y++) {
    let row = ''
    for (let x = 0; x < mask.width; x++) row += mask.data[y * mask.width + x] === 1 ? '#' : '.'
    rows.push(row)
  }
  return rows
}
