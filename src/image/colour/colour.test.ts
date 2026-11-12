import { describe, expect, it } from 'vitest'
import { createPixelBuffer } from '../pixelBuffer'
import {
  type Rgba,
  cssColour,
  formatAlphaPercent,
  formatHex,
  formatRgba,
  hsvToRgb,
  isRgba,
  parseHex,
  rgbToHsv,
  sameColour,
  sampleColour,
} from './colour'

/* Colour values for the Eyedropper and the colour picker (Phase 4). */

const rgba = (r: number, g: number, b: number, a: number): Rgba => ({ r, g, b, a })

describe('sampleColour', () => {
  const data = new Uint8ClampedArray(3 * 2 * 4)
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + 11) % 256
  const pixels = createPixelBuffer(3, 2, data)

  it('reads the exact four values of every pixel, hidden colour under alpha 0 included', () => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        const i = (y * 3 + x) * 4
        expect(sampleColour(pixels, { x, y })).toEqual(rgba(data[i], data[i + 1], data[i + 2], data[i + 3]))
      }
    }
    const hidden = createPixelBuffer(1, 1, new Uint8ClampedArray([12, 200, 99, 0]))
    expect(sampleColour(hidden, { x: 0, y: 0 })).toEqual(rgba(12, 200, 99, 0))
  })

  it('never changes the image', () => {
    const before = data.slice()
    sampleColour(pixels, { x: 2, y: 1 })
    expect(pixels.data).toEqual(before)
  })

  it('refuses pixels outside the image', () => {
    for (const pixel of [{ x: -1, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 2 }, { x: 0.5, y: 0 }, { x: Number.NaN, y: 0 }]) {
      expect(() => sampleColour(pixels, pixel)).toThrow(RangeError)
    }
  })
})

describe('formatHex, formatRgba, formatAlphaPercent', () => {
  it('writes #RRGGBB for opaque colours and #RRGGBBAA otherwise, upper case', () => {
    expect(formatHex(rgba(26, 43, 60, 255))).toBe('#1A2B3C')
    expect(formatHex(rgba(0, 0, 0, 128))).toBe('#00000080')
    expect(formatHex(rgba(255, 255, 255, 0))).toBe('#FFFFFF00')
    expect(formatRgba(rgba(26, 43, 60, 7))).toBe('26, 43, 60, 7')
    expect(formatAlphaPercent(255)).toBe('100%')
    expect(formatAlphaPercent(128)).toBe('50%')
    expect(formatAlphaPercent(1)).toBe('0%')
    expect(formatAlphaPercent(0)).toBe('0%')
  })

  // Phase 4 audit, L4: a percentage of 255 (opaque), not of 256, at every rounding boundary.
  it('gives every one of the 256 alpha values as the nearest whole percentage of 255', () => {
    for (let alpha = 0; alpha <= 255; alpha++) {
      // Integer arithmetic only: round(100 × alpha / 255) = floor((40 × alpha + 51) / 102). There is
      // never an exact half to round (100 × alpha / 255 = 20 × alpha / 51 has no .5 for whole alpha).
      const expected = Math.floor((40 * alpha + 51) / 102)
      expect(formatAlphaPercent(alpha), `alpha ${alpha}`).toBe(`${expected}%`)
    }
  })

  it('rounds at the boundaries where a percentage of 256 would differ', () => {
    // Each of these is one percent higher than 100 × alpha / 256 would round to.
    const cases: [number, string][] = [
      [37, '15%'], [55, '22%'], [101, '40%'], [124, '49%'], [129, '51%'], [247, '97%'], [252, '99%'], [254, '100%'],
    ]
    for (const [alpha, text] of cases) expect(formatAlphaPercent(alpha), `alpha ${alpha}`).toBe(text)
    // And either side of the first and last whole steps.
    expect(formatAlphaPercent(2)).toBe('1%')
    expect(formatAlphaPercent(252)).toBe('99%')
    expect(formatAlphaPercent(253)).toBe('99%')
  })

  it('never decreases, covers 0% to 100%, and reaches 100% only near opaque', () => {
    const values = Array.from({ length: 256 }, (_, alpha) => Number.parseInt(formatAlphaPercent(alpha)))
    for (let alpha = 1; alpha < 256; alpha++) expect(values[alpha]).toBeGreaterThanOrEqual(values[alpha - 1])
    expect(values[0]).toBe(0)
    expect(values[255]).toBe(100)
    expect(values.indexOf(100)).toBe(254)
  })
})

