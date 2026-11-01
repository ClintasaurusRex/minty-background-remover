import { describe, expect, it } from 'vitest'
import {
  type ToleranceFieldEvent,
  type ToleranceSliderEvent,
  NO_KEYS_HELD,
  SLIDER_ADJUSTMENT_KEYS,
  clampTolerance,
  committedToleranceInput,
  exactToleranceInput,
  initialToleranceFieldState,
  steppedTolerance,
  toleranceFieldEvent,
  toleranceSliderEvent,
} from './toleranceInput'

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

/** Runs slider events from no keys held, returning whether each one committed. */
function sliderCommits(...events: ToleranceSliderEvent[]): boolean[] {
  let held = NO_KEYS_HELD
  return events.map((event) => {
    const result = toleranceSliderEvent(held, event)
    held = result.held
    return result.commit
  })
}

const down = (key: string): ToleranceSliderEvent => ({ type: 'key-down', key })
const up = (key: string): ToleranceSliderEvent => ({ type: 'key-up', key })
const change: ToleranceSliderEvent = { type: 'change' }

describe('toleranceSliderEvent', () => {
  it('commits a pointer adjustment once, when the thumb is released', () => {
    // Movements are applied as input events (not seen here); the change event marks the release.
    expect(sliderCommits({ type: 'pointer-down' }, change)).toEqual([false, true])
  })

  it('commits a value set by assistive technology, which arrives as a change without keys', () => {
    expect(sliderCommits(change, change)).toEqual([true, true])
  })

  it('commits a keyboard step when its key is released, not at the change event of each step', () => {
    for (const key of SLIDER_ADJUSTMENT_KEYS) {
      expect(sliderCommits(down(key), change, up(key))).toEqual([false, false, true])
    }
  })

  it('commits a held, repeating key once, at its release', () => {
    expect(sliderCommits(down('ArrowRight'), change, down('ArrowRight'), change, down('ArrowRight'), change, up('ArrowRight')))
      .toEqual([false, false, false, false, false, false, true])
  })

  it('waits for the last of several adjustment keys held together', () => {
    expect(sliderCommits(down('ArrowRight'), change, down('PageUp'), change, up('ArrowRight'), change, up('PageUp')))
      .toEqual([false, false, false, false, false, false, true])
  })

  it('ignores keys that do not adjust the slider', () => {
    for (const key of ['Tab', 'Shift', 'Control', 'Escape', 'Enter', ' ', 'a', '5']) {
      expect(sliderCommits(down(key), up(key))).toEqual([false, false])
    }
    // A change while only such a key is held is a pointer or assistive technology change.
    expect(sliderCommits(down('Shift'), change, up('Shift'))).toEqual([false, true, false])
  })

  it('ignores the release of a key pressed before the slider had focus', () => {
    expect(sliderCommits(up('ArrowRight'), change)).toEqual([false, true])
  })

  it('commits whatever is in progress when the slider loses focus, and forgets held keys', () => {
    expect(sliderCommits({ type: 'blur' })).toEqual([true])
    // A key held while focus leaves: its release later reaches another element, and a later
    // pointer adjustment commits as usual.
    expect(sliderCommits(down('ArrowLeft'), change, { type: 'blur' }, change)).toEqual([false, false, true, true])
  })

  it('ends a keyboard adjustment at a pointer press, so a pointer adjustment always commits on release', () => {
    // A key release that is never reported (macOS reports none while ⌘ is held).
    expect(sliderCommits(down('ArrowRight'), change, { type: 'pointer-down' }, change)).toEqual([false, false, true, true])
    // A key still held: its next repeat and release work as before.
    expect(sliderCommits(down('ArrowUp'), { type: 'pointer-down' }, down('ArrowUp'), change, up('ArrowUp')))
      .toEqual([false, true, false, false, true])
  })

  it('never commits on a key press, and only on the release that finishes the adjustment', () => {
    expect(sliderCommits(down('Home'), up('Home'), down('End'), up('End'))).toEqual([false, true, false, true])
  })
})

