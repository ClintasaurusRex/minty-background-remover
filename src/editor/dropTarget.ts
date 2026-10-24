/*
 * Whether a file is being dragged over the workspace. Browsers fire dragenter and
 * dragleave for every child element crossed, so entries and exits are counted and
 * the workspace stays highlighted until the drag has left it entirely, which keeps
 * the highlight from flickering. A leave towards somewhere outside the workspace
 * (including a cancelled drag, which has no next element) clears it at once, so a
 * missed event cannot leave it stuck on.
 */

/**
 * Browsers repeat dragover every few hundred milliseconds while a drag is over the
 * workspace, even if the pointer is still. If none arrives for this long, the drag
 * has ended without a leave event (some cancellations) and the highlight is cleared.
 */
export const DROP_TARGET_IDLE_MS = 1000

export type DropTargetEvent =
  | { readonly type: 'enter' }
  /** dragover: re-arms the highlight if a browser reported the leave too early. */
  | { readonly type: 'over' }
  /** `stillInside`: the drag moved to another element inside the workspace. */
  | { readonly type: 'leave'; readonly stillInside: boolean }
  | { readonly type: 'drop' }
  | { readonly type: 'reset' }

/** The number of elements inside the workspace the drag has entered and not yet left. */
export type DropTargetDepth = number

export function updateDropTarget(depth: DropTargetDepth, event: DropTargetEvent): DropTargetDepth {
  switch (event.type) {
    case 'enter':
      return depth + 1
    case 'over':
      return Math.max(depth, 1)
    case 'leave':
      return event.stillInside ? Math.max(0, depth - 1) : 0
    case 'drop':
    case 'reset':
      return 0
  }
}

export function isDropTargetActive(depth: DropTargetDepth): boolean {
  return depth > 0
}
