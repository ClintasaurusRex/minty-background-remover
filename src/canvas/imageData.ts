import type { PixelBuffer } from '../editor/types'

/**
 * `pixels` as ImageData for canvas APIs, without copying. Decoded pixels already are
 * ImageData and are returned as they are; a plain buffer (edited pixels) is wrapped and
 * shares its memory. Pass the result only to APIs that read it, such as createImageBitmap
 * and putImageData: the wrapper's `data` is writable, but the pixels belong to a document.
 *
 * Browser only: Node has no ImageData.
 */
export function toImageData(pixels: PixelBuffer): ImageData {
  if (pixels instanceof ImageData) return pixels
  return new ImageData(pixels.data, pixels.width, pixels.height)
}
