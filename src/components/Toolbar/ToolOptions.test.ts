import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAGIC_WAND_SETTINGS, type MagicWandSettings } from '../../editor/editorState'
import type { SelectionAction } from '../../editor/selectionCommands'
import type { ToolId } from '../../editor/types'
import { type EdgeSettings, NO_EDGE_TREATMENT } from '../../image/edit/deleteWithEdges'
import { ToolOptions } from './ToolOptions'

/*
 * Markup checks for the contextual options row (the project has no DOM test environment;
 * interaction is checked in real browsers). React renders the same elements and
 * attributes on the client.
 */

const ALL: Record<SelectionAction, boolean> = { 'select-all': true, clear: true, invert: true, grow: true, shrink: true }
const noop = () => {}

function render(
  activeTool: ToolId | null,
  settings: MagicWandSettings = DEFAULT_MAGIC_WAND_SETTINGS,
  available = ALL,
  canDeleteSelection = true,
  edgeSettings: EdgeSettings = NO_EDGE_TREATMENT,
) {
  return renderToStaticMarkup(
    createElement(ToolOptions, {
      activeTool,
      settings,
      availableActions: available,
      onSelectionModeChange: noop,
      onFloodModeChange: noop,
      onToleranceChange: noop,
      onToleranceCommit: noop,
      onSelectionAction: noop,
      edgeSettings,
      onEdgeSettingsChange: noop,
      canDeleteSelection,
      onDeleteSelection: noop,
    }),
  )
}

/** The opening tag of the button whose text is `label`. */
function buttonTag(markup: string, label: string): string {
  const match = new RegExp(`(<button[^>]*>)${label}</button>`).exec(markup)
  if (!match) throw new Error(`No button labelled ${label}`)
  return match[1]
}

function inputTag(markup: string, type: string): string {
  const match = new RegExp(`<input[^>]*type="${type}"[^>]*/?>`).exec(markup)
  if (!match) throw new Error(`No ${type} input`)
  return match[0]
}

describe('ToolOptions', () => {
  it('shows nothing until an image is open', () => {
    expect(render(null)).toBe('')
  })

  it('shows nothing for tools without options', () => {
    for (const tool of ['crop', 'replace-color', 'auto-trim'] as const) expect(render(tool)).toBe('')
  })

  it('shows the Magic Wand options while the Magic Wand is active', () => {
    const markup = render('magic-wand')
    expect(markup).toMatch(/^<div class="tool-options" role="group" aria-label="Magic Wand options">/)
    for (const label of ['New', 'Add', 'Subtract', 'Contiguous', 'Global', 'Select All', 'Clear', 'Invert', 'Grow', 'Shrink']) {
      expect(buttonTag(markup, label)).toContain('type="button"')
    }
    for (const group of ['Selection mode', 'Flood mode', 'Selection actions']) {
      expect(markup).toContain(`role="group" aria-label="${group}"`)
    }
  })
})

