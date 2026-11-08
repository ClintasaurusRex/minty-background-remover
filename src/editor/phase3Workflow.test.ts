import { beforeEach, describe, expect, it } from 'vitest'
import { type EdgeSettings, deleteSelectionWithEdges } from '../image/edit/deleteWithEdges'
import { edgeCases } from '../image/edit/edgeTestFixtures'
import { createImportError } from '../image/import/errors'
import { createPixelBuffer } from '../image/pixelBuffer'
import { DEFAULT_AUTO_TRIM_PADDING } from './autoTrimPadding'
import { adjustDeleteCommand, adjustableDelete, availableEditActions, editActionCommand, hasUnexportedEdits } from './editCommands'
import {
  type EditorAction,
  type EditorState,
  type MagicWandOperation,
  displayViewport,
  documentVersion,
  editorReducer,
  initialEditorState,
} from './editorState'
import { DEFAULT_HISTORY_LIMITS, type HistoryLimits, createEditHistory, historyRetainedBytes } from './history/editHistory'
import type { EditKind } from './history/historyEntry'
import {
  type FakeDisplayImage,
  type FakeDisplayImages,
  WORKSPACE,
  fakeDisplayImages,
  opened,
  randomInt,
  randomSource,
  reduce,
  sameSelection,
} from './history/testFixtures'
import { type SelectionAction, magicWandClick, selectionActionCommand } from './selectionCommands'
import type { PixelBuffer, Rectangle, SelectionMask, SelectionMode } from './types'

/*
 * Phase 3 final QA (Step 12): every Phase 3 edit together, as the application runs them, against
 * a model of the content states. The commands are the application's own (editActionCommand for
 * Delete Selection, Auto Trim, Undo and Redo; adjustDeleteCommand for committed edge amounts; real
 * Magic Wand clicks and selection actions), mixed at random with no-ops, stale replays, failures,
 * imports in progress, failed and successful imports, under three history limit regimes.
 *
 * The model keeps a copy of every content state's bytes, hidden colour included, and what each
 * step between them recorded. Expected results are computed from the model's own copies, never
 * from the history: a trim by a full alpha scan and indexing, a Delete at 0 / 0 by setting alpha
 * 0 on selected pixels, a Delete with edge amounts by running the algorithm on the model's copy
 * of the pixels before it (so an adjustment is checked against a fresh Delete, not against the
 * patch it rebuilds from). After every step the open document must equal the model byte for byte,
 * with the selection, Magic Wand click, stacks, retained bytes, limits, edit depth, adjustability
 * and availability the model expects.
 */

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })
const start = (pixels: PixelBuffer, limits: HistoryLimits) => opened(pixels, { ...measured, history: createEditHistory(limits) })

