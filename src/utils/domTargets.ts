/*
 * Classifying event targets, so keyboard, paste and drop handling never take over
 * input meant for a control or a text field.
 */

/** Elements where typing, pasting and dropping text have their own meaning. */
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

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
  return target.isContentEditable === true || target.closest(EDITABLE_SELECTOR) !== null
}

/** A control (or text field) that handles Space itself. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return isElementLike(target) && target.closest(INTERACTIVE_SELECTOR) !== null
}
