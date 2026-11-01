/*
 * Classifying event targets, so keyboard, paste and drop handling never take over
 * input meant for a control or a text field.
 */

/** Elements where typing, pasting and dropping text have their own meaning (inputs are checked by type). */
const EDITABLE_SELECTOR = 'textarea, select, [contenteditable]:not([contenteditable="false"])'

/**
 * Input types without text entry. A slider, checkbox or button keeps the editor's
 * shortcuts (Ctrl + A, Escape) and image paste working while it has focus.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** Elements where Space has its own meaning (pressing, typing, toggling). */
const INTERACTIVE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'a[href]',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(',')

/** The parts of an Element read here, so tests can provide plain objects. */
interface ElementLike {
  closest(selector: string): unknown
  readonly isContentEditable?: boolean
}

function isElementLike(target: unknown): target is ElementLike {
  return typeof target === 'object' && target !== null && typeof (target as Partial<ElementLike>).closest === 'function'
}

/** A text field or editable content: pastes and drops there belong to it. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElementLike(target)) return false
  if (target.isContentEditable === true || target.closest(EDITABLE_SELECTOR) !== null) return true
  const input = target.closest('input') as { type?: unknown } | null
  return input !== null && !(typeof input.type === 'string' && NON_TEXT_INPUT_TYPES.has(input.type.toLowerCase()))
}

/** A control (or text field) that handles Space itself. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return isElementLike(target) && target.closest(INTERACTIVE_SELECTOR) !== null
}
