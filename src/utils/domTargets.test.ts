import { describe, expect, it } from 'vitest'
import { isEditableTarget, isInteractiveTarget } from './domTargets'

/** A fake element whose closest() matches only the given selector fragments. */
function element(matching: string[], isContentEditable = false): EventTarget {
  const fake = {
    closest: (selector: string) => (matching.some((part) => selector.split(',').map((s) => s.trim()).includes(part)) ? {} : null),
    isContentEditable,
  }
  return fake as unknown as EventTarget
}

describe('isEditableTarget', () => {
  it('recognises inputs, text areas, selects and editable content', () => {
    for (const tag of ['input', 'textarea', 'select']) expect(isEditableTarget(element([tag]))).toBe(true)
    expect(isEditableTarget(element([], true))).toBe(true)
  })

  it('treats buttons, the workspace and non-elements as not editable', () => {
    expect(isEditableTarget(element(['button']))).toBe(false)
    expect(isEditableTarget(element([]))).toBe(false)
    expect(isEditableTarget(new EventTarget())).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('isInteractiveTarget', () => {
  it('recognises controls that handle Space themselves', () => {
    for (const part of ['button', 'input', 'a[href]', '[role="button"]', '[role="slider"]']) {
      expect(isInteractiveTarget(element([part]))).toBe(true)
    }
  })

  it('treats the workspace and non-elements as not interactive', () => {
    expect(isInteractiveTarget(element([]))).toBe(false)
    expect(isInteractiveTarget(null)).toBe(false)
  })
})
