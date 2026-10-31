import type { Point } from '../editor/types'

/**
 * Where the pointer is over the workspace canvas (canvas CSS px), or null when it is not.
 *
 * Kept outside the editor state: it changes on every pointer movement, and only the
 * status bar readout needs it. Subscribers (useSyncExternalStore) re-render only when the
 * position actually changes, so moving the pointer never redraws the image.
 */
export interface PointerPositionStore {
  get(): Point | null
  set(point: Point | null): void
  subscribe(listener: () => void): () => void
}

export function createPointerPositionStore(): PointerPositionStore {
  let current: Point | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(point) {
      if (point === current || (point && current && point.x === current.x && point.y === current.y)) return
      current = point
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
