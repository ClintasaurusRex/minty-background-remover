import { describe, expect, it } from 'vitest'
import { clampTolerance, committedToleranceInput, exactToleranceInput, steppedTolerance } from './toleranceInput'

describe('exactToleranceInput', () => {
  it('accepts whole numbers from 0 to 100, ignoring surrounding spaces', () => {
    expect(exactToleranceInput('0')).toBe(0)
    expect(exactToleranceInput('20')).toBe(20)
    expect(exactToleranceInput(' 100 ')).toBe(100)
    expect(exactToleranceInput('007')).toBe(7)
  })

  it('waits for anything else, including partial and out-of-range entries', () => {
    for (const text of ['', ' ', '-', '-5', '101', '1000', '20.', '20.5', '1e2', 'abc', '2 0', '+5', '0x10', 'Infinity']) {
      expect(exactToleranceInput(text)).toBeNull()
    }
  })
})

describe('committedToleranceInput', () => {
  it('rounds and clamps any finite number', () => {
    expect(committedToleranceInput('20')).toBe(20)
    expect(committedToleranceInput('20.4')).toBe(20)
    expect(committedToleranceInput('20.5')).toBe(21)
    expect(committedToleranceInput('-5')).toBe(0)
    expect(committedToleranceInput('150')).toBe(100)
    expect(committedToleranceInput('1e2')).toBe(100)
    expect(committedToleranceInput(' 7 ')).toBe(7)
  })

  it('rejects text that is not a number, which restores the current tolerance', () => {
    for (const text of ['', '   ', 'abc', '20px', 'NaN', 'Infinity', '-Infinity', '--5', '2 0']) {
      expect(committedToleranceInput(text)).toBeNull()
    }
  })
})

describe('clampTolerance', () => {
  it('rounds to a whole number within 0–100', () => {
    expect(clampTolerance(-0.4)).toBe(0)
    expect(clampTolerance(49.5)).toBe(50)
    expect(clampTolerance(100.4)).toBe(100)
    expect(clampTolerance(1e9)).toBe(100)
  })
})

describe('steppedTolerance', () => {
  it('steps by 1 with the arrows and by 10 with Page Up / Page Down, within 0–100', () => {
    expect(steppedTolerance(20, 'ArrowUp')).toBe(21)
    expect(steppedTolerance(20, 'ArrowDown')).toBe(19)
    expect(steppedTolerance(20, 'PageUp')).toBe(30)
    expect(steppedTolerance(20, 'PageDown')).toBe(10)
    expect(steppedTolerance(100, 'ArrowUp')).toBe(100)
    expect(steppedTolerance(0, 'ArrowDown')).toBe(0)
    expect(steppedTolerance(95, 'PageUp')).toBe(100)
    expect(steppedTolerance(5, 'PageDown')).toBe(0)
  })

  it('leaves other keys to the text field', () => {
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Enter', '5', 'Backspace']) {
      expect(steppedTolerance(20, key)).toBeNull()
    }
  })
})
