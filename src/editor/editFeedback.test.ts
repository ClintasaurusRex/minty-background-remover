import { describe, expect, it } from 'vitest'
import { editErrorMessage, editName, editNoticeText } from './editFeedback'

describe('editNoticeText', () => {
  it('announces a Delete with the number of pixels made transparent', () => {
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 1 })).toBe('Selection deleted: 1 pixel is now transparent.')
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 2 })).toBe('Selection deleted: 2 pixels are now transparent.')
    expect(editNoticeText({ kind: 'applied', operation: 'delete-selection', changedPixels: 1234567 })).toBe(
      'Selection deleted: 1,234,567 pixels are now transparent.',
    )
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