describe('MagicWandOptions', () => {
  it('presses New and Contiguous by default', () => {
    const markup = render('magic-wand')
    expect(buttonTag(markup, 'New')).toContain('aria-pressed="true"')
    expect(buttonTag(markup, 'Add')).toContain('aria-pressed="false"')
    expect(buttonTag(markup, 'Subtract')).toContain('aria-pressed="false"')
    expect(buttonTag(markup, 'Contiguous')).toContain('aria-pressed="true"')
    expect(buttonTag(markup, 'Global')).toContain('aria-pressed="false"')
  })

  it('presses exactly the chosen selection mode and flood mode', () => {
    for (const selectionMode of ['new', 'add', 'subtract'] as const) {
      for (const floodMode of ['contiguous', 'global'] as const) {
        const markup = render('magic-wand', { ...DEFAULT_MAGIC_WAND_SETTINGS, selectionMode, floodMode })
        expect(markup.match(/aria-pressed="true"/g)).toHaveLength(2)
        const label = { new: 'New', add: 'Add', subtract: 'Subtract' }[selectionMode]
        expect(buttonTag(markup, label)).toContain('aria-pressed="true"')
        expect(buttonTag(markup, floodMode === 'global' ? 'Global' : 'Contiguous')).toContain('aria-pressed="true"')
      }
    }
  })

  it('explains the Shift and Ctrl shortcuts on Add and Subtract', () => {
    const markup = render('magic-wand')
    expect(buttonTag(markup, 'Add')).toContain('hold Shift')
    expect(buttonTag(markup, 'Subtract')).toContain('hold Ctrl')
  })

  it('shows the tolerance in both the slider and the text field', () => {
    const markup = render('magic-wand', { ...DEFAULT_MAGIC_WAND_SETTINGS, tolerance: 37 })
    const slider = inputTag(markup, 'range')
    expect(slider).toContain('min="0"')
    expect(slider).toContain('max="100"')
    expect(slider).toContain('step="1"')
    expect(slider).toContain('value="37"')
    expect(slider).toMatch(/aria-labelledby="[^"]+"/)
    const labelId = /aria-labelledby="([^"]+)"/.exec(slider)![1]
    expect(markup).toContain(`<span id="${labelId}" class="tool-options__label">Tolerance</span>`)

    const field = inputTag(markup, 'text')
    expect(field).toContain('value="37"')
    expect(field).toContain('inputMode="numeric"')
    expect(field).toContain('aria-label="Tolerance value, 0 to 100"')
  })

  it('defaults the tolerance to 20', () => {
    const markup = render('magic-wand')
    expect(inputTag(markup, 'range')).toContain('value="20"')
    expect(inputTag(markup, 'text')).toContain('value="20"')
  })

  it('gives each action a full accessible name and marks unavailable ones aria-disabled', () => {
    const available = { 'select-all': true, clear: false, invert: true, grow: false, shrink: false }
    const markup = render('magic-wand', DEFAULT_MAGIC_WAND_SETTINGS, available)
    const names = { 'Select All': 'Select All', Clear: 'Clear Selection', Invert: 'Invert Selection', Grow: 'Grow Selection', Shrink: 'Shrink Selection' }
    const keys: Record<string, SelectionAction> = { 'Select All': 'select-all', Clear: 'clear', Invert: 'invert', Grow: 'grow', Shrink: 'shrink' }
    for (const [label, name] of Object.entries(names)) {
      const tag = buttonTag(markup, label)
      expect(tag).toContain(`aria-label="${name}"`)
      expect(tag).toContain(`aria-disabled="${!available[keys[label]]}"`)
      // Never the disabled attribute, which would drop keyboard focus.
      expect(tag).not.toMatch(/\sdisabled(=|\s|>)/)
    }
  })

  it('shows the selection shortcuts in the action tooltips', () => {
    const markup = render('magic-wand')
    expect(buttonTag(markup, 'Select All')).toContain('Ctrl+A')
    expect(buttonTag(markup, 'Clear')).toContain('Esc')
    expect(buttonTag(markup, 'Grow')).toContain('1 pixel')
    expect(buttonTag(markup, 'Shrink')).toContain('1 pixel')
  })

  it('keeps controls in a sensible tab order: modes, tolerance, then actions', () => {
    const markup = render('magic-wand')
    const order = ['>New<', '>Contiguous<', 'type="range"', 'type="text"', '>Select All<', '>Shrink<'].map((s) => markup.indexOf(s))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(markup).not.toContain('tabindex')
  })
})

