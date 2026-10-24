import { describe, expect, it } from 'vitest'
import { parseSvgLength, parseViewBoxSize, resolveSvgSize } from './svgSize'

describe('parseSvgLength', () => {
  it('parses unitless and px lengths', () => {
    expect(parseSvgLength('100')).toBe(100)
    expect(parseSvgLength('100px')).toBe(100)
    expect(parseSvgLength(' 24.5px ')).toBe(24.5)
    expect(parseSvgLength('1e2')).toBe(100)
    expect(parseSvgLength('.5')).toBe(0.5)
    expect(parseSvgLength('+64')).toBe(64)
    expect(parseSvgLength('64PX')).toBe(64)
  })

  it('converts absolute units at 96 px per inch', () => {
    expect(parseSvgLength('1in')).toBe(96)
    expect(parseSvgLength('72pt')).toBe(96)
    expect(parseSvgLength('1pc')).toBe(16)
    expect(parseSvgLength('2.54cm')).toBeCloseTo(96, 9)
    expect(parseSvgLength('25.4mm')).toBeCloseTo(96, 9)
    expect(parseSvgLength('101.6q')).toBeCloseTo(96, 9)
  })

  it('treats absent, auto and relative lengths as not defining a size', () => {
    for (const value of [null, undefined, '', '  ', 'auto', 'AUTO', '100%', '50%', '2em', '3rem', '10ex', '50vw', '50vh', '1vmin']) {
      expect(parseSvgLength(value)).toBe('auto')
    }
  })

  it('rejects malformed, zero, negative and non-finite lengths', () => {
    for (const value of ['abc', 'px', '10 px', '10px10', '1,000', '10furlongs', '--5', '0', '0px', '-10', '-1in', '1e400', 'NaN', 'Infinity', 'calc(10px)']) {
      expect(parseSvgLength(value)).toBe('invalid')
    }
  })
})

describe('parseViewBoxSize', () => {
  it('reads width and height, separated by spaces and/or commas', () => {
    expect(parseViewBoxSize('0 0 800 600')).toEqual({ width: 800, height: 600 })
    expect(parseViewBoxSize('-10,-20,30.5,40')).toEqual({ width: 30.5, height: 40 })
    expect(parseViewBoxSize('  0, 0  210  297 ')).toEqual({ width: 210, height: 297 })
  })

  it('rejects malformed viewBoxes', () => {
    for (const value of [null, undefined, '', '0 0 100', '0 0 100 100 100', '0 0 a 100', '0 0 100px 100', '0 0 0 100', '0 0 100 -5', '0 0 1e400 1']) {
      expect(parseViewBoxSize(value)).toBeNull()
    }
  })
})

describe('resolveSvgSize', () => {
  it('uses explicit width and height', () => {
    expect(resolveSvgSize({ width: '640', height: '480' })).toEqual({ width: 640, height: 480 })
    expect(resolveSvgSize({ width: '24px', height: '24px', viewBox: '0 0 48 48' })).toEqual({
      width: 24,
      height: 24,
    })
  })

  it('converts absolute units, matching the browser intrinsic size', () => {
    // Inkscape's default A4 document.
    expect(resolveSvgSize({ width: '210mm', height: '297mm', viewBox: '0 0 210 297' })).toEqual({
      width: 794,
      height: 1123,
    })
  })

  it('uses the viewBox when width and height are absent', () => {
    expect(resolveSvgSize({ viewBox: '0 0 800 600' })).toEqual({ width: 800, height: 600 })
    expect(resolveSvgSize({ width: null, height: null, viewBox: '0 0 512 512' })).toEqual({
      width: 512,
      height: 512,
    })
  })

  it('uses the viewBox when width and height are relative', () => {
    expect(resolveSvgSize({ width: '100%', height: '100%', viewBox: '0 0 300 200' })).toEqual({
      width: 300,
      height: 200,
    })
    expect(resolveSvgSize({ width: '10em', height: 'auto', viewBox: '0 0 30 20' })).toEqual({
      width: 30,
      height: 20,
    })
  })

  it('derives a missing or relative side from the viewBox aspect ratio', () => {
    expect(resolveSvgSize({ width: '400', viewBox: '0 0 200 100' })).toEqual({ width: 400, height: 200 })
    expect(resolveSvgSize({ height: '300', viewBox: '0 0 200 100' })).toEqual({ width: 600, height: 300 })
    expect(resolveSvgSize({ width: '400', height: '100%', viewBox: '0 0 200 100' })).toEqual({
      width: 400,
      height: 200,
    })
  })

  it('returns null rather than assuming a size when none is usable', () => {
    expect(resolveSvgSize({})).toBeNull()
    expect(resolveSvgSize({ width: '100%', height: '100%' })).toBeNull()
    expect(resolveSvgSize({ width: '200' })).toBeNull()
    expect(resolveSvgSize({ height: '200' })).toBeNull()
    expect(resolveSvgSize({ width: '50%', viewBox: '0 0 0 0' })).toBeNull()
    expect(resolveSvgSize({ viewBox: 'garbage' })).toBeNull()
  })

  it('returns null when width or height is malformed, even with a valid viewBox', () => {
    expect(resolveSvgSize({ width: 'abc', height: '100', viewBox: '0 0 10 10' })).toBeNull()
    expect(resolveSvgSize({ width: '0', height: '100', viewBox: '0 0 10 10' })).toBeNull()
    expect(resolveSvgSize({ width: '100', height: '-5', viewBox: '0 0 10 10' })).toBeNull()
  })

  it('ignores a malformed viewBox when width and height are explicit', () => {
    expect(resolveSvgSize({ width: '64', height: '32', viewBox: 'not a viewbox' })).toEqual({
      width: 64,
      height: 32,
    })
  })

  it('rounds to whole pixels with a minimum of 1', () => {
    expect(resolveSvgSize({ width: '10.4', height: '10.5' })).toEqual({ width: 10, height: 11 })
    expect(resolveSvgSize({ width: '0.2', height: '0.2' })).toEqual({ width: 1, height: 1 })
    expect(resolveSvgSize({ viewBox: '0 0 0.001 50' })).toEqual({ width: 1, height: 50 })
  })

  it('does not apply import limits itself', () => {
    expect(resolveSvgSize({ width: '100000', height: '100000' })).toEqual({
      width: 100_000,
      height: 100_000,
    })
  })
})