interface Content {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

type Click = Omit<MagicWandOperation, 'version'>

/** What the step from content state i - 1 to i recorded. */
interface Step {
  readonly kind: EditKind
  readonly selectionBefore: SelectionMask | null
  readonly clickBefore: Click | null
  /** For Delete Selection: the amounts its current result was made with. */
  edgeSettings: EdgeSettings | null
}

const contentOf = (pixels: PixelBuffer): Content => ({ width: pixels.width, height: pixels.height, data: pixels.data.slice() })
const bufferOf = (content: Content): PixelBuffer => createPixelBuffer(content.width, content.height, content.data.slice())

function sameContent(pixels: PixelBuffer, content: Content): boolean {
  if (pixels.width !== content.width || pixels.height !== content.height || pixels.data.length !== content.data.length) return false
  for (let i = 0; i < content.data.length; i++) if (pixels.data[i] !== content.data[i]) return false
  return true
}

/** Delete at 0 / 0 by definition: alpha 0 for every selected pixel, every other byte kept. Null when nothing changes. */
function referenceDelete(content: Content, selection: SelectionMask): Content | null {
  const data = content.data.slice()
  let changed = false
  for (let p = 0; p < selection.data.length; p++) {
    if (selection.data[p] && data[p * 4 + 3] !== 0) {
      data[p * 4 + 3] = 0
      changed = true
    }
  }
  return changed ? { width: content.width, height: content.height, data } : null
}

/** The rectangle Auto Trim keeps: every alpha above 0 scanned, the padding clipped at each edge; null when nothing is visible. */
function referenceKept(content: Content, padding: number): Rectangle | null {
  let left = Infinity
  let top = Infinity
  let right = -1
  let bottom = -1
  for (let y = 0; y < content.height; y++) {
    for (let x = 0; x < content.width; x++) {
      if (content.data[(y * content.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < 0) return null
  const x = Math.max(0, left - padding)
  const y = Math.max(0, top - padding)
  return { x, y, width: Math.min(content.width, right + 1 + padding) - x, height: Math.min(content.height, bottom + 1 + padding) - y }
}

function cropOf(content: Content, kept: Rectangle): Content {
  const data = new Uint8ClampedArray(kept.width * kept.height * 4)
  for (let y = 0; y < kept.height; y++) {
    const from = ((kept.y + y) * content.width + kept.x) * 4
    data.set(content.data.subarray(from, from + kept.width * 4), y * kept.width * 4)
  }
  return { width: kept.width, height: kept.height, data }
}

/**
 * Guarantees of every Delete whatever the amounts (FEATURE_SPEC §8–9): selected visible pixels
 * become alpha 0 with their colour kept; already transparent pixels keep every byte; no alpha
 * rises; a pixel made fully transparent keeps its original colour, hidden.
 */
function expectDeleteGuarantees(before: Content, after: PixelBuffer, selection: SelectionMask, where: string): void {
  for (let p = 0; p < selection.data.length; p++) {
    const i = p * 4
    const [r, g, b, a] = [before.data[i], before.data[i + 1], before.data[i + 2], before.data[i + 3]]
    const [r2, g2, b2, a2] = [after.data[i], after.data[i + 1], after.data[i + 2], after.data[i + 3]]
    if (a === 0 || selection.data[p]) {
      expect([r2, g2, b2, a2], `${where}: pixel ${p}`).toEqual([r, g, b, 0])
      continue
    }
    expect(a2, `${where}: alpha never rises at ${p}`).toBeLessThanOrEqual(a)
    if (a2 === 0) expect([r2, g2, b2], `${where}: hidden colour at ${p}`).toEqual([r, g, b])
  }
}

/**
 * A small test picture: an opaque flat background (sometimes inside a transparent border hiding
 * random colours), a few rectangles of other colours, some partly transparent, and scattered
 * pixels of alpha 0, 1, 128 and 255.
 */
function picture(random: () => number): PixelBuffer {
  const width = 3 + randomInt(random, 12)
  const height = 3 + randomInt(random, 10)
  const data = new Uint8ClampedArray(width * height * 4)
  const backgrounds = [
    [240, 240, 240],
    [30, 120, 200],
    [0, 0, 0],
  ]
  const background = backgrounds[randomInt(random, backgrounds.length)]
  const border = random() < 0.5 ? randomInt(random, 3) : 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outside = x < border || y < border || x >= width - border || y >= height - border
      const colour = outside ? [randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), 0] : [...background, 255]
      data.set(colour, (y * width + x) * 4)
    }
  }
  for (let shapes = 1 + randomInt(random, 3); shapes > 0; shapes--) {
    const x0 = randomInt(random, width)
    const y0 = randomInt(random, height)
    const x1 = Math.min(width, x0 + 1 + randomInt(random, 5))
    const y1 = Math.min(height, y0 + 1 + randomInt(random, 4))
    const colour = [randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), random() < 0.6 ? 255 : 1 + randomInt(random, 254)]
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(colour, (y * width + x) * 4)
  }
  for (let specks = randomInt(random, 4); specks > 0; specks--) {
    const alpha = [0, 1, 128, 255][randomInt(random, 4)]
    data.set([randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), alpha], randomInt(random, width * height) * 4)
  }
  return createPixelBuffer(width, height, data)
}

/** The version an action was computed for, when it carries one. */
function taggedVersion(action: EditorAction) {
  if (action.type === 'magic-wand-applied' || action.type === 'magic-wand-reapplied') return action.operation.version
  return 'version' in action ? action.version : null
}

type Regime = 'count' | 'bytes' | 'default'