describe('parseHex', () => {
  it('reads the four hex forms, with or without #, in either case, spaces ignored', () => {
    expect(parseHex('#1A2B3C')).toEqual(rgba(26, 43, 60, 255))
    expect(parseHex('1a2b3c')).toEqual(rgba(26, 43, 60, 255))
    expect(parseHex(' #1a2b3c80 ')).toEqual(rgba(26, 43, 60, 128))
    expect(parseHex('#abc')).toEqual(rgba(0xaa, 0xbb, 0xcc, 255))
    expect(parseHex('#abc8')).toEqual(rgba(0xaa, 0xbb, 0xcc, 0x88))
  })

  it('rejects everything else', () => {
    for (const text of ['', '#', '#12', '#12345', '#1234567', '#123456789', '#GGGGGG', 'red', 'rgb(1,2,3)', '##123456', '# 123456']) {
      expect(parseHex(text)).toBeNull()
    }
  })

  it('round-trips with formatHex for every alpha and many colours', () => {
    for (let a = 0; a < 256; a++) {
      const colour = rgba((a * 7) % 256, (a * 13) % 256, (a * 29) % 256, a)
      expect(parseHex(formatHex(colour))).toEqual(colour)
    }
  })
})

describe('rgbToHsv and hsvToRgb', () => {
  it('converts the primaries, greys and black', () => {
    expect(rgbToHsv(rgba(255, 0, 0, 255))).toEqual({ h: 0, s: 1, v: 1 })
    expect(rgbToHsv(rgba(0, 255, 0, 255))).toEqual({ h: 120, s: 1, v: 1 })
    expect(rgbToHsv(rgba(0, 0, 255, 255))).toEqual({ h: 240, s: 1, v: 1 })
    expect(hsvToRgb({ h: 60, s: 1, v: 1 })).toEqual(rgba(255, 255, 0, 255))
    expect(hsvToRgb({ h: 300, s: 1, v: 1 }, 7)).toEqual(rgba(255, 0, 255, 7))
  })

  it('keeps the given hue for greys and black, whose hue is undefined', () => {
    expect(rgbToHsv(rgba(128, 128, 128, 255), 200)).toEqual({ h: 200, s: 0, v: 128 / 255 })
    expect(rgbToHsv(rgba(0, 0, 0, 255), 33)).toEqual({ h: 33, s: 0, v: 0 })
  })

  it('round-trips every 8-bit colour on a 4-step grid exactly', () => {
    let checked = 0
    for (let r = 0; r < 256; r += 3) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 7) {
          const colour = rgba(r, g, b, 255)
          const back = hsvToRgb(rgbToHsv(colour))
          if (!sameColour(back, colour)) throw new Error(`${formatRgba(colour)} came back as ${formatRgba(back)}`)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(50_000)
  })

  it('wraps hue, clamps saturation and value, and rounds and clamps alpha', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual(rgba(255, 0, 0, 255))
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual(rgba(0, 0, 255, 255))
    expect(hsvToRgb({ h: 0, s: 2, v: -1 })).toEqual(rgba(0, 0, 0, 255))
    expect(hsvToRgb({ h: 0, s: 0, v: 1 }, 300).a).toBe(255)
    expect(hsvToRgb({ h: 0, s: 0, v: 1 }, 12.6).a).toBe(13)
  })
})

describe('isRgba, sameColour, cssColour', () => {
  it('accepts only four whole numbers from 0 to 255', () => {
    expect(isRgba(rgba(0, 255, 7, 128))).toBe(true)
    for (const bad of [rgba(256, 0, 0, 0), rgba(-1, 0, 0, 0), rgba(1.5, 0, 0, 0), rgba(0, 0, 0, Number.NaN)]) expect(isRgba(bad)).toBe(false)
  })

  it('compares by value', () => {
    expect(sameColour(rgba(1, 2, 3, 4), rgba(1, 2, 3, 4))).toBe(true)
    expect(sameColour(rgba(1, 2, 3, 4), rgba(1, 2, 3, 5))).toBe(false)
    expect(sameColour(null, null)).toBe(true)
  })

  it('writes CSS with the alpha as a fraction', () => {
    expect(cssColour(rgba(26, 43, 60, 255))).toBe('rgb(26 43 60 / 1.0000)')
    expect(cssColour(rgba(26, 43, 60, 0))).toBe('rgb(26 43 60 / 0.0000)')
  })
})
