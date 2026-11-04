import { type DisplayImage, createDisplayImage } from '../canvas/displayImage'
import { sharesPixelMemory } from '../image/pixelBuffer'
import { type EditorAction, type EditorState, type MagicWandOperation, documentVersion } from './editorState'
import { nextRedo, nextUndo } from './history/editHistory'
import { cropPixels, createCropPatch, restoreCroppedPixels } from './history/cropPatch'
import {
  type EditKind,
  createHistoryEntry,
  restoreSelectionAfter,
  restoreSelectionBefore,
  sizeBefore,
} from './history/historyEntry'
import { applyPixelPatch, createPixelPatch } from './history/pixelPatch'
import { createEditedDocument } from './imageDocument'
import type { DocumentVersion, ImageDocument, PixelBuffer, Rectangle, SelectionMask, Size } from './types'

/*
 * History commands: a completed image edit, Undo and Redo turned into editor actions. As with
 * selection commands, the work happens here, outside the reducer: patches, encoded and decoded
 * selections, the new document revision and its display image. The reducer only accepts or
 * rejects the result (editorState.ts).
 *
 * Every action is tagged with the document version it was computed from. Undo and Redo also
 * carry the history entry they applied, and are accepted only while the history is bound to that
 * version and the entry is still the next one, so a patch is never applied twice or to other
 * pixels: applying a pixel patch to the wrong state would silently produce the wrong image.
 *
 * Display images (canvas/displayImage.ts, ownership contract): each command creates the image for
 * its new revision synchronously, as its last step, so nothing can fail once it exists, and hands
 * it to the editor in its action. If anything fails before, the command returns a failure report
 * and nothing stays allocated. The commands never release images. One whose action the reducer
 * rejects is left to garbage collection until Step 6, where the code that dispatches the action
 * releases it once it is committed and not current (IMPLEMENTATION_PLAN.md, Phase 3 Step 5).
 *
 * These are not connected to the application yet (Phase 3 Step 6).
 */

/**
 * Creates the display image of a new revision's pixels: createDisplayImage, which throws and
 * leaves nothing allocated when it fails. Injected so the commands run in Node tests.
 */
export type CreateDisplayImage = (pixels: PixelBuffer) => DisplayImage

interface CompletedEditBase {
  readonly kind: EditKind
  /** The document version the edit was computed from: the open document's in the state given with it. */
  readonly version: DocumentVersion
  /** The selection the edit leaves (null for Delete, which clears it), the size of the edited image. */
  readonly selection: SelectionMask | null
}

/** An edit that keeps the image's size, such as Delete Selection. */
export interface CompletedPixelEdit extends CompletedEditBase {
  readonly change: 'pixels'
  /** The edited pixels: new memory (copy-on-write), the image's size, never written afterwards. */
  readonly pixels: PixelBuffer
  /**
   * A rectangle containing every pixel the edit changed, such as the bounds Delete Selection
   * reports; only it is compared and stored. The whole image when omitted.
   */
  readonly region?: Readonly<Rectangle>
}

/** An edit that crops the image to a smaller rectangle, such as Auto Trim. */
export interface CompletedCrop extends CompletedEditBase {
  readonly change: 'crop'
  /** The rectangle kept, within the image. */
  readonly kept: Readonly<Rectangle>
}

/** The result of an image edit computed by a tool from the open document and its selection. */
export type CompletedEdit = CompletedPixelEdit | CompletedCrop

/**
 * The action that applies `edit` to the open document and records it for Undo: the patch
 * between the current and edited pixels, the selection and Magic Wand click it started from
 * (encoded), the selection it leaves, a new revision and its display image.
 *
 * `edit` must have been computed from `state`, the latest committed state: its document's
 * pixels and its selection. Returns null, computing nothing more, when `edit.version` is not the
 * open document's, and null without creating anything when the edit changes no pixel (no
 * history entry, no new revision). Returns an `edit-failed` action, with the document, selection
 * and history left as they are, when the edit cannot be recorded or displayed (for example for
 * lack of memory, or edited pixels that are not new memory of the image's size).
 */