describe('Phase 3 workflow: randomized Delete, edge adjustments, Auto Trim, Undo and Redo with the application commands', () => {
  it('keeps every content state exact, restores selections and clicks, and keeps the history within its limits', () => {
    const tally = { deletes: 0, adjustments: 0, trims: 0, undos: 0, redos: 0, noOps: 0, stale: 0, failures: 0, imports: 0, evicted: 0 }
    const SEEDS = 60
    const STEPS = 90
    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = randomSource(seed * 104729)
      const regime: Regime = (['count', 'bytes', 'default'] as const)[seed % 3]
      const limits: HistoryLimits =
        regime === 'count'
          ? { maxEntries: 1 + randomInt(random, 5), maxBytes: 2 ** 30 }
          : regime === 'bytes'
            ? // Every entry retains more than 0 bytes: only the newest entry is ever kept.
              { maxEntries: 25, maxBytes: 0 }
            : DEFAULT_HISTORY_LIMITS
      let state = start(picture(random), limits)

      // The model.
      let timeline: Content[] = [contentOf(state.document!.pixels)]
      let steps: (Step | null)[] = [null]
      let index = 0
      let oldest = 0
      let selection: SelectionMask | null = null
      let click: Click | null = null
      let adjustable = false
      let depth = 0
      let settings: EdgeSettings = { cleanup: 0, feather: 0 }
      let padding = DEFAULT_AUTO_TRIM_PADDING
      const revisions = new Set<number>([state.document!.revision])
      const past: EditorAction[] = []
      let importId = 70_000 + seed * 1000

      const check = (where: string) => {
        const document = state.document!
        expect(sameContent(document.pixels, timeline[index]), `${where}: pixels`).toBe(true)
        expect(sameSelection(state.selection, selection), `${where}: selection`).toBe(true)
        const op = state.lastMagicWandOperation
        if (!click) expect(op, `${where}: click`).toBeNull()
        else {
          expect(op, `${where}: click`).not.toBeNull()
          const { version, base, ...rest } = op!
          const { base: modelBase, ...modelRest } = click
          expect(version, `${where}: click version`).toEqual(documentVersion(state))
          expect(rest, `${where}: click`).toEqual(modelRest)
          expect(sameSelection(base, modelBase), `${where}: click base`).toBe(true)
        }
        const { history } = state
        expect(history.undo.length, `${where}: undo steps`).toBe(index - oldest)
        expect(history.redo.length, `${where}: redo steps`).toBe(timeline.length - 1 - index)
        expect(history.undo.map((e) => e.kind), `${where}: undo kinds`).toEqual(steps.slice(oldest + 1, index + 1).map((s) => s!.kind))
        expect(history.retainedBytes, `${where}: accounting`).toBe(historyRetainedBytes([...history.undo, ...history.redo]))
        const total = history.undo.length + history.redo.length
        expect(total, `${where}: entry limit`).toBeLessThanOrEqual(limits.maxEntries)
        expect(history.retainedBytes <= limits.maxBytes || total === 1, `${where}: byte limit`).toBe(true)
        expect(state.editDepth, `${where}: depth`).toBe(depth)
        expect(hasUnexportedEdits(state), `${where}: unexported`).toBe(depth !== 0)
        expect(adjustableDelete(state) !== null, `${where}: adjustable`).toBe(adjustable)
        const available = availableEditActions(state)
        expect(available.undo, `${where}: Undo offered`).toBe(index > oldest ? steps[index]!.kind : null)
        expect(available.redo, `${where}: Redo offered`).toBe(index < timeline.length - 1 ? steps[index + 1]!.kind : null)
        expect(available.deleteSelection, `${where}: Delete offered`).toBe(selection !== null)
        expect(state.autoTrimPadding, `${where}: padding`).toBe(padding)
        expect(state.edgeSettings, `${where}: amounts`).toEqual(settings)
      }

      /** Applies an action that must change the document: a fresh revision and its own display image. */
      const changeDocument = (action: EditorAction, where: string) => {
        const next = editorReducer(state, action)
        expect(next, `${where}: accepted`).not.toBe(state)
        expect(revisions.has(next.document!.revision), `${where}: fresh revision`).toBe(false)
        expect(next.document!.revision, `${where}: newer revision`).toBeGreaterThan(state.document!.revision)
        revisions.add(next.document!.revision)
        // The action's own display image, showing exactly the new pixels.
        const image = next.documentBitmap as unknown as FakeDisplayImage
        expect(image, `${where}: display image`).toBe('image' in action ? action.image : undefined)
        expect(image.pixels, `${where}: display image pixels`).toBe(next.document!.pixels)
        past.push(action)
        state = next
      }

      /** Applies an action that must change nothing but the feedback. */
      const changeNothing = (action: EditorAction, where: string) => {
        const next = editorReducer(state, action)
        expect(next.document, `${where}: document`).toBe(state.document)
        expect(next.history, `${where}: history`).toBe(state.history)
        expect(next.selection, `${where}: selection`).toBe(state.selection)
        expect(next.documentBitmap, `${where}: image`).toBe(state.documentBitmap)
        state = next
      }

      /** Records a new edit in the model: Redo cleared, the oldest steps dropped as the limits require. */
      const record = (after: Content, step: Step) => {
        const offered = index - oldest
        timeline = [...timeline.slice(0, index + 1), after]
        steps = [...steps.slice(0, index + 1), step]
        index++
        oldest = regime === 'bytes' ? index - 1 : Math.max(oldest, index - limits.maxEntries)
        const dropped = offered + 1 - (index - oldest)
        tally.evicted += dropped
        // The applied notice counts exactly the Undo steps the history dropped.
        const notice = state.editNotice
        expect(notice?.kind === 'applied' ? (notice.droppedUndoSteps ?? 0) : -1).toBe(dropped)
        selection = null
        click = null
        depth++
      }

      /** Computes an edit action twice from one state: only the first may ever apply. */
      const twice = (compute: () => EditorAction | null) => {
        const first = compute()
        const second = first && first.type !== 'edit-unchanged' && first.type !== 'edit-failed' ? compute() : null
        return { first, second }
      }
      const expectStale = (action: EditorAction | null, where: string) => {
        if (action) expect(editorReducer(state, action), `${where}: stale twin`).toBe(state)
      }

      const pointAt = (x: number, y: number) => {
        const viewport = displayViewport(state)!
        return { x: viewport.offset.x + (x + 0.5) * viewport.zoom, y: viewport.offset.y + (y + 0.5) * viewport.zoom }
      }

      for (let n = 0; n < STEPS; n++) {
        const where = `seed ${seed} (${regime}), step ${n}`
        const current = timeline[index]
        const roll = random()

        if (roll < 0.16) {
          // A Magic Wand click: tolerance, Contiguous / Global and New / Add / Subtract at random.
          state = reduce(
            state,
            { type: 'magic-wand-tolerance-changed', tolerance: randomInt(random, 61) },
            { type: 'magic-wand-flood-mode-changed', floodMode: random() < 0.6 ? 'contiguous' : 'global' },
          )
          const modes: SelectionMode[] = ['new', 'new', 'add', 'subtract']
          const action = magicWandClick(state, pointAt(randomInt(random, current.width), randomInt(random, current.height)), modes[randomInt(random, modes.length)])
          if (action) {
            const next = editorReducer(state, action)
            past.push(action)
            if (next !== state) {
              expect(next.history, where).toBe(state.history)
              state = next
              selection = state.selection
              const { seed, floodMode, selectionMode, base, tolerance } = state.lastMagicWandOperation!
              click = { seed, floodMode, selectionMode, base, tolerance }
              adjustable = false
            }
          }
        } else if (roll < 0.24) {
          // Select All, Clear, Invert, Grow, Shrink: never history.
          const actions: SelectionAction[] = ['select-all', 'clear', 'invert', 'grow', 'shrink']
          const action = selectionActionCommand(state, actions[randomInt(random, actions.length)])
          if (action) {
            const next = editorReducer(state, action)
            past.push(action)
            if (next !== state) {
              expect(next.history, where).toBe(state.history)
              state = next
              selection = state.selection
              click = null
              adjustable = false
            }
          }
        } else if (roll < 0.38) {
          // Delete Selection with the amounts set now.
          const { first, second } = twice(() => editActionCommand(state, 'delete-selection', images.create))
          if (!selection) expect(first, where).toBeNull()
          else {
            const expected = deleteSelectionWithEdges(bufferOf(current), selection, settings)
            if (!expected) {
              expect(first?.type, `${where}: Delete no-op`).toBe('edit-unchanged')
              changeNothing(first!, where)
              tally.noOps++
            } else {
              expect(first?.type, where).toBe('edit-applied')
              changeDocument(first!, where)
              expectStale(second, where)
              const pixels = state.document!.pixels
              expect(sameContent(pixels, contentOf(expected.pixels)), `${where}: Delete result`).toBe(true)
              expectDeleteGuarantees(current, pixels, selection, where)
              if (settings.cleanup === 0 && settings.feather === 0) {
                expect(sameContent(pixels, referenceDelete(current, selection)!), `${where}: exact Delete`).toBe(true)
              }
              record(contentOf(pixels), { kind: 'delete-selection', selectionBefore: selection, clickBefore: click, edgeSettings: settings })
              adjustable = true
              tally.deletes++
            }
          }
        } else if (roll < 0.49) {
          // A finished Edge cleanup or Feather change, as useEditCommands commits it.
          const change: Partial<EdgeSettings> =
            random() < 0.4 ? { cleanup: randomInt(random, 6) } : random() < 0.6 ? { feather: randomInt(random, 6) } : { cleanup: randomInt(random, 6), feather: randomInt(random, 6) }
          const before = state
          const merged = { ...settings, ...change }
          state = reduce(state, { type: 'edge-settings-changed', settings: change })
          settings = merged
          const { first, second } = twice(() => adjustDeleteCommand(before, merged, images.create))
          const step = steps[index]
          const differs = step?.edgeSettings && (step.edgeSettings.cleanup !== merged.cleanup || step.edgeSettings.feather !== merged.feather)
          if (!adjustable || !differs) expect(first, `${where}: nothing to adjust`).toBeNull()
          else {
            expect(first?.type, where).toBe('edit-adjusted')
            changeDocument(first!, where)
            expectStale(second, where)
            // Exactly a fresh Delete of the pixels before it, with its selection and the new amounts.
            const beforeDelete = timeline[index - 1]
            const fresh = deleteSelectionWithEdges(bufferOf(beforeDelete), step!.selectionBefore!, merged)!
            const pixels = state.document!.pixels
            expect(sameContent(pixels, contentOf(fresh.pixels)), `${where}: adjusted result`).toBe(true)
            expectDeleteGuarantees(beforeDelete, pixels, step!.selectionBefore!, where)
            if (merged.cleanup === 0 && merged.feather === 0) {
              expect(sameContent(pixels, referenceDelete(beforeDelete, step!.selectionBefore!)!), `${where}: back to the exact Delete`).toBe(true)
            }
            timeline = [...timeline.slice(0, index), contentOf(pixels)]
            step!.edgeSettings = merged
            if (regime === 'bytes') oldest = index - 1
            tally.adjustments++
          }
        } else if (roll < 0.6) {
          // Auto Trim with a preset or custom padding.
          const choices = [0, 5, 10, 20, 1, 2, randomInt(random, 51)]
          padding = choices[randomInt(random, choices.length)]
          state = reduce(state, { type: 'auto-trim-padding-changed', padding })
          const { first, second } = twice(() => editActionCommand(state, 'auto-trim', images.create))
          const kept = referenceKept(current, padding)
          if (!kept || (kept.width === current.width && kept.height === current.height)) {
            expect(first?.type, `${where}: Trim no-op`).toBe('edit-unchanged')
            expect(first?.type === 'edit-unchanged' && first.trim?.kind, where).toBe(kept ? 'no-border' : 'nothing-visible')
            changeNothing(first!, where)
            tally.noOps++
          } else {
            expect(first?.type, where).toBe('edit-applied')
            changeDocument(first!, where)
            expectStale(second, where)
            const after = cropOf(current, kept)
            expect(sameContent(state.document!.pixels, after), `${where}: trimmed bytes`).toBe(true)
            record(after, { kind: 'auto-trim', selectionBefore: selection, clickBefore: click, edgeSettings: null })
            adjustable = false
            tally.trims++
          }
        } else if (roll < 0.74) {
          const { first, second } = twice(() => editActionCommand(state, 'undo', images.create))
          expect(first !== null, `${where}: Undo available`).toBe(index > oldest)
          if (first) {
            expect(first.type, where).toBe('edit-undone')
            changeDocument(first, where)
            expectStale(second, where)
            const step = steps[index]!
            index--
            selection = step.selectionBefore
            click = step.clickBefore
            adjustable = false
            depth--
            tally.undos++
          }
        } else if (roll < 0.84) {
          const { first, second } = twice(() => editActionCommand(state, 'redo', images.create))
          expect(first !== null, `${where}: Redo available`).toBe(index < timeline.length - 1)
          if (first) {
            expect(first.type, where).toBe('edit-redone')
            changeDocument(first, where)
            expectStale(second, where)
            index++
            selection = null
            click = null
            adjustable = steps[index]!.kind === 'delete-selection' && index === timeline.length - 1
            depth++
            tally.redos++
          }
        } else if (roll < 0.89) {
          // Every action computed for an earlier version, or another image, is rejected.
          const version = documentVersion(state)!
          const stale = past.filter((action) => {
            const tagged = taggedVersion(action)
            return tagged !== null && (tagged.documentId !== version.documentId || tagged.revision !== version.revision)
          })
          for (let k = 0; k < 3 && stale.length > 0; k++) {
            const action = stale[randomInt(random, stale.length)]
            expect(editorReducer(state, action), `${where}: stale ${action.type}`).toBe(state)
            tally.stale++
          }
        } else if (roll < 0.93) {
          // The display image cannot be created (out of memory): nothing changes, an error is shown.
          images.failing = true
          const kinds = ['delete-selection', 'auto-trim', 'undo', 'redo'] as const
          const action =
            random() < 0.2
              ? adjustDeleteCommand(state, { cleanup: (settings.cleanup + 1) % 6, feather: settings.feather }, images.create)
              : editActionCommand(state, kinds[randomInt(random, kinds.length)], images.create)
          images.failing = false
          if (action?.type === 'edit-failed') {
            const next = editorReducer(state, action)
            expect(next.document, where).toBe(state.document)
            expect(next.history, where).toBe(state.history)
            expect(next.selection, where).toBe(state.selection)
            expect(next.editError, where).not.toBeNull()
            expect(adjustableDelete(next), where).toBe(adjustableDelete(state))
            state = next
            tally.failures++
          } else if (action?.type === 'edit-unchanged') changeNothing(action, where)
          else expect(action, where).toBeNull()
        } else if (roll < 0.97) {
          // Another image opening: no edit is available meanwhile; then it fails (everything kept).
          const id = importId++
          state = reduce(state, { type: 'import-started', importId: id })
          for (const kind of ['delete-selection', 'auto-trim', 'undo', 'redo'] as const) expect(editActionCommand(state, kind, images.create), where).toBeNull()
          expect(adjustDeleteCommand(state, { cleanup: 5 - settings.cleanup, feather: settings.feather }, images.create), where).toBeNull()
          expect(adjustableDelete(state), where).toBeNull()
          const next = reduce(state, { type: 'import-finished', importId: id, result: { ok: false, error: createImportError('decode-failed') } })
          expect(next.history, where).toBe(state.history)
          expect(next.document, where).toBe(state.document)
          state = next
        } else {
          // Another image replaces this one: nothing of this one's history can ever apply again.
          const previousHistory = state.history
          state = opened(picture(random), state)
          expect(state.history.limits, where).toBe(previousHistory.limits)
          expect(state.history.undo.length + state.history.redo.length, where).toBe(0)
          timeline = [contentOf(state.document!.pixels)]
          steps = [null]
          index = 0
          oldest = 0
          selection = null
          click = null
          adjustable = false
          depth = 0
          padding = DEFAULT_AUTO_TRIM_PADDING
          revisions.add(state.document!.revision)
          tally.imports++
        }
        check(where)
      }

      // Back to the oldest content state still kept, and forward again to the newest.
      while (index > oldest) {
        const action = editActionCommand(state, 'undo', images.create)!
        changeDocument(action, `seed ${seed}, final undo`)
        const step = steps[index]!
        index--
        selection = step.selectionBefore
        click = step.clickBefore
        adjustable = false
        depth--
        check(`seed ${seed}, final undo to ${index}`)
      }
      expect(editActionCommand(state, 'undo', images.create)).toBeNull()
      while (index < timeline.length - 1) {
        changeDocument(editActionCommand(state, 'redo', images.create)!, `seed ${seed}, final redo`)
        index++
        selection = null
        click = null
        adjustable = steps[index]!.kind === 'delete-selection' && index === timeline.length - 1
        depth++
        check(`seed ${seed}, final redo to ${index}`)
      }
      expect(editActionCommand(state, 'redo', images.create)).toBeNull()
    }
    // The run exercised every kind of step, not only the cheap ones.
    for (const [kind, count] of Object.entries(tally)) expect(count, kind).toBeGreaterThan(10)
  })
})

