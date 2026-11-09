import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EditKind } from '../../editor/history/historyEntry'
import { AppHeader, type ExportStatus } from './AppHeader'

/* Markup checks for the header's Undo, Redo and Export (interaction is checked in real browsers). */

const noop = () => {}
const render = (undo: EditKind | null, redo: EditKind | null, exportStatus: ExportStatus = { kind: 'unavailable' }) =>
  renderToStaticMarkup(
    createElement(AppHeader, { onOpenImage: noop, undo, redo, onUndo: noop, onRedo: noop, exportStatus, onExport: noop }),
  )

/** The Export button's opening tag and its text. */
function exportButton(markup: string) {
  const match = /(<button[^>]*app-header__export[^>]*>)<svg[^]*?<\/svg>([^<]*)<\/button>/.exec(markup)
  if (!match) throw new Error('No Export button')
  return { tag: match[1], text: match[2] }
}

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

  it('keeps Open Image available', () => {
    const markup = render('delete-selection', null)
    expect(markup).toMatch(/<button type="button" class="button" title="Open Image \(Ctrl\+O\)"/)
  })
})

describe('AppHeader: Export', () => {
  it('is unavailable without an image (aria-disabled, never disabled)', () => {
    const { tag, text } = exportButton(render(null, null))
    expect(text).toBe('Export')
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).toContain('title="Export — no image open"')
    expect(tag).not.toMatch(/\sdisabled(=|\s|>)/)
  })

  it('names the file it would save', () => {
    const { tag, text } = exportButton(render(null, null, { kind: 'ready', fileName: 'pump-station-cleaned.png' }))
    expect(text).toBe('Export')
    expect(tag).toContain('aria-disabled="false"')
    expect(tag).toContain('title="Export as PNG: pump-station-cleaned.png"')
  })

  it('says it is exporting, and is unavailable, while a file is written', () => {
    const { tag, text } = exportButton(render(null, null, { kind: 'running' }))
    expect(text).toBe('Exporting…')
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).toContain('title="Exporting the image as PNG…"')
  })
})
