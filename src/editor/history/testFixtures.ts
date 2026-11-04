import type { DisplayImage } from '../../canvas/displayImage'
import { createPixelBuffer } from '../../image/pixelBuffer'
import { createSelectionMask } from '../../image/selection/selectionMask'
import { maskBytes } from '../../image/selection/testFixtures'
import { type EditorAction, type EditorState, type WorkspaceMetrics, editorReducer, initialEditorState } from '../editorState'
import type { CreateDisplayImage } from '../historyCommands'
import { createImageDocument } from '../imageDocument'
import type { PixelBuffer, SelectionMask } from '../types'

/*
 * Fixtures for Undo / Redo history tests: fake display images that record what was created and
 * released, opened editor states, random images and masks, and an object-graph walk that finds
 * everything a history keeps alive.
 */

/** Deterministic pseudo-random numbers in [0, 1). */
export function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
}

export function randomInt(random: () => number, below: number): number {
  return Math.floor(random() * below)
}

export function randomImage(width: number, height: number, random: () => number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = randomInt(random, 256)
  return createPixelBuffer(width, height, data)
}

/** A random mask selecting about `density` of the pixels, or null when it selects none. */
export function randomMask(width: number, height: number, random: () => number, density = 0.4): SelectionMask | null {
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = random() < density ? 1 : 0
  return createSelectionMask(width, height, data)
}

/** A mask from a character map (`#` selected); throws if it selects nothing. */
export function mask(...rows: string[]): SelectionMask {
  const { width, height, data } = maskBytes(...rows)
  const selection = createSelectionMask(width, height, data)
  if (!selection) throw new Error('Test mask selects nothing')
  return selection
}

/** A copy of `pixels` changed by `change`, as an edit makes it (new memory). */
export function edited(pixels: PixelBuffer, change: (data: Uint8ClampedArray, width: number) => void): PixelBuffer {
  const data = pixels.data.slice()
  change(data, pixels.width)
  return createPixelBuffer(pixels.width, pixels.height, data)
}

/** Byte-for-byte equality of two images, including colour hidden under alpha 0. */
export function sameBytes(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

/** Equality of two selections (null for none), pixel by pixel, with their count and bounds. */
export function sameSelection(a: SelectionMask | null, b: SelectionMask | null): boolean {
  if (!a || !b) return a === b
  if (a.width !== b.width || a.height !== b.height || a.count !== b.count) return false
  const { bounds: p } = a
  const { bounds: q } = b
  if (p.x !== q.x || p.y !== q.y || p.width !== q.width || p.height !== q.height) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

/** A display image that keeps the pixels it shows and whether it was released. */
export interface FakeDisplayImage {
  readonly width: number
  readonly height: number
  readonly pixels: PixelBuffer
  released: boolean
  close(): void
}

export interface FakeDisplayImages {
  /** Pass this to the commands. */
  readonly create: CreateDisplayImage
  readonly created: FakeDisplayImage[]
  /** Makes `create` throw, as when memory runs out, until set back to false. */
  failing: boolean
}

/** Display image creation recording every image it creates. */
export function fakeDisplayImages(): FakeDisplayImages {
  const created: FakeDisplayImage[] = []
  const factory: FakeDisplayImages = {
    created,
    failing: false,
    create: (pixels) => {
      if (factory.failing) throw new Error('Out of memory (test)')
      const image: FakeDisplayImage = {
        width: pixels.width,
        height: pixels.height,
        pixels,
        released: false,
        close() {
          image.released = true
        },
      }
      created.push(image)
      return image
    },
  }
  return factory
}

/** A stand-in import bitmap. */
export function fakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: () => {} }
}

export const WORKSPACE: WorkspaceMetrics = { size: { width: 1000, height: 600 }, devicePixelRatio: 1 }

export function reduce(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state)
}

let nextImportId = 1000

/** `state` (by default a measured workspace) with an image of `pixels` opened successfully. */
export function opened(pixels: PixelBuffer, state: EditorState = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })): EditorState {
  const importId = nextImportId++
  const document = createImageDocument({ name: 'test.png', format: 'png', source: 'file-picker', fileSizeBytes: 1, pixels })
  return reduce(
    state,
    { type: 'import-started', importId },
    { type: 'import-finished', importId, result: { ok: true, document, bitmap: fakeBitmap(pixels.width, pixels.height) } },
  )
}

/** The editor state after `action` must be accepted: fails the test if the reducer ignored it. */
export function accepted(state: EditorState, action: EditorAction | null): EditorState {
  if (!action) throw new Error('No action was produced')
  if (action.type === 'edit-failed') throw new Error(`The command failed: ${action.error.detail}`)
  const next = editorReducer(state, action)
  if (next === state) throw new Error(`The reducer rejected ${action.type}`)
  return next
}

/** Every object, typed array and ArrayBuffer reachable from `root` through properties and arrays. */
export function reachable(root: unknown): { objects: Set<object>; buffers: Set<ArrayBufferLike> } {
  const objects = new Set<object>()
  const buffers = new Set<ArrayBufferLike>()
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value !== 'object' || value === null || objects.has(value)) continue
    objects.add(value)
    if (ArrayBuffer.isView(value)) {
      buffers.add(value.buffer)
      continue
    }
    if (value instanceof ArrayBuffer) {
      buffers.add(value)
      continue
    }
    for (const key of Object.keys(value)) stack.push((value as Record<string, unknown>)[key])
  }
  return { objects, buffers }
}

/** Whether `value` is one of the fake display images or import bitmaps (anything with close()). */
export function isDrawable(value: object): value is DisplayImage {
  return typeof (value as { close?: unknown }).close === 'function'
}
