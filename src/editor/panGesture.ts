import type { Point } from './types'

/*
 * The Space + drag pan gesture, independent of the DOM so it can be tested.
 *
 * Holding Space arms panning; pressing the primary button then starts a drag, which
 * continues (with pointer capture) until Space or that pointer is released, or the
 * pointer is cancelled. Losing focus resets everything.
 */

export interface PanGesture {
  readonly spaceHeld: boolean
  /** The active drag: its pointer and where it started, in client CSS pixels. */
  readonly drag: { readonly pointerId: number; readonly start: Point } | null
}

export const idlePanGesture: PanGesture = { spaceHeld: false, drag: null }

export type PanGestureEvent =
  | { readonly type: 'space-down' }
  | { readonly type: 'space-up' }
  | { readonly type: 'pointer-down'; readonly pointerId: number; readonly button: number; readonly point: Point }
  | { readonly type: 'pointer-move'; readonly pointerId: number; readonly point: Point }
  | { readonly type: 'pointer-up'; readonly pointerId: number }
  | { readonly type: 'pointer-cancel'; readonly pointerId: number }
  /** Focus left the window, the image closed, or the component unmounted. */
  | { readonly type: 'reset' }

/** What the caller should do in response to an event. */
export type PanGestureEffect =
  | { readonly type: 'drag-started' }
  /** `delta` is the total movement since the drag started. */
  | { readonly type: 'dragged'; readonly delta: Point }
  | { readonly type: 'drag-ended' }

export interface PanGestureUpdate {
  readonly gesture: PanGesture
  readonly effect: PanGestureEffect | null
}

const PRIMARY_BUTTON = 0

export function updatePanGesture(gesture: PanGesture, event: PanGestureEvent): PanGestureUpdate {
  switch (event.type) {
    case 'space-down':
      return { gesture: gesture.spaceHeld ? gesture : { ...gesture, spaceHeld: true }, effect: null }

    case 'space-up':
      if (!gesture.spaceHeld && !gesture.drag) return { gesture, effect: null }
      // Releasing Space ends a drag even while the button is still held.
      return { gesture: idlePanGesture, effect: gesture.drag ? { type: 'drag-ended' } : null }

    case 'pointer-down':
      if (!gesture.spaceHeld || gesture.drag || event.button !== PRIMARY_BUTTON) return { gesture, effect: null }
      return {
        gesture: { ...gesture, drag: { pointerId: event.pointerId, start: event.point } },
        effect: { type: 'drag-started' },
      }

    case 'pointer-move': {
      const { drag } = gesture
      if (!drag || drag.pointerId !== event.pointerId) return { gesture, effect: null }
      return {
        gesture,
        effect: { type: 'dragged', delta: { x: event.point.x - drag.start.x, y: event.point.y - drag.start.y } },
      }
    }

    case 'pointer-up':
    case 'pointer-cancel':
      if (!gesture.drag || gesture.drag.pointerId !== event.pointerId) return { gesture, effect: null }
      return { gesture: { ...gesture, drag: null }, effect: { type: 'drag-ended' } }

    case 'reset':
      return {
        gesture: idlePanGesture,
        effect: gesture.drag ? { type: 'drag-ended' } : null,
      }
  }
}
