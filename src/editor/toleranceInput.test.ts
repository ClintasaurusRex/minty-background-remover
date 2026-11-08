import { describe, expect, it } from 'vitest'
import { AUTO_TRIM_PADDING_RANGE, paddingFieldEvent } from './autoTrimPadding'
import {
  type ToleranceFieldEvent,
  type ToleranceSliderEvent,
  EDGE_PIXEL_RANGE,
  NO_KEYS_HELD,
  SLIDER_ADJUSTMENT_KEYS,
  TOLERANCE_RANGE,
  clampTolerance,
  committedToleranceInput,
  exactToleranceInput,
  finishAdjustment,
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

describe('the same field behaviour for the Delete edge amounts (0–5 px)', () => {
  const range = EDGE_PIXEL_RANGE

  it('uses 0–100 with Page steps of 10 for the tolerance by default, and 0–5 with steps of 1 for the edge amounts', () => {
    expect(TOLERANCE_RANGE).toEqual({ max: 100, pageStep: 10 })
    expect(EDGE_PIXEL_RANGE).toEqual({ max: 5, pageStep: 1 })
  })

  it('applies 0–5 as typed, waits for anything larger, and clamps it to 5 when committed', () => {
    expect([0, 1, 5].map((n) => exactToleranceInput(String(n), range))).toEqual([0, 1, 5])
    expect(exactToleranceInput('6', range)).toBeNull()
    expect(exactToleranceInput('20', range)).toBeNull()
    expect(committedToleranceInput('20', range)).toBe(5)
    expect(committedToleranceInput('2.6', range)).toBe(3)
    expect(committedToleranceInput('-4', range)).toBe(0)
    expect(committedToleranceInput('px', range)).toBeNull()
    expect(clampTolerance(7, range)).toBe(5)
  })

  it('steps by 1 with the arrows and Page keys, within 0–5', () => {
    expect(steppedTolerance(4, 'ArrowUp', range)).toBe(5)
    expect(steppedTolerance(5, 'ArrowUp', range)).toBe(5)
    expect(steppedTolerance(0, 'ArrowDown', range)).toBe(0)
    expect(steppedTolerance(2, 'PageUp', range)).toBe(3)
    expect(steppedTolerance(2, 'PageDown', range)).toBe(1)
    expect(steppedTolerance(2, 'Home', range)).toBeNull()
  })

  it('runs the whole entry: typing, Enter with an out-of-range value, Escape and text that is not a number', () => {
    let state = initialToleranceFieldState(0)
    const send = (event: ToleranceFieldEvent, value: number) => {
      const result = toleranceFieldEvent(state, event, value, range)
      state = result.state
      return result
    }
    expect(send({ type: 'focus' }, 0)).toEqual({ state: initialToleranceFieldState(0) })
    expect(send({ type: 'input', text: '3' }, 0).change).toBe(3)
    expect(send({ type: 'key-down', key: 'Enter' }, 3).commit).toBe(3)
    expect(send({ type: 'input', text: '9' }, 3).change).toBeUndefined()
    expect(send({ type: 'key-down', key: 'Enter' }, 3).commit).toBe(5)
    expect(send({ type: 'input', text: '1' }, 5).change).toBe(1)
    const escaped = send({ type: 'key-down', key: 'Escape' }, 1)
    expect(escaped.commit).toBe(5)
    expect(escaped.handled).toBe(true)
    expect(send({ type: 'input', text: 'x' }, 5).change).toBeUndefined()
    expect(send({ type: 'blur' }, 5).commit).toBe(5)
    expect(send({ type: 'key-down', key: 'ArrowDown' }, 5).change).toBe(4)
    expect(send({ type: 'key-up', key: 'ArrowDown' }, 4).commit).toBe(4)
  })

  it('commits an edge amount only when an adjustment is finished, as the Edge cleanup and Feather controls use it (Phase 3 Step 9)', () => {
    // The slider: a drag reports movements (React's onChange, not seen here) and one change at release.
    let held = NO_KEYS_HELD
    const slider = (event: Parameters<typeof toleranceSliderEvent>[1]) => {
      const result = toleranceSliderEvent(held, event)
      held = result.held
      return result.commit
    }
    expect([slider({ type: 'pointer-down' }), slider({ type: 'change' })]).toEqual([false, true])
    // A held arrow key: a change for every repeated step, one commit at the release.
    const steps = [slider({ type: 'key-down', key: 'ArrowRight' })]
    for (let i = 0; i < 4; i++) steps.push(slider({ type: 'key-down', key: 'ArrowRight' }), slider({ type: 'change' }))
    steps.push(slider({ type: 'key-up', key: 'ArrowRight' }))
    expect(steps.filter(Boolean)).toHaveLength(1)
    expect(steps.at(-1)).toBe(true)
    // The field: typing applies without committing; Enter commits once.
    let field = initialToleranceFieldState(0)
    const typed = toleranceFieldEvent(field, { type: 'input', text: '3' }, 0, range)
    expect(typed).toMatchObject({ change: 3 })
    expect(typed.commit).toBeUndefined()
    field = typed.state
    expect(toleranceFieldEvent(field, { type: 'key-down', key: 'Enter' }, 3, range).commit).toBe(3)
  })
})

/**
 * The Edge cleanup / Feather control as MagicWandOptions wires it (Phase 3 Step 9 correction): the
 * slider and field events above, with finishAdjustment deciding whether a finished adjustment is a
 * commit (which can update the last Delete) or only sets the amount again. `log` records what the
 * control reports: "set n" (the amount, nothing computed) and "commit n".
 */
function amountControl(initial: number) {
  const range = EDGE_PIXEL_RANGE
  let value = initial
  let start = initial
  let keys = NO_KEYS_HELD
  let field = initialToleranceFieldState(initial)
  const log: string[] = []
  const finish = (pixels: number) => {
    const result = finishAdjustment(start, pixels)
    start = result.start
    value = pixels
    log.push(`${result.changed ? 'commit' : 'set'} ${pixels}`)
  }
  const slider = (event: Parameters<typeof toleranceSliderEvent>[1]) => {
    const result = toleranceSliderEvent(keys, event)
    keys = result.held
    if (result.commit) finish(value)
    if (event.type === 'pointer-down') start = value
  }
  const fieldEvent = (event: Parameters<typeof toleranceFieldEvent>[1]) => {
    const result = toleranceFieldEvent(field, event, value, range)
    field = result.state
    if (result.change !== undefined) value = result.change
    if (result.commit !== undefined) finish(result.commit)
  }
  const step = (key: string) => {
    const next = { ArrowRight: value + 1, ArrowUp: value + 1, ArrowLeft: value - 1, ArrowDown: value - 1, Home: 0, End: range.max }[key]
    return Math.min(range.max, Math.max(0, next ?? value))
  }
  return {
    log,
    value: () => value,
    commits: () => log.filter((entry) => entry.startsWith('commit')),
    // The slider: focus, a pointer drag (input events move it, change at release), keys (a change event per step).
    focusSlider: () => (start = value),
    blurSlider: () => slider({ type: 'blur' }),
    press: () => slider({ type: 'pointer-down' }),
    move: (pixels: number) => (value = pixels),
    release: () => slider({ type: 'change' }),
    keyDown(key: string) {
      slider({ type: 'key-down', key })
      value = step(key)
      slider({ type: 'change' })
    },
    keyUp: (key: string) => slider({ type: 'key-up', key }),
    // The field.
    focusField() {
      start = value
      fieldEvent({ type: 'focus' })
    },
    type: (text: string) => fieldEvent({ type: 'input', text }),
    fieldKey: (key: string) => fieldEvent({ type: 'key-down', key }),
    fieldKeyUp: (key: string) => fieldEvent({ type: 'key-up', key }),
    blurField: () => fieldEvent({ type: 'blur' }),
  }
}

describe('the same field behaviour for the Auto Trim padding (0–50 px, Phase 3 Step 11)', () => {
  const range = AUTO_TRIM_PADDING_RANGE

  it('uses 0–50 with Page steps of 10', () => {
    expect(range).toEqual({ max: 50, pageStep: 10 })
  })

  it('applies 0–50 as typed, waits for anything larger or not a whole number, and clamps when committed', () => {
    expect([0, 5, 20, 50].map((n) => exactToleranceInput(String(n), range))).toEqual([0, 5, 20, 50])
    for (const text of ['51', '100', '-1', '2.5', '1e1', 'px', '']) expect(exactToleranceInput(text, range)).toBeNull()
    expect(committedToleranceInput('60', range)).toBe(50)
    expect(committedToleranceInput('12.5', range)).toBe(13)
    expect(committedToleranceInput('-4', range)).toBe(0)
    expect(committedToleranceInput('1e1', range)).toBe(10)
    expect(committedToleranceInput('five', range)).toBeNull()
  })

  it('steps by 1 with the arrows and by 10 with the Page keys, within 0–50', () => {
    expect(steppedTolerance(5, 'ArrowUp', range)).toBe(6)
    expect(steppedTolerance(0, 'ArrowDown', range)).toBe(0)
    expect(steppedTolerance(45, 'PageUp', range)).toBe(50)
    expect(steppedTolerance(5, 'PageDown', range)).toBe(0)
    expect(steppedTolerance(50, 'ArrowUp', range)).toBe(50)
    expect(steppedTolerance(5, 'End', range)).toBeNull()
  })

  it('runs the whole entry as the padding field uses it (paddingFieldEvent): every change and commit sets the padding', () => {
    let padding = 5
    let state = initialToleranceFieldState(padding)
    const send = (event: ToleranceFieldEvent) => {
      const result = paddingFieldEvent(state, event, padding)
      state = result.state
      // The padding control sets the padding for both (AutoTrimOptions.tsx).
      if (result.change !== undefined) padding = result.change
      if (result.commit !== undefined) padding = result.commit
      return result
    }
    send({ type: 'focus' })
    send({ type: 'input', text: '1' })
    expect(padding).toBe(1)
    send({ type: 'input', text: '12' })
    expect(padding).toBe(12)
    send({ type: 'key-down', key: 'Enter' })
    expect(padding).toBe(12)
    send({ type: 'input', text: '75' })
    expect(padding).toBe(12)
    send({ type: 'blur' })
    expect(padding).toBe(50)
    send({ type: 'focus' })
    send({ type: 'input', text: '3' })
    expect(padding).toBe(3)
    expect(send({ type: 'key-down', key: 'Escape' }).handled).toBe(true)
    expect(padding).toBe(50)
    send({ type: 'input', text: 'abc' })
    send({ type: 'key-down', key: 'Enter' })
    expect(padding).toBe(50)
    send({ type: 'key-down', key: 'PageDown' })
    send({ type: 'key-down', key: 'PageDown' })
    expect(padding).toBe(30)
    send({ type: 'key-up', key: 'PageDown' })
    expect(padding).toBe(30)
    send({ type: 'key-down', key: 'ArrowUp' })
    expect(padding).toBe(31)
  })
})

describe('Edge amount controls commit only actual changes (Phase 3 Step 9 correction)', () => {
  it('finishAdjustment: a change only when the finished value differs from the start; the next start is that value', () => {
    expect(finishAdjustment(3, 3)).toEqual({ changed: false, start: 3 })
    expect(finishAdjustment(3, 4)).toEqual({ changed: true, start: 4 })
    expect(finishAdjustment(0, 5)).toEqual({ changed: true, start: 5 })
  })

  it('moving focus through both parts of both controls commits nothing (the Redo mismatch: 3 shown, the Delete made with 1)', () => {
    for (const shown of [0, 3, 5]) {
      const control = amountControl(shown)
      control.focusSlider()
      control.blurSlider()
      control.focusField()
      control.blurField()
      control.focusSlider()
      control.blurSlider()
      expect(control.commits(), `${shown}`).toEqual([])
      expect(control.value()).toBe(shown)
    }
  })

  it('a slider drag commits once at release, only when it ends on another amount', () => {
    const back = amountControl(3)
    back.focusSlider()
    back.press()
    for (const pixels of [4, 5, 4, 3]) back.move(pixels)
    back.release()
    back.blurSlider()
    expect(back.commits()).toEqual([])
    expect(back.log).toEqual(['set 3', 'set 3'])
    const moved = amountControl(3)
    moved.press()
    for (const pixels of [4, 5, 2]) moved.move(pixels)
    moved.release()
    moved.blurSlider()
    expect(moved.commits()).toEqual(['commit 2'])
  })

  it('keyboard: each finished press commits; keys held and moved back before release commit nothing', () => {
    const control = amountControl(3)
    control.focusSlider()
    control.keyDown('ArrowRight')
    control.keyUp('ArrowRight')
    control.keyDown('ArrowLeft')
    control.keyUp('ArrowLeft')
    expect(control.commits()).toEqual(['commit 4', 'commit 3'])
    // Right held, then Left while it is still held: back to 3 when the last key is released.
    control.keyDown('ArrowRight')
    control.keyDown('ArrowLeft')
    control.keyUp('ArrowRight')
    control.keyUp('ArrowLeft')
    // Held to the end and back with Home is not back: 0.
    control.blurSlider()
    expect(control.commits()).toEqual(['commit 4', 'commit 3'])
    control.focusSlider()
    control.keyDown('Home')
    control.keyUp('Home')
    expect(control.commits()).toEqual(['commit 4', 'commit 3', 'commit 0'])
  })

  it('typing: Enter or leaving commits a different amount; retyping the same, Escape and non-numbers commit nothing', () => {
    const control = amountControl(3)
    control.focusField()
    control.type('4')
    control.type('3')
    control.fieldKey('Enter')
    expect(control.commits()).toEqual([])
    control.type('5')
    expect(control.value()).toBe(5)
    control.fieldKey('Escape')
    // Escape sets the amount back without committing.
    expect(control.value()).toBe(3)
    expect(control.commits()).toEqual([])
    control.type('abc')
    control.fieldKey('Enter')
    expect(control.commits()).toEqual([])
    control.type('1')
    control.blurField()
    expect(control.commits()).toEqual(['commit 1'])
    control.focusField()
    control.blurField()
    expect(control.commits()).toEqual(['commit 1'])
    // An arrow step in the field commits at its release; stepping back in the same hold does not.
    control.focusField()
    control.fieldKey('ArrowUp')
    control.fieldKeyUp('ArrowUp')
    expect(control.commits()).toEqual(['commit 1', 'commit 2'])
    control.fieldKey('ArrowUp')
    control.fieldKey('ArrowDown')
    control.fieldKeyUp('ArrowUp')
    control.fieldKeyUp('ArrowDown')
    expect(control.commits()).toEqual(['commit 1', 'commit 2'])
  })

  it('values typed out of range commit their clamped amount, and only when it differs', () => {
    const atMax = amountControl(5)
    atMax.focusField()
    atMax.type('9')
    atMax.fieldKey('Enter')
    expect(atMax.commits()).toEqual([])
    expect(atMax.value()).toBe(5)
    const below = amountControl(2)
    below.focusField()
    below.type('9')
    below.fieldKey('Enter')
    expect(below.commits()).toEqual(['commit 5'])
  })
})
