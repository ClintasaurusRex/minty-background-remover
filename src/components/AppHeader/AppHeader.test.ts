import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EditKind } from '../../editor/history/historyEntry'
import { AppHeader } from './AppHeader'

/* Markup checks for the header's Undo and Redo (interaction is checked in real browsers). */

const noop = () => {}
const render = (undo: EditKind | null, redo: EditKind | null) =>
  renderToStaticMarkup(createElement(AppHeader, { onOpenImage: noop, undo, redo, onUndo: noop, onRedo: noop }))

/** The Undo and Redo buttons' opening tags and hidden names, in order. */
function historyButtons(markup: string) {
  const buttons = [...markup.matchAll(/(<button[^>]*button--icon[^>]*>)<svg[^]*?<\/svg><span class="visually-hidden">([^<]*)<\/span><\/button>/g)]
  return buttons.map(([, tag, name]) => ({ tag, name }))
}

describe('AppHeader: Undo and Redo', () => {
  it('are unavailable (aria-disabled, never disabled) with nothing to undo or redo', () => {
    const [undo, redo] = historyButtons(render(null, null))
    expect(undo.name).toBe('Undo')
    expect(undo.tag).toContain('aria-disabled="true"')
    expect(undo.tag).toContain('title="Undo (Ctrl+Z) — nothing to undo"')
    expect(redo.name).toBe('Redo')
    expect(redo.tag).toContain('aria-disabled="true"')
    expect(redo.tag).toContain('title="Redo (Ctrl+Y or Ctrl+Shift+Z) — nothing to redo"')
    for (const { tag } of [undo, redo]) expect(tag).not.toMatch(/\sdisabled(=|\s|>)/)
  })

  it('name the edit they would undo or redo', () => {
    const [undo, redo] = historyButtons(render('delete-selection', 'delete-selection'))
    expect(undo.name).toBe('Undo Delete Selection')
    expect(undo.tag).toContain('aria-disabled="false"')
    expect(undo.tag).toContain('title="Undo Delete Selection (Ctrl+Z)"')
    expect(redo.name).toBe('Redo Delete Selection')
    expect(redo.tag).toContain('title="Redo Delete Selection (Ctrl+Y or Ctrl+Shift+Z)"')
    expect(historyButtons(render('auto-trim', null))[0].name).toBe('Undo Auto Trim')
  })

  it('announce their shortcuts', () => {
    const [undo, redo] = historyButtons(render('delete-selection', null))
    expect(undo.tag).toContain('aria-keyshortcuts="Control+Z"')
    expect(redo.tag).toContain('aria-keyshortcuts="Control+Y Control+Shift+Z"')
  })

  it('keeps Open Image available and Export disabled until its phase', () => {
    const markup = render('delete-selection', null)
    expect(markup).toMatch(/<button type="button" class="button" title="Open Image \(Ctrl\+O\)"/)
    expect(markup).toMatch(/<button type="button" class="button button--primary" disabled="" title="Export">/)
  })
})