describe('Edge cleanup and Feather controls', () => {
  /** The markup of the amount control labelled `label`. */
  function amount(markup: string, label: string) {
    const match = new RegExp(`<div class="tool-options__group tool-options__amount"><span id="([^"]+)" class="tool-options__label">${label}</span>(<input[^>]*type="range"[^>]*/?>)(<input[^>]*type="text"[^>]*/?>)<span class="tool-options__unit" aria-hidden="true">px</span></div>`).exec(markup)
    if (!match) throw new Error(`No ${label} control`)
    return { labelId: match[1], slider: match[2], field: match[3] }
  }

  it('offers both amounts, 0 px by default, as a labelled 0–5 slider and text field with the unit', () => {
    const markup = render('magic-wand')
    for (const [label, field] of [
      ['Edge cleanup', 'Edge cleanup in pixels, 0 to 5'],
      ['Feather', 'Feather in pixels, 0 to 5'],
    ]) {
      const c = amount(markup, label)
      expect(c.slider).toContain('min="0"')
      expect(c.slider).toContain('max="5"')
      expect(c.slider).toContain('step="1"')
      expect(c.slider).toContain('value="0"')
      expect(c.slider).toContain(`aria-labelledby="${c.labelId}"`)
      expect(c.slider).toContain('aria-valuetext="0 px"')
      expect(c.slider).toContain('0–5 px; 0 = off')
      expect(c.field).toContain('value="0"')
      expect(c.field).toContain('inputMode="numeric"')
      expect(c.field).toContain(`aria-label="${field}"`)
      expect(c.slider).not.toMatch(/\sdisabled(=|\s|>)/)
      expect(c.field).not.toMatch(/\sdisabled(=|\s|>)/)
    }
  })

  it('shows the amounts in the editor', () => {
    const markup = render('magic-wand', DEFAULT_MAGIC_WAND_SETTINGS, ALL, true, { cleanup: 3, feather: 5 })
    expect(amount(markup, 'Edge cleanup').slider).toContain('value="3"')
    expect(amount(markup, 'Edge cleanup').slider).toContain('aria-valuetext="3 px"')
    expect(amount(markup, 'Edge cleanup').field).toContain('value="3"')
    expect(amount(markup, 'Feather').slider).toContain('value="5"')
    expect(amount(markup, 'Feather').field).toContain('value="5"')
  })

  it('explains what each amount does and that it applies to the next Delete', () => {
    const markup = render('magic-wand')
    expect(amount(markup, 'Edge cleanup').slider).toContain('Edge cleanup for the next Delete: remove the background colour left in edge pixels')
    expect(amount(markup, 'Feather').field).toContain('thin lines and small text are kept')
  })

  it('sits between the selection actions and Delete Selection, in tab order', () => {
    const markup = render('magic-wand')
    const order = ['>Shrink<', '>Edge cleanup<', 'aria-label="Edge cleanup in pixels', '>Feather<', 'aria-label="Feather in pixels', 'Delete Selection</button>'].map((s) => markup.indexOf(s))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('Delete Selection control', () => {
  /** The opening tag of the Delete Selection button (its content is an icon and the label). */
  function deleteTag(markup: string): string {
    const match = /(<button[^>]*>)<svg[^]*?<\/svg>Delete Selection<\/button>/.exec(markup)
    if (!match) throw new Error('No Delete Selection button')
    return match[1]
  }

  it('is offered in the Magic Wand options with an icon, its shortcut and a clear name', () => {
    const tag = deleteTag(render('magic-wand'))
    expect(tag).toContain('type="button"')
    expect(tag).toContain('aria-keyshortcuts="Delete"')
    expect(tag).toContain('title="Make the selected pixels transparent (Delete)"')
    expect(tag).toContain('aria-disabled="false"')
    // The visible label is the accessible name: no aria-label overriding it.
    expect(tag).not.toContain('aria-label')
  })

  it('is aria-disabled, never disabled, when nothing can be deleted, with the same label', () => {
    const tag = deleteTag(render('magic-wand', DEFAULT_MAGIC_WAND_SETTINGS, ALL, false))
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).toContain('— nothing to delete')
    expect(tag).not.toMatch(/\sdisabled(=|\s|>)/)
  })

  it('comes last, after the selection actions, in its own group', () => {
    const markup = render('magic-wand')
    expect(markup.indexOf('Delete Selection</button>')).toBeGreaterThan(markup.indexOf('>Shrink<'))
    expect(markup).toMatch(/<div class="tool-options__group"><button[^>]*tool-options__delete/)
  })
})
