import { formatDimensions } from './documentInfo'
import type { AutoTrimNoChange, EditError, EditNotice } from './editorState'
import type { EditKind } from './history/historyEntry'

/*
 * Text for edit outcomes: what is announced after Delete Selection, Auto Trim, Undo, Redo and
 * Export, and the message shown when one fails.
 */

const EDIT_NAMES: Readonly<Record<EditKind, string>> = {
  'delete-selection': 'Delete Selection',
  'auto-trim': 'Auto Trim',
  crop: 'Crop',
}

/** The edit's name as the controls show it, for example "Delete Selection". */
export function editName(kind: EditKind): string {
  return EDIT_NAMES[kind]
}

/**
 * The announcement for a successful edit, Undo or Redo, an edit that changed nothing, the last
 * Delete made again, or an export.
 */
export function editNoticeText(notice: EditNotice): string {
  switch (notice.kind) {
    case 'exported':
      return `Exported as ${notice.fileName}.`
    case 'applied': {
      const count = notice.changedPixels
      if (notice.operation === 'delete-selection' && count !== null) {
        const deleted = `Selection deleted: ${count.toLocaleString('en-CA')} ${count === 1 ? 'pixel is' : 'pixels are'} now transparent.`
        const edge = notice.edgePixels ?? 0
        if (edge === 0) return deleted
        return `${deleted} ${edge.toLocaleString('en-CA')} edge ${edge === 1 ? 'pixel was' : 'pixels were'} cleaned up or feathered.`
      }
      if (notice.operation === 'auto-trim' && notice.resized) {
        const { from, to } = notice.resized
        const trimmed = `Auto Trim applied: ${formatDimensions(from.width, from.height)} trimmed to ${formatDimensions(to.width, to.height)}.`
        const dropped = notice.droppedUndoSteps ?? 0
        return dropped > 0 ? `${trimmed} ${droppedUndoStepsText(dropped)}` : trimmed
      }
      if (notice.operation === 'crop' && notice.resized) {
        const { from, to } = notice.resized
        const cropped = `Crop applied: ${formatDimensions(from.width, from.height)} cropped to ${formatDimensions(to.width, to.height)}.`
        const dropped = notice.droppedUndoSteps ?? 0
        return dropped > 0 ? `${cropped} ${droppedUndoStepsText(dropped)}` : cropped
      }
      return `${editName(notice.operation)} applied.`
    }
    case 'undone':
      return `Undone: ${editName(notice.operation)}.`
    case 'redone':
      return `Redone: ${editName(notice.operation)}.`
    case 'unchanged':
      if (notice.operation === 'delete-selection') return 'Nothing was deleted: the selected pixels are already transparent.'
      if (notice.trim) return nothingToTrimText(notice.trim)
      return `${editName(notice.operation)} changed nothing.`
    case 'adjusted': {
      const { cleanup, feather } = notice.edgeSettings
      const edge = notice.edgePixels
      const changed =
        edge === 0
          ? 'no edge pixels were changed.'
          : `${edge.toLocaleString('en-CA')} edge ${edge === 1 ? 'pixel was' : 'pixels were'} cleaned up or feathered.`
      return `${editName(notice.operation)} updated with Edge cleanup ${cleanup} px and Feather ${feather} px: ${changed}`
    }
  }
}

/** Why Auto Trim changed nothing, in words. */
function nothingToTrimText(reason: AutoTrimNoChange): string {
  if (reason.kind === 'nothing-visible') return 'Nothing to trim: the image has no visible pixels.'
  return reason.padding === 0
    ? 'Nothing to trim: visible pixels already reach every edge of the image.'
    : `Nothing to trim: no side has more than ${reason.padding} px of transparent space.`
}

/** The older Undo steps an edit's history entry pushed out, in words. */
function droppedUndoStepsText(count: number): string {
  return count === 1
    ? 'Undo history is full, so the oldest Undo step is no longer available.'
    : `Undo history is full, so the ${count.toLocaleString('en-CA')} oldest Undo steps are no longer available.`
}

/**
 * Whether an outcome is also shown as a message in the workspace, not only announced (Phase 3
 * Step 11): Auto Trim finding nothing to trim (otherwise clicking Trim would seem to do nothing),
 * and an Auto Trim or Crop (Phase 4) whose history entry pushed older Undo steps out of the
 * history. Other outcomes are only announced: the image itself shows them.
 */
export function isShownEditNotice(notice: EditNotice): boolean {
  // An export is shown by the browser's download and by the unexported-edits note going away.
  if (notice.kind === 'exported') return false
  if (notice.operation !== 'auto-trim' && notice.operation !== 'crop') return false
  return notice.kind === 'unchanged' || (notice.kind === 'applied' && (notice.droppedUndoSteps ?? 0) > 0)
}

/**
 * Failures that look like the browser running out of memory: typed arrays or canvases that could
 * not be allocated (Chrome "Array buffer allocation failed", Firefox "out of memory" or
 * "allocation size overflow", or a display image the browser created empty or not at all).
 */
const MEMORY_FAILURE = /memory|allocation|invalid (typed )?array length|Created a .* (bitmap|canvas) for|No 2D canvas/i

/** The message shown when an edit, Undo, Redo or Export fails. Nothing has changed when it is shown. */
export function editErrorMessage(error: EditError): string {
  const memory = error.detail !== undefined && MEMORY_FAILURE.test(error.detail)
  const memoryHint = memory ? ' There may not be enough memory for an image this large.' : ''
  if (error.operation === 'export') {
    return `The image could not be exported. Nothing was downloaded, and the image has not changed.${memoryHint}`
  }
  const failed =
    error.operation === 'undo'
      ? 'Undo could not be completed.'
      : error.operation === 'redo'
        ? 'Redo could not be completed.'
        : error.operation === 'adjust'
          ? 'The last Delete Selection could not be updated with the new Edge cleanup and Feather amounts.'
          : error.operation === 'delete-selection'
            ? 'The selected pixels could not be deleted.'
            : `${editName(error.operation)} could not be completed.`
  return `${failed} The image and selection have not changed.${memoryHint}`
}
