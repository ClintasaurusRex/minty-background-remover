import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { planFrame } from '../canvas/rendering'
import { EyedropperOptions } from '../components/Toolbar/EyedropperOptions'
import { type Rgba, formatHex } from '../image/colour/colour'
import { createPixelBuffer } from '../image/pixelBuffer'
import { eyedropperClick } from './colourCommands'
import {
  DEFAULT_PICKER_COLOUR,
  describeColour,
  pickerColour,
  svAtPoint,
  svKey,
  svValueText,
  withAlpha,
  withHex,
  withHsv,
} from './colourPicker'
import { type EditorState, type WorkspaceMetrics, displayViewport, editorReducer, initialEditorState, sampledPixel } from './editorState'
import { WORKSPACE, accepted, opened, reduce, sameBytes } from './history/testFixtures'
import type { PixelBuffer, PixelCoordinate } from './types'

/*
 * The Eyedropper and the colour picker (Phase 4): sampling the pixel shown under the pointer at
 * different zooms and device pixel ratios, the chosen colour in the editor state, that nothing
 * touches the image, the picker's rules, and the Eyedropper row's markup.
 */

/** 30 × 20, every pixel different, alpha varying, hidden colour under alpha 0. */
function image(): PixelBuffer {
  const width = 30
  const height = 20
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) data.set([p % 256, (p * 3) % 256, (p * 7) % 256, p % 5 === 0 ? 0 : (p * 11) % 256], p * 4)
  return createPixelBuffer(width, height, data)
}

const at = (pixels: PixelBuffer, { x, y }: PixelCoordinate): Rgba => {
  const i = (y * pixels.width + x) * 4
  return { r: pixels.data[i], g: pixels.data[i + 1], b: pixels.data[i + 2], a: pixels.data[i + 3] }
}

const eyedropper = (state: EditorState) => reduce(state, { type: 'tool-selected', tool: 'eyedropper' })

/** The workspace point (CSS px) at fraction (fx, fy) inside image pixel (x, y). */
function inside(state: EditorState, x: number, y: number, fx = 0.5, fy = 0.5) {
  const v = displayViewport(state)!
  return { x: v.offset.x + (x + fx) * v.zoom, y: v.offset.y + (y + fy) * v.zoom }
}

