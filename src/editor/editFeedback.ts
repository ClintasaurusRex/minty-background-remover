import type { EditError, EditNotice } from './editorState'
import type { EditKind } from './history/historyEntry'

/*
 * Text for edit outcomes: what is announced after Delete Selection, Undo and Redo, and the
 * message shown when one fails.
 */

const EDIT_NAMES: Readonly<Record<EditKind, string>> = {
  'delete-selection': 'Delete Selection',
  'auto-trim': 'Auto Trim',
}

/** The edit's name as the controls show it, for example "Delete Selection". */
export function editName(kind: EditKind): string {
  return EDIT_NAMES[kind]
}

/** The announcement for a successful edit, Undo or Redo, or an edit that changed nothing. */
export function editNoticeText(notice: EditNotice): string {
  switch (notice.kind) {
    case 'applied': {
      const count = notice.changedPixels
      if (notice.operation === 'delete-selection' && count !== null) {
        const deleted = `Selection deleted: ${count.toLocaleString('en-CA')} ${count === 1 ? 'pixel is' : 'pixels are'} now transparent.`
        const edge = notice.edgePixels ?? 0
        if (edge === 0) return deleted
        return `${deleted} ${edge.toLocaleString('en-CA')} edge ${edge === 1 ? 'pixel was' : 'pixels were'} cleaned up or feathered.`
      }
      return `${editName(notice.operation)} applied.`
    }
    case 'undone':
      return `Undone: ${editName(notice.operation)}.`
    case 'redone':
      return `Redone: ${editName(notice.operation)}.`
    case 'unchanged':
      return notice.operation === 'delete-selection'
        ? 'Nothing was deleted: the selected pixels are already transparent.'
        : `${editName(notice.operation)} changed nothing.`
  }
}

/**
 * Failures that look like the browser running out of memory: typed arrays or canvases that could
 * not be allocated (Chrome "Array buffer allocation failed", Firefox "out of memory" or
 * "allocation size overflow", or a display image the browser created empty or not at all).
 */
const MEMORY_FAILURE = /memory|allocation|invalid (typed )?array length|Created a .* (bitmap|canvas) for|No 2D canvas/i

/** The message shown when an edit, Undo or Redo fails. Nothing has changed when it is shown. */
export function editErrorMessage(error: EditError): string {
  const failed =
    error.operation === 'undo'
      ? 'Undo could not be completed.'
      : error.operation === 'redo'
        ? 'Redo could not be completed.'
        : error.operation === 'delete-selection'
          ? 'The selected pixels could not be deleted.'
          : `${editName(error.operation)} could not be completed.`
  const memory = error.detail !== undefined && MEMORY_FAILURE.test(error.detail)
  return `${failed} The image and selection have not changed.${memory ? ' There may not be enough memory for an image this large.' : ''}`
}