/**
 * The text field with an editor around it: `change` and `commit` set the tolerance as the
 * editor does (rounded and clamped), and commits are recorded. Other controls never change
 * the tolerance unless a test does so with `setTolerance`.
 */
function simulateField(initial = 20) {
  let state = initialToleranceFieldState(initial)
  let tolerance = initial
  const commits: number[] = []
  const send = (event: ToleranceFieldEvent) => {
    const result = toleranceFieldEvent(state, event, tolerance)
    state = result.state
    if (result.change !== undefined) tolerance = clampTolerance(result.change)
    if (result.commit !== undefined) {
      tolerance = clampTolerance(result.commit)
      commits.push(result.commit)
    }
    return result
  }
  return {
    send,
    /** Replaces the field's text, as selecting everything and typing `text` does: one input event per character. */
    replaceWith(text: string) {
      send({ type: 'input', text: '' })
      for (let i = 1; i <= text.length; i++) send({ type: 'input', text: text.slice(0, i) })
    },
    key(key: string) {
      const pressed = send({ type: 'key-down', key })
      send({ type: 'key-up', key })
      return pressed
    },
    setTolerance(value: number) {
      tolerance = value
    },
    get tolerance() {
      return tolerance
    },
    /** What the field shows. */
    get shown() {
      return state.draft ?? String(tolerance)
    },
    get state() {
      return state
    },
    commits,
  }
}

