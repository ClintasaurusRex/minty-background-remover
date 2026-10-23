import type { ImageFormat } from '../../editor/types'
import { sniffImageFormat } from './formats'

/*
 * Choosing and naming a pasted image. Clipboard items are identified from their
 * content like any other import; HTML and URLs on the clipboard are never used, so
 * pasting never fetches anything.
 */

export interface PastedImageChoice {
  readonly blob: Blob
  readonly format: ImageFormat
}

/**
 * The first clipboard item whose content is a supported image, with its format, or
 * null if there is none. Items are checked in order and checking stops at the first
 * supported one.
 */
export async function choosePastedImage(
  blobs: readonly Blob[],
  sniff: (blob: Blob) => Promise<ImageFormat | null> = sniffImageFormat,
): Promise<PastedImageChoice | null> {
  for (const blob of blobs) {
    const format = await sniff(blob)
    if (format) return { blob, format }
  }
  return null
}

const EXTENSIONS: Readonly<Record<ImageFormat, string>> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  svg: 'svg',
}

/**
 * A name for a pasted image, which has none of its own (browsers call every pasted
 * image "image.png"): "pasted-image-2026-10-22-143005.png", in local time, with the
 * extension of the detected format.
 */
export function pastedImageName(format: ImageFormat, date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `pasted-image-${day}-${time}.${EXTENSIONS[format]}`
}