describe('Phase 3 workflow: Delete → adjust → Auto Trim → Undo → Redo', () => {
  it.each(['lines and wiring', 'icon on white', 'icon, JPEG artefacts'])('%s: every content state restored byte for byte, adjusting never degrades', (name) => {
    const hmi = edgeCases().find((c) => c.name === name)!
    const original = contentOf(hmi.observed)
    let state = opened(hmi.observed, measured)
    state = editorReducer(state, { type: 'selection-applied', version: documentVersion(state)!, selection: hmi.selection })
    const selection = state.selection!
    const run = (s: EditorState, action: 'delete-selection' | 'auto-trim' | 'undo' | 'redo') => {
      const next = editorReducer(s, editActionCommand(s, action, images.create)!)
      expect(next).not.toBe(s)
      return next
    }
    const adjust = (s: EditorState, settings: EdgeSettings) => {
      const changed = reduce(s, { type: 'edge-settings-changed', settings })
      const next = editorReducer(changed, adjustDeleteCommand(s, settings, images.create)!)
      expect(next).not.toBe(changed)
      return next
    }

    const exactDelete = referenceDelete(original, selection)!
    let deleted = run(state, 'delete-selection')
    expect(sameContent(deleted.document!.pixels, exactDelete)).toBe(true)
    const firstEntryBytes = deleted.history.undo[0].retainedBytes

    // Ten adjustments, some repeated: each equals one fresh Delete with those amounts.
    const sequence: EdgeSettings[] = [
      { cleanup: 1, feather: 0 },
      { cleanup: 5, feather: 5 },
      { cleanup: 1, feather: 0 },
      { cleanup: 2, feather: 2 },
      { cleanup: 0, feather: 3 },
      { cleanup: 1, feather: 0 },
      { cleanup: 0, feather: 0 },
      { cleanup: 3, feather: 1 },
      { cleanup: 1, feather: 0 },
      { cleanup: 1, feather: 1 },
    ]
    const results = new Map<string, Content>()
    for (const settings of sequence) {
      deleted = adjust(deleted, settings)
      const fresh = contentOf(deleteSelectionWithEdges(hmi.observed, selection, settings)!.pixels)
      expect(sameContent(deleted.document!.pixels, fresh)).toBe(true)
      const key = `${settings.cleanup}/${settings.feather}`
      if (results.has(key)) expect(sameContent(deleted.document!.pixels, results.get(key)!)).toBe(true)
      results.set(key, contentOf(deleted.document!.pixels))
      if (key === '0/0') {
        // Back at 0 / 0: the exact Delete again, recorded at the same cost as the first Delete.
        expect(sameContent(deleted.document!.pixels, exactDelete)).toBe(true)
        expect(deleted.history.undo[0].retainedBytes).toBe(firstEntryBytes)
      }
      expect(deleted.history.undo).toHaveLength(1)
      expect(deleted.editDepth).toBe(1)
    }
    const adjusted = contentOf(deleted.document!.pixels)

    const trimmed = run(reduce(deleted, { type: 'auto-trim-padding-changed', padding: 0 }), 'auto-trim')
    const kept = referenceKept(adjusted, 0)!
    expect(kept.width * kept.height).toBeLessThan(original.width * original.height)
    expect(sameContent(trimmed.document!.pixels, cropOf(adjusted, kept))).toBe(true)
    expect(adjustableDelete(trimmed)).toBeNull()

    const undoTrim = run(trimmed, 'undo')
    expect(sameContent(undoTrim.document!.pixels, adjusted)).toBe(true)
    const undoDelete = run(undoTrim, 'undo')
    expect(sameContent(undoDelete.document!.pixels, original)).toBe(true)
    expect(sameSelection(undoDelete.selection, selection)).toBe(true)
    expect(undoDelete.editDepth).toBe(0)
    expect(hasUnexportedEdits(undoDelete)).toBe(false)
    const redoDelete = run(undoDelete, 'redo')
    expect(sameContent(redoDelete.document!.pixels, adjusted)).toBe(true)
    // Something can still be redone, so the redone Delete cannot be adjusted (its Redo would no longer fit).
    expect(adjustableDelete(redoDelete)).toBeNull()
    const redoTrim = run(redoDelete, 'redo')
    expect(sameContent(redoTrim.document!.pixels, cropOf(adjusted, kept))).toBe(true)
    expect(redoTrim.editDepth).toBe(2)
    // Undo and Redo once more: still exact.
    expect(sameContent(run(run(redoTrim, 'undo'), 'undo').document!.pixels, original)).toBe(true)
  })
})
