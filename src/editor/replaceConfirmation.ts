import type { ImportRequest } from '../image/import/importImage'
import type { ImageSource } from './types'

/*
 * The question asked before an image with unexported edits is replaced (P3-D12), as a small
 * store the import sources ask through (createImportSources' confirmReplace) and the dialog
 * renders from (useSyncExternalStore). No DOM or React, so it is tested in Node.
 */

/** An image waiting for the user to confirm that it may replace the open, edited one. */
export interface ReplaceQuestion {
  /** The image that would be opened. */
  readonly name: string
  readonly source: ImageSource
}

export interface ReplaceConfirmation {
  /**
   * For createImportSources: true at once when nothing would be lost (`isNeeded()` is false);
   * false at once while another question is open, so questions never overlap and an image
   * arriving meanwhile is not opened; otherwise a promise answered by `answer`.
   */
  readonly confirmReplace: (request: ImportRequest) => boolean | Promise<boolean>
  /** The open question, or null. The same object until it is answered. */
  readonly question: () => ReplaceQuestion | null
  /** Answers the open question (true: replace the image); does nothing without one. */
  readonly answer: (replace: boolean) => void
  /** Calls `listener` whenever a question opens or is answered. Returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void
  /** Sets the check read when an import is about to start: whether the open image has unexported edits. */
  readonly setNeeded: (isNeeded: () => boolean) => void
}

export function createReplaceConfirmation(): ReplaceConfirmation {
  let isNeeded: () => boolean = () => false
  let open: { readonly question: ReplaceQuestion; readonly resolve: (replace: boolean) => void } | null = null
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    confirmReplace: (request) => {
      if (open) return false
      if (!isNeeded()) return true
      return new Promise<boolean>((resolve) => {
        open = { question: { name: request.name, source: request.source }, resolve }
        notify()
      })
    },
    question: () => open?.question ?? null,
    answer: (replace) => {
      const answered = open
      if (!answered) return
      open = null
      notify()
      answered.resolve(replace)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setNeeded: (check) => {
      isNeeded = check
    },
  }
}
