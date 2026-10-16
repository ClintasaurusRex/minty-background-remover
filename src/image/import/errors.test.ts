import { describe, expect, it } from 'vitest'
import {
  IMPORT_ERROR_CODES,
  IMPORT_ERROR_MESSAGES,
  ImportFailure,
  createImportError,
  toImportError,
} from './errors'

describe('import errors', () => {
  it('has a distinct, non-empty message for every code', () => {
    const messages = IMPORT_ERROR_CODES.map((code) => IMPORT_ERROR_MESSAGES[code])
    for (const message of messages) {
      expect(message.trim()).not.toBe('')
      expect(message).toMatch(/\.$/)
    }
    expect(new Set(messages).size).toBe(messages.length)
    expect(Object.keys(IMPORT_ERROR_MESSAGES).sort()).toEqual([...IMPORT_ERROR_CODES].sort())
  })

  it('covers every import failure the workspace must report', () => {
    expect(IMPORT_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'unsupported-format',
        'file-too-large',
        'dimensions-too-large',
        'decode-failed',
        'svg-size-unknown',
        'svg-unsupported-content',
        'svg-render-blocked',
        'display-failed',
        'no-image-in-clipboard',
        'read-failed',
      ]),
    )
  })

  it('quotes the approved limits in the size messages', () => {
    expect(IMPORT_ERROR_MESSAGES['file-too-large']).toContain('50 MB')
    expect(IMPORT_ERROR_MESSAGES['dimensions-too-large']).toContain('16,384')
    expect(IMPORT_ERROR_MESSAGES['dimensions-too-large']).toContain('50 megapixels')
  })

  it('creates errors with the user message and optional developer detail', () => {
    expect(createImportError('decode-failed')).toEqual({
      code: 'decode-failed',
      message: IMPORT_ERROR_MESSAGES['decode-failed'],
    })
    expect(createImportError('read-failed', 'NotReadableError')).toEqual({
      code: 'read-failed',
      message: IMPORT_ERROR_MESSAGES['read-failed'],
      detail: 'NotReadableError',
    })
  })

  it('keeps developer detail out of the user message', () => {
    const error = createImportError('unsupported-format', 'Unrecognised signature: 47 49 46')
    expect(error.message).not.toContain('47 49 46')
  })
})

describe('ImportFailure / toImportError', () => {
  it('carries a specific import error through a throw', () => {
    const error = createImportError('svg-render-blocked', 'SecurityError')
    const failure = new ImportFailure(error)
    expect(failure).toBeInstanceOf(Error)
    expect(toImportError(failure, 'decode-failed')).toBe(error)
  })

  it('maps other thrown values to the fallback code with the cause as detail', () => {
    expect(toImportError(new TypeError('bad input'), 'decode-failed')).toEqual(
      createImportError('decode-failed', 'TypeError: bad input'),
    )
    expect(toImportError('oops', 'read-failed')).toEqual(createImportError('read-failed', 'oops'))
  })
})
