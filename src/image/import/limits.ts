import type { Size } from '../../editor/types'
import { type ImportError, createImportError } from './errors'

export interface ImportLimits {
  readonly maxFileBytes: number
  /** Maximum width and maximum height, in pixels. */
  readonly maxDimension: number
  /** Maximum width × height. */
  readonly maxPixels: number
}

/** Approved Phase 1 limits. 50 MB is binary (50 × 1024 × 1024 bytes); 50 MP is decimal. */
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxDimension: 16_384,
  maxPixels: 50_000_000,
}

/** Returns an error when the file is over the size limit. Zero-byte files pass; format detection rejects them. */
export function validateFileSize(
  sizeBytes: number,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): ImportError | null {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    return createImportError('read-failed', `Invalid file size: ${sizeBytes}`)
  }
  if (sizeBytes > limits.maxFileBytes) {
    return createImportError(
      'file-too-large',
      `${sizeBytes} bytes exceeds the limit of ${limits.maxFileBytes} bytes`,
    )
  }
  return null
}

/**
 * Validates decoded or declared image dimensions. Call this as soon as dimensions are
 * known and before allocating a full-resolution RGBA buffer (width × height × 4 bytes).
 *
 * Dimensions must be positive whole numbers; anything else means the image could not
 * be decoded meaningfully.
 */
export function validateDimensions(
  size: Size,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): ImportError | null {
  const { width, height } = size
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    return createImportError('decode-failed', `Invalid image dimensions: ${width} × ${height}`)
  }
  if (width > limits.maxDimension || height > limits.maxDimension) {
    return createImportError(
      'dimensions-too-large',
      `${width} × ${height} exceeds the maximum side of ${limits.maxDimension} px`,
    )
  }
  if (width * height > limits.maxPixels) {
    return createImportError(
      'dimensions-too-large',
      `${width} × ${height} (${width * height} px) exceeds the maximum area of ${limits.maxPixels} px`,
    )
  }
  return null
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