describe('Eyedropper', () => {
  it('reads the exact values of the pixel clicked, everywhere in the image, without touching the image', () => {
    const pixels = image()
    const state = eyedropper(opened(pixels))
    const before = pixels.data.slice()
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 30; x++) {
        const next = accepted(state, eyedropperClick(state, inside(state, x, y)))
        expect(next.colour!.value).toEqual(at(pixels, { x, y }))
        expect(sampledPixel(next)).toEqual({ x, y })
        expect(next.document).toBe(state.document)
        expect(next.documentBitmap).toBe(state.documentBitmap)
        expect(next.history).toBe(state.history)
        expect(next.selection).toBe(state.selection)
        expect(next.editDepth).toBe(0)
      }
    }
    expect(sameBytes(state.document!.pixels, createPixelBuffer(30, 20, before))).toBe(true)
  })

  it('reads the pixel the canvas shows under the pointer, at every zoom and device pixel ratio', () => {
    const pixels = image()
    let checked = 0
    for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
      const workspace: WorkspaceMetrics = { size: { width: 400, height: 300 }, devicePixelRatio }
      const base = eyedropper(opened(pixels, reduce(initialEditorState, { type: 'workspace-resized', workspace })))
      for (const factor of [1, 1.5, 2.37, 4, 12]) {
        const state = reduce(base, { type: 'zoom-actual-size' }, { type: 'zoom-scaled', anchor: { x: 0, y: 0 }, factor })
        const v = displayViewport(state)!
        const scale = v.zoom * devicePixelRatio
        // What the canvas draws, modelled from the transform the renderer is given (not from the
        // app's mapping): the image pixel under each device pixel's centre (canvas/deviceSampling.test.ts).
        const { e, f, a } = planFrame({ imageSize: pixels, viewport: v, viewportSize: workspace.size, devicePixelRatio }).image!.transform
        const corner = { x: Math.round(v.offset.x * devicePixelRatio), y: Math.round(v.offset.y * devicePixelRatio) }
        // Every device pixel across the image's first columns and rows, at a point inside it.
        for (let D = 0; D < Math.min(60, 20 * scale); D++) {
          const point = { x: v.offset.x + (D + 0.3) / devicePixelRatio, y: v.offset.y + (D + 0.7) / devicePixelRatio }
          const action = eyedropperClick(state, point)
          const expected = { x: Math.floor((corner.x + D + 0.5 - e) / a), y: Math.floor((corner.y + D + 0.5 - f) / a) }
          // A device pixel straddling the image's bottom edge shows what lies outside it.
          if (expected.y >= 20) {
            expect(action).toBeNull()
            continue
          }
          if (!action || action.type !== 'colour-sampled') throw new Error(`No sample at device pixel ${D}`)
          expect(action.pixel).toEqual(expected)
          expect(action.colour).toEqual(at(pixels, expected))
          checked++
        }
        // Pixel centres are always read as themselves.
        for (const [x, y] of [[0, 0], [29, 19], [13, 7]]) expect((eyedropperClick(state, inside(state, x, y)) as { pixel: PixelCoordinate }).pixel).toEqual({ x, y })
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('reads nothing outside the image, with another tool, or without an image', () => {
    const state = eyedropper(opened(image()))
    const v = displayViewport(state)!
    expect(eyedropperClick(state, { x: v.offset.x - 3, y: v.offset.y + 5 })).toBeNull()
    expect(eyedropperClick(state, inside(state, 30, 5))).toBeNull()
    const wand = opened(image())
    expect(eyedropperClick(wand, inside(wand, 3, 3))).toBeNull()
    expect(eyedropperClick(initialEditorState, { x: 10, y: 10 })).toBeNull()
  })

  it('ignores stale and malformed samples, and keeps the colour across tools and images, showing where only for the content it was read from', () => {
    const state = eyedropper(opened(image()))
    const action = eyedropperClick(state, inside(state, 4, 2))!
    const sampled = accepted(state, action)
    // Another image: the colour stays, the location is no longer shown.
    const other = opened(image(), sampled)
    expect(other.colour).toBe(sampled.colour)
    expect(sampledPixel(other)).toBeNull()
    // The same action against the new image is stale.
    const otherEyedropper = eyedropper(other)
    expect(editorReducer(otherEyedropper, action)).toBe(otherEyedropper)
    // With another tool active the sample is ignored.
    expect(editorReducer(reduce(state, { type: 'tool-selected', tool: 'magic-wand' }), action).colour).toBeNull()
    for (const colour of [{ r: 256, g: 0, b: 0, a: 0 }, { r: 1.5, g: 0, b: 0, a: 0 }]) {
      expect(editorReducer(state, { ...action, colour } as typeof action)).toBe(state)
    }
    expect(editorReducer(state, { ...action, pixel: { x: 30, y: 0 } } as typeof action)).toBe(state)
    expect(reduce(sampled, { type: 'tool-selected', tool: 'crop' }).colour).toBe(sampled.colour)
  })

  it('takes a colour from the picker, with no location, and refuses invalid ones', () => {
    const state = opened(image(), reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE }))
    const chosen = reduce(state, { type: 'colour-chosen', colour: { r: 1, g: 2, b: 3, a: 4 } })
    expect(chosen.colour).toEqual({ value: { r: 1, g: 2, b: 3, a: 4 }, sample: null, readings: 0 })
    expect(sampledPixel(chosen)).toBeNull()
    expect(chosen.document).toBe(state.document)
    expect(reduce(chosen, { type: 'colour-chosen', colour: { r: -1, g: 2, b: 3, a: 4 } })).toBe(chosen)
  })
})

