import { describe, expect, it } from 'vitest'
import { editErrorMessage, editName, editNoticeText, isShownEditNotice } from './editFeedback'

describe('editNoticeText', () => {
  it('announces a Delete with the number of pixels made transparent', () => {
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 1 })).toBe('Selection deleted: 1 pixel is now transparent.')
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 2 })).toBe('Selection deleted: 2 pixels are now transparent.')
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 1234567 })).toBe(
      'Selection deleted: 1,234,567 pixels are now transparent.',
    )
  })

  it('adds the edge pixels changed by edge cleanup and feathering, when there were any', () => {
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 31428, edgePixels: 1204 })).toBe(
      'Selection deleted: 31,428 pixels are now transparent. 1,204 edge pixels were cleaned up or feathered.',
    )
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 2, edgePixels: 1 })).toBe(
      'Selection deleted: 2 pixels are now transparent. 1 edge pixel was cleaned up or feathered.',
    )
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 2, edgePixels: 0 })).toBe('Selection deleted: 2 pixels are now transparent.')
  })

  it('announces edits without a count, Undo and Redo by name', () => {
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: null })).toBe('Delete Selection applied.')
    expect(editNoticeText({ kind: 'applied', operation: 'auto-trim', changedPixels: null })).toBe('Auto Trim applied.')
    expect(editNoticeText({ kind: 'undone', operation: 'delete-selection' })).toBe('Undone: Delete Selection.')
    expect(editNoticeText({ kind: 'redone', operation: 'auto-trim' })).toBe('Redone: Auto Trim.')
  })

  it('says so when nothing was deleted, never announcing success', () => {
    const text = editNoticeText({ kind: 'unchanged', operation: 'delete-selection' })
    expect(text).toBe('Nothing was deleted: the selected pixels are already transparent.')
    expect(editNoticeText({ kind: 'unchanged', operation: 'auto-trim' })).toBe('Auto Trim changed nothing.')
  })
})

describe('Auto Trim outcomes (Phase 3 Step 11)', () => {
  const resized = { from: { width: 1920, height: 1080 }, to: { width: 642, height: 410 } }

  it('announces a trim with the size before and after', () => {
    expect(editNoticeText({ kind: 'applied', operation: 'auto-trim', changedPixels: null, resized })).toBe(
      'Auto Trim applied: 1,920 × 1,080 px trimmed to 642 × 410 px.',
    )
  })

  it('adds the older Undo steps the trim pushed out of the history', () => {
    expect(editNoticeText({ kind: 'applied', operation: 'auto-trim', changedPixels: null, resized, droppedUndoSteps: 1 })).toBe(
      'Auto Trim applied: 1,920 × 1,080 px trimmed to 642 × 410 px. Undo history is full, so the oldest Undo step is no longer available.',
    )
    expect(editNoticeText({ kind: 'applied', operation: 'auto-trim', changedPixels: null, resized, droppedUndoSteps: 12 })).toBe(
      'Auto Trim applied: 1,920 × 1,080 px trimmed to 642 × 410 px. Undo history is full, so the 12 oldest Undo steps are no longer available.',
    )
  })

  it('says why nothing was trimmed', () => {
    expect(editNoticeText({ kind: 'unchanged', operation: 'auto-trim', trim: { kind: 'nothing-visible' } })).toBe(
      'Nothing to trim: the image has no visible pixels.',
    )
    expect(editNoticeText({ kind: 'unchanged', operation: 'auto-trim', trim: { kind: 'no-border', padding: 0 } })).toBe(
      'Nothing to trim: visible pixels already reach every edge of the image.',
    )
    expect(editNoticeText({ kind: 'unchanged', operation: 'auto-trim', trim: { kind: 'no-border', padding: 5 } })).toBe(
      'Nothing to trim: no side has more than 5 px of transparent space.',
    )
  })

  it('shows only nothing-to-trim and dropped Undo steps as messages; everything else is announced only', () => {
    expect(isShownEditNotice({ kind: 'unchanged', operation: 'auto-trim', trim: { kind: 'nothing-visible' } })).toBe(true)
    expect(isShownEditNotice({ kind: 'unchanged', operation: 'auto-trim', trim: { kind: 'no-border', padding: 5 } })).toBe(true)
    expect(isShownEditNotice({ kind: 'applied', operation: 'auto-trim', changedPixels: null, resized, droppedUndoSteps: 2 })).toBe(true)
    expect(isShownEditNotice({ kind: 'applied', operation: 'auto-trim', changedPixels: null, resized })).toBe(false)
    expect(isShownEditNotice({ kind: 'undone', operation: 'auto-trim' })).toBe(false)
    expect(isShownEditNotice({ kind: 'redone', operation: 'auto-trim' })).toBe(false)
    // Delete is unchanged (Phase 3 Step 6): announced only, even when it drops Undo steps.
    expect(isShownEditNotice({ kind: 'unchanged', operation: 'delete-selection' })).toBe(false)
    expect(isShownEditNotice({ kind: 'applied', operation: 'delete-selection', changedPixels: 3, droppedUndoSteps: 2 })).toBe(false)
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 3, droppedUndoSteps: 2 })).toBe(
      'Selection deleted: 3 pixels are now transparent.',
    )
  })
})

describe('editErrorMessage', () => {
  it('names what failed and says nothing changed', () => {
    expect(editErrorMessage({ operation: 'delete-selection' })).toBe('The selected pixels could not be deleted. The image and selection have not changed.')
    expect(editErrorMessage({ operation: 'undo' })).toBe('Undo could not be completed. The image and selection have not changed.')
    expect(editErrorMessage({ operation: 'redo', detail: 'Error: Damaged history entry' })).toBe(
      'Redo could not be completed. The image and selection have not changed.',
    )
    expect(editErrorMessage({ operation: 'auto-trim' })).toBe('Auto Trim could not be completed. The image and selection have not changed.')
  })

  it('suggests memory when the browser could not allocate the image', () => {
    for (const detail of [
      'RangeError: Array buffer allocation failed',
      'InternalError: out of memory',
      'RangeError: allocation size overflow',
      'RangeError: Invalid typed array length: 200000000',
      'RangeError: Invalid array length',
      'Error: Created a 0 × 0 bitmap for 8660 × 5773 pixels',
      'Error: Created a 0 × 0 canvas for 8660 × 5773 pixels',
      'Error: No 2D canvas is available to display the image',
      'UnknownError: Test failure: out of memory',
    ]) {
      expect(editErrorMessage({ operation: 'delete-selection', detail })).toBe(
        'The selected pixels could not be deleted. The image and selection have not changed. There may not be enough memory for an image this large.',
      )
    }
  })

  it('never shows the developer detail', () => {
    expect(editErrorMessage({ operation: 'undo', detail: 'RangeError: secret internals' })).not.toContain('secret')
  })
})

describe('editName', () => {
  it('names edits as the controls do', () => {
    expect(editName('delete-selection')).toBe('Delete Selection')
    expect(editName('auto-trim')).toBe('Auto Trim')
  })
})
