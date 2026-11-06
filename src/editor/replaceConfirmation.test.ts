import { describe, expect, it } from 'vitest'
import type { ImportRequest } from '../image/import/importImage'
import { createReplaceConfirmation } from './replaceConfirmation'

const request = (name: string, source: ImportRequest['source'] = 'file-picker'): ImportRequest => ({ blob: new Blob(['x']), name, source })

function setUp(needed = true) {
  const confirmation = createReplaceConfirmation()
  confirmation.setNeeded(() => needed)
  let notified = 0
  const unsubscribe = confirmation.subscribe(() => notified++)
  return { confirmation, notified: () => notified, unsubscribe }
}

describe('createReplaceConfirmation', () => {
  it('allows at once, asking nothing, when the open image has no unexported edits', () => {
    const { confirmation, notified } = setUp(false)
    expect(confirmation.confirmReplace(request('a.png'))).toBe(true)
    expect(confirmation.question()).toBeNull()
    expect(notified()).toBe(0)
  })

  it('reads the check when the import is about to start, not before', () => {
    const confirmation = createReplaceConfirmation()
    expect(confirmation.confirmReplace(request('a.png'))).toBe(true)
    let edited = false
    confirmation.setNeeded(() => edited)
    expect(confirmation.confirmReplace(request('b.png'))).toBe(true)
    edited = true
    expect(confirmation.confirmReplace(request('c.png'))).toBeInstanceOf(Promise)
  })

  it('asks about the incoming image, and Continue resolves true', async () => {
    const { confirmation, notified } = setUp()
    const answer = confirmation.confirmReplace(request('photo.png', 'drop'))
    expect(answer).toBeInstanceOf(Promise)
    expect(confirmation.question()).toEqual({ name: 'photo.png', source: 'drop' })
    expect(notified()).toBe(1)
    confirmation.answer(true)
    await expect(answer).resolves.toBe(true)
    expect(confirmation.question()).toBeNull()
    expect(notified()).toBe(2)
  })

  it('Cancel resolves false', async () => {
    const { confirmation } = setUp()
    const answer = confirmation.confirmReplace(request('pasted.png', 'paste'))
    confirmation.answer(false)
    await expect(answer).resolves.toBe(false)
  })

  it('never asks two questions at once: an image arriving meanwhile is not opened', async () => {
    const { confirmation, notified } = setUp()
    const first = confirmation.confirmReplace(request('first.png'))
    const question = confirmation.question()
    expect(confirmation.confirmReplace(request('second.png', 'paste'))).toBe(false)
    expect(confirmation.question()).toBe(question)
    expect(notified()).toBe(1)
    confirmation.answer(true)
    await expect(first).resolves.toBe(true)
    // Once answered, the next image may ask again.
    expect(confirmation.confirmReplace(request('third.png'))).toBeInstanceOf(Promise)
  })

  it('keeps the same question object until it is answered, and ignores answers without one', () => {
    const { confirmation, notified } = setUp()
    confirmation.answer(true)
    expect(notified()).toBe(0)
    void confirmation.confirmReplace(request('a.png'))
    expect(confirmation.question()).toBe(confirmation.question())
  })

  it('stops notifying after unsubscribing', () => {
    const { confirmation, notified, unsubscribe } = setUp()
    unsubscribe()
    void confirmation.confirmReplace(request('a.png'))
    expect(notified()).toBe(0)
  })
})
