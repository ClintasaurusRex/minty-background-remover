import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { applyCropTitle } from '../../editor/cropCommands'
import type { Rectangle, Size } from '../../editor/types'
import { CropOptions } from './CropOptions'

/*
 * Markup checks for the Crop options row (Phase 4). Interaction is checked in real browsers
 * (scripts/browser/crop.mjs).
 */

const noop = () => {}
const SIZE: Size = { width: 640, height: 480 }

function render(cropRect: Rectangle | null, canApplyCrop: boolean, imageSize: Size | null = SIZE) {
  return renderToStaticMarkup(
    createElement(CropOptions, { cropRect, imageSize, canApplyCrop, onCropFieldChange: noop, onApplyCrop: noop, onCancelCrop: noop }),
  )
}

function buttonTag(markup: string, label: string): string {
  const button = markup.split('<button').find((part) => part.includes(`</svg>${label}</button>`))
  if (!button) throw new Error(`No button labelled ${label}`)
  return `<button${button.slice(0, button.indexOf('>') + 1)}`
}

const fieldValues = (markup: string) =>
  [...markup.matchAll(/<input[^>]*>/g)].map(([tag]) => [/aria-label="([^"]+)"/.exec(tag)![1], /value="(\d+)"/.exec(tag)![1]])

describe('CropOptions', () => {
  it('shows the rectangle in four labelled fields whose names give their ranges, then Apply Crop and Cancel', () => {
    const markup = render({ x: 10, y: 20, width: 300, height: 200 }, true)
    expect(markup).toMatch(/^<div class="tool-options" role="group" aria-label="Crop options">/)
    expect(fieldValues(markup)).toEqual([
      ['Crop left edge X in pixels, 0 to 340', '10'],
      ['Crop top edge Y in pixels, 0 to 280', '20'],
      ['Crop width in pixels, 1 to 630', '300'],
      ['Crop height in pixels, 1 to 460', '200'],
    ])
    expect(markup).toContain('inputMode="numeric"')
    expect(buttonTag(markup, 'Apply Crop')).toContain('aria-disabled="false"')
    expect(buttonTag(markup, 'Apply Crop')).toContain('title="Crop the image to 300 × 200 px (Enter)"')
    expect(buttonTag(markup, 'Cancel')).toContain('aria-disabled="false"')
    expect(buttonTag(markup, 'Cancel')).toContain('(Esc)')
    expect(markup).not.toContain('Drag on the image')
  })

  it('without a rectangle shows the whole image, a hint, and both buttons unavailable but focusable', () => {
    const markup = render(null, false)
    expect(fieldValues(markup).map(([, value]) => value)).toEqual(['0', '0', '640', '480'])
    expect(markup).toContain('Drag on the image to choose the area to keep')
    expect(buttonTag(markup, 'Apply Crop')).toContain('aria-disabled="true"')
    expect(buttonTag(markup, 'Cancel')).toContain('aria-disabled="true"')
    expect(markup).not.toContain('disabled=""')
  })

  it('shows nothing without an image', () => {
    expect(render(null, false, null)).toBe('')
  })
})

describe('applyCropTitle', () => {
  it('says what Apply Crop does, or why it cannot run', () => {
    expect(applyCropTitle(null, SIZE, false)).toBe('Apply Crop — drag on the image to choose the area to keep first')
    expect(applyCropTitle({ x: 0, y: 0, width: 640, height: 480 }, SIZE, false)).toBe('Apply Crop — the rectangle keeps the whole image')
    expect(applyCropTitle({ x: 1, y: 0, width: 5, height: 4 }, SIZE, true)).toBe('Crop the image to 5 × 4 px (Enter)')
    expect(applyCropTitle({ x: 1, y: 0, width: 5, height: 4 }, SIZE, false)).toBe(
      'Crop the image to 5 × 4 px (Enter) — not available while another image is opening',
    )
  })
})