describe('toleranceFieldEvent', () => {
  it('applies a typed whole number at once without committing, and commits it on Enter', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    field.replaceWith('45')
    expect(field.tolerance).toBe(45)
    expect(field.commits).toEqual([])
    expect(field.key('Enter').handled).toBeFalsy()
    expect(field.commits).toEqual([45])
    expect(field.shown).toBe('45')
  })

  it('commits the entry when the field is left, as with Enter', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    field.replaceWith('63')
    field.send({ type: 'blur' })
    expect(field.commits).toEqual([63])
    expect(field.state.draft).toBeNull()
  })

  it('waits for Enter to round and clamp other numbers', () => {
    for (const [text, value] of [['20.6', 21], ['150', 100], ['-5', 0], ['1e1', 10], [' 7 ', 7]] as const) {
      const field = simulateField(20)
      field.send({ type: 'focus' })
      field.replaceWith(text)
      field.key('Enter')
      expect(field.commits.at(-1)).toBe(value)
      expect(field.tolerance).toBe(value)
      expect(field.shown).toBe(String(value))
    }
  })

  it('restores and commits the current tolerance for text that is not a number', () => {
    // No prefix of these is a whole number, so the tolerance never changes while typing.
    for (const text of ['', 'abc', '--', 'x5']) {
      const field = simulateField(20)
      field.send({ type: 'focus' })
      field.replaceWith(text)
      field.key('Enter')
      expect(field.commits).toEqual([20])
      expect(field.shown).toBe('20')
    }
    // A whole number typed on the way stays applied: "4" was 4 before "4x" stopped being a number.
    const field = simulateField(20)
    field.send({ type: 'focus' })
    field.replaceWith('4x')
    field.send({ type: 'blur' })
    expect(field.commits).toEqual([4])
    expect(field.shown).toBe('4')
  })

  it('cancels an unfinished entry with Escape, restoring the tolerance from before it and committing nothing new', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    field.replaceWith('85')
    expect(field.tolerance).toBe(85)
    const escape = field.key('Escape')
    // Handled, so the editor does not also clear the selection.
    expect(escape.handled).toBe(true)
    expect(field.tolerance).toBe(20)
    expect(field.commits).toEqual([20])
    expect(field.shown).toBe('20')
    // Leaving the field afterwards commits the restored tolerance again: nothing to re-apply.
    field.send({ type: 'blur' })
    expect(field.commits).toEqual([20, 20])
  })

  it('cancels only the entry in progress: Escape after Enter keeps the committed value', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    field.replaceWith('45')
    field.key('Enter')
    field.replaceWith('70')
    field.key('Escape')
    expect(field.tolerance).toBe(45)
    expect(field.commits).toEqual([45, 45])
    // And with no entry in progress, Escape keeps the tolerance as it is.
    field.key('Escape')
    expect(field.commits).toEqual([45, 45, 45])
  })

  it('restores the tolerance from when the entry began, even if it changed since the field gained focus', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    // Committed elsewhere while the field has focus (a slider drag finishing).
    field.setTolerance(35)
    field.replaceWith('90')
    field.key('Escape')
    expect(field.tolerance).toBe(35)
    expect(field.commits).toEqual([35])
  })

  it('steps with the arrows and Page keys at once, committing once when the last key is released', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    const pressed = field.send({ type: 'key-down', key: 'ArrowUp' })
    expect(pressed).toMatchObject({ change: 21, handled: true })
    expect(pressed.commit).toBeUndefined()
    // Repeats while held.
    field.send({ type: 'key-down', key: 'ArrowUp' })
    field.send({ type: 'key-down', key: 'PageUp' })
    expect(field.tolerance).toBe(32)
    field.send({ type: 'key-up', key: 'ArrowUp' })
    expect(field.commits).toEqual([])
    field.send({ type: 'key-up', key: 'PageUp' })
    expect(field.commits).toEqual([32])
    // The step was finished, so Escape has nothing left to cancel.
    field.key('Escape')
    expect(field.tolerance).toBe(32)
    for (const [key, value] of [['ArrowDown', 31], ['PageDown', 21]] as const) {
      field.key(key)
      expect(field.commits.at(-1)).toBe(value)
    }
  })

  it('steps from a typed number', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    field.replaceWith('44.6')
    field.key('ArrowUp')
    expect(field.commits).toEqual([46])
    expect(field.shown).toBe('46')
  })

  it('leaves other keys to the text field', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Backspace', '5', 'Tab']) {
      const result = field.send({ type: 'key-down', key })
      expect(result.handled).toBeFalsy()
      expect(result.change).toBeUndefined()
      expect(result.commit).toBeUndefined()
      field.send({ type: 'key-up', key })
    }
    expect(field.commits).toEqual([])
  })

  it('commits a step still held when the field is left, and ignores the later key release', () => {
    const field = simulateField(20)
    field.send({ type: 'focus' })
    field.send({ type: 'key-down', key: 'ArrowDown' })
    field.send({ type: 'blur' })
    expect(field.commits).toEqual([19])
    field.send({ type: 'key-up', key: 'ArrowDown' })
    expect(field.commits).toEqual([19])
  })

  it('only ever commits from Enter, Escape, the last step key released or leaving the field', () => {
    // A long pseudo-random session: typing, steps, Enter, Escape, focus changes. Escape always
    // commits the tolerance committed before it, so cancelling never re-applies anything.
    const keys = ['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'a']
    const texts = ['', '7', '45', '100', '101', '-3', '2.5', 'x', '0', '99']
    let seed = 12345
    const random = (n: number) => {
      // xorshift32: deterministic, so a failure always reproduces.
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) % n
    }
    const field = simulateField(20)
    let lastCommitted = 20
    field.send({ type: 'focus' })
    for (let step = 0; step < 3000; step++) {
      const choice = random(6)
      const before = field.commits.length
      if (choice === 0) {
        const result = field.send({ type: 'input', text: texts[random(texts.length)] })
        expect(result.commit).toBeUndefined()
      } else if (choice === 1) {
        const key = keys[random(keys.length)]
        const result = field.send({ type: 'key-down', key })
        if (key === 'Escape') expect(result.commit).toBe(lastCommitted)
        else if (key !== 'Enter') expect(result.commit).toBeUndefined()
      } else if (choice === 2) {
        field.send({ type: 'key-up', key: keys[random(keys.length)] })
      } else if (choice === 3) {
        field.send({ type: 'blur' })
        field.send({ type: 'focus' })
      } else {
        field.replaceWith(texts[random(texts.length)])
      }
      if (field.commits.length > before) lastCommitted = field.commits.at(-1)!
      expect(Number.isInteger(field.tolerance) && field.tolerance >= 0 && field.tolerance <= 100).toBe(true)
    }
    expect(field.commits.length).toBeGreaterThan(100)
  })
})