describe('Eyedropper readings (each one announced, Phase 4 audit L3)', () => {
  it('numbers every reading, the same pixel read again included', () => {
    let state = eyedropper(opened(image()))
    const numbers = []
    for (const [x, y] of [[4, 2], [4, 2], [4, 2], [9, 9], [4, 2]]) {
      state = accepted(state, eyedropperClick(state, inside(state, x, y)))
      numbers.push(state.colour!.readings)
    }
    expect(numbers).toEqual([1, 2, 3, 4, 5])
  })

  it('changes the number for nothing but a reading', () => {
    const state = eyedropper(opened(image()))
    const read = accepted(state, eyedropperClick(state, inside(state, 4, 2)))
    const before = read.colour!.readings
    const after = reduce(
      read,
      { type: 'zoom-scaled', anchor: { x: 10, y: 10 }, factor: 2 },
      { type: 'wheel-panned', delta: { x: 5, y: 3 } },
      { type: 'tool-selected', tool: 'magic-wand' },
      { type: 'tool-selected', tool: 'eyedropper' },
      { type: 'workspace-resized', workspace: { size: { width: 500, height: 400 }, devicePixelRatio: 1 } },
    )
    expect(after.colour).toBe(read.colour)
    // The picker's Apply keeps the count; the next reading continues it.
    const chosen = reduce(after, { type: 'colour-chosen', colour: { r: 1, g: 2, b: 3, a: 4 } })
    expect(chosen.colour!.readings).toBe(before)
    expect(accepted(chosen, eyedropperClick(chosen, inside(chosen, 4, 2))).colour!.readings).toBe(before + 1)
  })
})

describe('colour picker rules', () => {
  const colour: Rgba = { r: 26, g: 43, b: 60, a: 128 }

  it('keeps the colour it opens with exactly until something changes it', () => {
    expect(pickerColour(colour).rgba).toBe(colour)
    expect(DEFAULT_PICKER_COLOUR).toEqual({ r: 255, g: 255, b: 255, a: 255 })
  })

  it('sets the colour from the area and hue, keeping alpha; the hue survives greys and black', () => {
    const start = pickerColour(colour)
    const red = withHsv(start, { h: 0, s: 1, v: 1 })
    expect(red.rgba).toEqual({ r: 255, g: 0, b: 0, a: 128 })
    const grey = withHsv(withHsv(start, { h: 200, s: 1, v: 1 }), { h: 200, s: 0, v: 0.5 })
    expect(grey.hsv.h).toBe(200)
    expect(grey.rgba).toEqual({ r: 128, g: 128, b: 128, a: 128 })
    expect(withHsv(start, { h: 400, s: 2, v: -1 }).hsv).toEqual({ h: 40, s: 1, v: 0 })
  })

  it('changes only alpha with the alpha slider, rounded and clamped', () => {
    const start = pickerColour(colour)
    expect(withAlpha(start, 255).rgba).toEqual({ ...colour, a: 255 })
    expect(withAlpha(start, 300.4).rgba.a).toBe(255)
    expect(withAlpha(start, -2).rgba.a).toBe(0)
    expect(withAlpha(start, Number.NaN)).toBe(start)
    expect(withAlpha(start, 7).hsv).toBe(start.hsv)
  })

  it('takes typed hex exactly, alpha included, and refuses other text', () => {
    const start = pickerColour(colour)
    expect(withHex(start, '#FF000080')!.rgba).toEqual({ r: 255, g: 0, b: 0, a: 128 })
    expect(withHex(start, 'abc')!.rgba).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 })
    expect(withHex(start, '#zz')).toBeNull()
    // A grey keeps the hue shown.
    expect(withHex(withHsv(start, { h: 150, s: 1, v: 1 }), '#808080')!.hsv.h).toBe(150)
  })

  it('maps pointer positions in the area to saturation and brightness, clamped at its edges', () => {
    const size = { width: 200, height: 100 }
    expect(svAtPoint({ x: 0, y: 0 }, size)).toEqual({ s: 0, v: 1 })
    expect(svAtPoint({ x: 200, y: 100 }, size)).toEqual({ s: 1, v: 0 })
    expect(svAtPoint({ x: 50, y: 25 }, size)).toEqual({ s: 0.25, v: 0.75 })
    expect(svAtPoint({ x: -50, y: 500 }, size)).toEqual({ s: 0, v: 0 })
    expect(svAtPoint({ x: 10, y: 10 }, { width: 0, height: 0 })).toEqual({ s: 0, v: 0 })
  })

  it('steps the area with arrow keys (Shift for 10%), Page keys and Home / End', () => {
    const hsv = { h: 10, s: 0.5, v: 0.5 }
    expect(svKey(hsv, 'ArrowRight', false)).toEqual({ h: 10, s: 0.51, v: 0.5 })
    expect(svKey(hsv, 'ArrowLeft', true)).toEqual({ h: 10, s: 0.4, v: 0.5 })
    expect(svKey(hsv, 'ArrowUp', false)).toEqual({ h: 10, s: 0.5, v: 0.51 })
    expect(svKey(hsv, 'ArrowDown', true)).toEqual({ h: 10, s: 0.5, v: 0.4 })
    expect(svKey(hsv, 'PageUp', false)).toEqual({ h: 10, s: 0.5, v: 0.6 })
    expect(svKey(hsv, 'Home', false)).toEqual({ h: 10, s: 0, v: 0.5 })
    expect(svKey(hsv, 'End', false)).toEqual({ h: 10, s: 1, v: 0.5 })
    expect(svKey({ h: 0, s: 1, v: 0 }, 'ArrowRight', true)).toEqual({ h: 0, s: 1, v: 0 })
    expect(svKey(hsv, 'Enter', false)).toBeNull()
    expect(svValueText({ h: 0, s: 0.404, v: 0.8 })).toBe('Saturation 40%, brightness 80%')
    expect(describeColour(colour)).toBe('#1A2B3C80, alpha 50%')
  })
})