export function completedEditCommand(
  state: EditorState,
  edit: CompletedEdit,
  createImage: CreateDisplayImage = createDisplayImage,
): EditorAction | null {
  const { document, selection, lastMagicWandOperation } = state
  const version = documentVersion(state)
  if (!document || !version || !sameVersion(edit.version, version)) return null
  try {
    let patch
    let pixels: PixelBuffer | null
    if (edit.change === 'pixels') {
      // An edit written into the current pixels would compare as unchanged, and would already
      // have changed the current revision: report it rather than dropping it silently.
      if (sharesPixelMemory(edit.pixels, document.pixels)) {
        throw new Error('Edited pixels share memory with the current pixels; an edit must write a copy')
      }
      patch = createPixelPatch(document.pixels, edit.pixels, edit.region)
      pixels = edit.pixels
    } else {
      patch = createCropPatch(document.pixels, edit.kept)
      pixels = patch && cropPixels(document.pixels, edit.kept)
    }
    if (!patch || !pixels) return null

    const entry = createHistoryEntry({
      kind: edit.kind,
      patch,
      selectionBefore: selection,
      magicWandBefore: lastMagicWandOperation,
      selectionAfter: edit.selection,
    })
    const next = createEditedDocument(document, pixels)
    const image = createImage(next.pixels)
    return {
      type: 'edit-applied',
      version,
      selectionBefore: selection,
      magicWandOperationBefore: lastMagicWandOperation,
      entry,
      document: next,
      image,
      selection: edit.selection,
    }
  } catch (cause) {
    return { type: 'edit-failed', error: { operation: edit.kind, detail: describe(cause) } }
  }
}

/**
 * The action that undoes the latest edit: its patch applied backwards to the current pixels as
 * a new revision (never an earlier revision number), its display image, and the selection and
 * Magic Wand click from before the edit, decoded, with the click bound to the new revision so a
 * committed tolerance can re-apply it.
 *
 * Returns null when there is nothing to undo for the open document's version, and an
 * `edit-failed` action, changing nothing, when the restored image cannot be made or displayed.
 */
export function undoCommand(state: EditorState, createImage: CreateDisplayImage = createDisplayImage): EditorAction | null {
  const { document } = state
  const version = documentVersion(state)
  const entry = nextUndo(state.history, version)
  if (!document || !version || !entry) return null
  try {
    const { patch } = entry
    // Both patch functions also refuse pixels of any other size than the edited image's.
    const pixels = patch.kind === 'pixel-patch' ? applyPixelPatch(document.pixels, patch) : restoreCroppedPixels(document.pixels, patch)
    const restored = createEditedDocument(document, pixels)
    const { selection, magicWand } = restoreSelectionBefore(entry)
    requireMaskSize(selection, restored)
    requireMaskSize(magicWand?.base ?? null, restored)
    const magicWandOperation: MagicWandOperation | null = magicWand && { version: versionOf(restored), ...magicWand }
    const image = createImage(restored.pixels)
    return { type: 'edit-undone', version, entry, document: restored, image, selection, magicWandOperation }
  } catch (cause) {
    return { type: 'edit-failed', error: { operation: 'undo', detail: describe(cause) } }
  }
}

/**
 * The action that redoes the most recently undone edit: its patch applied forwards to the
 * current pixels as a new revision, its display image, and the selection the edit left.
 *
 * Returns null when there is nothing to redo for the open document's version, and an
 * `edit-failed` action, changing nothing, when the image cannot be made or displayed.
 */
export function redoCommand(state: EditorState, createImage: CreateDisplayImage = createDisplayImage): EditorAction | null {
  const { document } = state
  const version = documentVersion(state)
  const entry = nextRedo(state.history, version)
  if (!document || !version || !entry) return null
  try {
    const { patch } = entry
    // The history's binding already guarantees this. cropPixels cannot check it: any image
    // containing the kept rectangle would do, so a crop must never meet another image's pixels.
    requireSize(document, sizeBefore(patch), 'The image to redo')
    const pixels = patch.kind === 'pixel-patch' ? applyPixelPatch(document.pixels, patch) : cropPixels(document.pixels, patch.kept)
    const redone = createEditedDocument(document, pixels)
    const selection = restoreSelectionAfter(entry)
    requireMaskSize(selection, redone)
    const image = createImage(redone.pixels)
    return { type: 'edit-redone', version, entry, document: redone, image, selection }
  } catch (cause) {
    return { type: 'edit-failed', error: { operation: 'redo', detail: describe(cause) } }
  }
}

/** Whether Undo and Redo have anything to apply to the open document. Constant time. */
export function availableHistoryActions(state: EditorState): Readonly<{ undo: boolean; redo: boolean }> {
  const version = documentVersion(state)
  return { undo: nextUndo(state.history, version) !== null, redo: nextRedo(state.history, version) !== null }
}

function sameVersion(a: DocumentVersion, b: DocumentVersion): boolean {
  return a.documentId === b.documentId && a.revision === b.revision
}

function versionOf(document: ImageDocument): DocumentVersion {
  return { documentId: document.id, revision: document.revision }
}

function requireSize(actual: Size, expected: Size, what: string): void {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new RangeError(`${what} is ${actual.width} × ${actual.height}; the history entry needs ${expected.width} × ${expected.height}`)
  }
}

function requireMaskSize(mask: SelectionMask | null, document: ImageDocument): void {
  if (mask) requireSize(mask, document, 'A restored selection')
}

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
}
