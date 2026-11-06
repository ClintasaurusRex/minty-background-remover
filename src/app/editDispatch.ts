import type { DisplayImage } from '../canvas/displayImage'
import type { EditorAction, EditorState } from '../editor/editorState'

/*
 * Dispatching edit, Undo and Redo actions, which carry a new display image (Phase 3 Step 6;
 * ownership contract in canvas/displayImage.ts and ARCHITECTURE.md).
 *
 * The action is dispatched inside flushSync: React processes and commits it, and runs the
 * commit's layout effects (the workspace canvas drawing the new image and releasing the one it
 * replaced, and App recording the committed state), before flush returns. Then the committed
 * state says for certain whether the image is in use. If it is not (the reducer rejected the
 * action), the image is released at once instead of waiting for garbage collection.
 *
 * Why that is safe:
 *
 * - Only this action carries the image, and it has been processed.
 * - The reducer never accepts an action whose image has been released: a released image has no
 *   size, and the reducer requires the image to be the new document's size. React can process a
 *   committed update again later (after a lower-priority update queued before it, "rebasing"); a
 *   released image is rejected again there.
 * - Releasing is idempotent.
 *
 * The canvas releases accepted images once they are replaced and the replacement is drawn. That
 * relies on no state being brought back once replaced, which holds as long as React never
 * re-processes a committed edit with a different outcome. In React 19 flushSync renders every
 * pending default- and continuous-priority update in order with the edit (measured in Chrome and
 * Firefox, scripts/browser/edit-ownership.mjs); only transition-priority updates are skipped and
 * re-processed later, and the app dispatches no editor action in a transition. (A selection
 * change in a transition, queued before a Delete, would make the re-processed Delete no longer fit
 * and bring back the image before it, already released: the same script shows it.)
 *
 * Only images the committed state does not hold are released here; the canvas releases the
 * others once they are replaced. React Strict Mode runs reducers twice with the same action, so
 * both runs hold the same image.
 */

export interface EditDispatch {
  /** Sends an action to the editor reducer. */
  readonly dispatch: (action: EditorAction) => void
  /**
   * Runs `update` and returns only once React has processed and committed it and run the
   * commit's layout effects: flushSync. Called only from event handlers, never while React renders.
   */
  readonly flush: (update: () => void) => void
  /** The latest committed editor state (updated by a layout effect). */
  readonly committedState: () => EditorState
  /** Releases a display image's memory (releaseDisplayImage). */
  readonly release: (image: DisplayImage) => void
}

/** The display image an action brings for its new document revision, or null. */
export function actionImage(action: EditorAction): DisplayImage | null {
  switch (action.type) {
    case 'edit-applied':
    case 'edit-undone':
    case 'edit-redone':
      return action.image
    default:
      return null
  }
}

/**
 * Dispatches `action`, committed before this returns, then releases its display image unless the
 * committed state holds it. Also when committing throws: the error is passed on, and the image
 * is released if the committed state does not hold it.
 */
export function dispatchEditAction(action: EditorAction, { dispatch, flush, committedState, release }: EditDispatch): void {
  const image = actionImage(action)
  try {
    flush(() => dispatch(action))
  } finally {
    if (image && committedState().documentBitmap !== image) release(image)
  }
}