describe('EyedropperOptions markup', () => {
  const render = (props: Parameters<typeof EyedropperOptions>[0]) => renderToStaticMarkup(createElement(EyedropperOptions, props))
  const noop = () => {}

  it('shows a hint and an empty swatch before any colour', () => {
    const markup = render({ colour: null, sampledPixel: null, onChooseColour: noop })
    expect(markup).toContain('aria-label="Eyedropper options"')
    expect(markup).toContain('Click the image to read a pixel’s colour')
    expect(markup).toContain('aria-label="Choose a colour in the colour picker"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('tool-options__swatch-empty')
  })

  it('shows hex, RGBA, alpha and where it was read, and announces the reading', () => {
    const value = { r: 26, g: 43, b: 60, a: 128 }
    const markup = render({ colour: { value, sample: { version: { documentId: 1, revision: 0 }, pixel: { x: 4, y: 2 } }, readings: 1 }, sampledPixel: { x: 4, y: 2 }, onChooseColour: noop })
    expect(markup).toContain(`>${formatHex(value)}</output>`)
    expect(markup).toContain('>RGBA 26, 43, 60, 128</output>')
    expect(markup).toContain('>Alpha 50%</output>')
    expect(markup).toContain('from pixel 4, 2')
    expect(markup).toContain('role="status"><span>Colour read from pixel 4, 2: #1A2B3C80, alpha 50%.</span>')
    expect(markup).toContain('aria-label="Edit colour #1A2B3C80, alpha 50% in the colour picker"')
  })

  it('shows a picked colour without a location or an announcement', () => {
    const markup = render({ colour: { value: { r: 255, g: 0, b: 0, a: 255 }, sample: null, readings: 0 }, sampledPixel: null, onChooseColour: noop })
    expect(markup).toContain('#FF0000')
    expect(markup).not.toContain('from ')
    expect(markup).toContain('role="status"></div>')
  })
})
