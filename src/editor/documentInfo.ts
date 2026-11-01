import type { ImageFormat, PixelCoordinate, SelectionMask } from './types'

/*
 * Text shown in the status bar.
 */

const FORMAT_LABELS: Readonly<Record<ImageFormat, string>> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  svg: 'SVG',
}

export function formatLabel(format: ImageFormat): string {
  return FORMAT_LABELS[format]
}

/** "1920 × 1080 px" */
export function formatDimensions(width: number, height: number): string {
  return `${width.toLocaleString('en-CA')} × ${height.toLocaleString('en-CA')} px`
}

/**
 * Binary units labelled KB and MB, matching how the 50 MB import limit is defined.
 * One decimal place below 10, whole numbers above.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${roundForDisplay(kilobytes)} KB`
  return `${roundForDisplay(kilobytes / 1024)} MB`
}

function roundForDisplay(value: number): string {
  return value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value))
}

/** "45%"; zoom levels below 10% keep one decimal place, e.g. "2.5%". */
export function formatZoom(zoom: number): string {
  const percent = zoom * 100
  return percent < 10 ? `${roundForDisplay(percent)}%` : `${Math.round(percent)}%`
}

/** "120, 45": the image pixel under the pointer, column then row. */
export function formatPixelPosition(pixel: PixelCoordinate): string {
  return `${pixel.x.toLocaleString('en-CA')}, ${pixel.y.toLocaleString('en-CA')}`
}

/** "9,600 px · 120 × 80": the selected-pixel count and the size of the area containing them. */
export function formatSelection(selection: SelectionMask): string {
  const { count, bounds } = selection
  return `${count.toLocaleString('en-CA')} px · ${bounds.width.toLocaleString('en-CA')} × ${bounds.height.toLocaleString('en-CA')}`
}

/** The same as formatSelection, in words for assistive technology and tooltips. */
export function describeSelection(selection: SelectionMask | null): string {
  if (!selection) return 'No selection'
  const { count, bounds } = selection
  const pixels = count === 1 ? 'pixel' : 'pixels'
  return `${count.toLocaleString('en-CA')} ${pixels} selected, within ${formatDimensions(bounds.width, bounds.height)}`
}
