import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ImageSource } from '../../editor/types'
import { DiscardEditsDialog } from './DiscardEditsDialog'

/* Markup checks for the replace confirmation (modality, focus and Escape are checked in real browsers). */

const noop = () => {}
const render = (imageName: string, source: ImageSource) =>
  renderToStaticMarkup(createElement(DiscardEditsDialog, { imageName, source, onCancel: noop, onContinue: noop }))

describe('DiscardEditsDialog', () => {
  it('is a dialog labelled by its title and described by its text', () => {
    const markup = render('photo.png', 'file-picker')
    const dialog = /<dialog class="confirm-dialog" aria-labelledby="([^"]+)" aria-describedby="([^"]+)">/.exec(markup)
    expect(dialog).not.toBeNull()
    expect(markup).toContain(`<h2 id="${dialog![1]}" class="confirm-dialog__title">Discard unexported edits?</h2>`)
    expect(markup).toContain(`<p id="${dialog![2]}" class="confirm-dialog__text">`)
    // Opened with showModal when mounted, so never rendered open (which would not be modal).
    expect(markup).not.toMatch(/<dialog[^>]* open/)
  })

  it('explains that the edits and Undo history will be discarded, naming the image, without mentioning saving', () => {
    const markup = render('photo.png', 'drop')
    expect(markup).toContain(
      'The current image has edits that have not been exported. Opening “photo.png” will replace it and discard those edits and its Undo history.',
    )
    expect(markup).not.toMatch(/sav(e|ed|ing)/i)
    expect(render('pasted-image-2026-11-04-101010.png', 'paste')).toContain('Opening the pasted image will replace it')
  })

  it('offers Cancel, then Continue', () => {
    const markup = render('a.png', 'file-picker')
    const buttons = [...markup.matchAll(/<button type="button" class="([^"]+)">([^<]+)<\/button>/g)].map(([, cls, label]) => [cls, label])
    expect(buttons).toEqual([
      ['button', 'Cancel'],
      ['button confirm-dialog__continue', 'Continue'],
    ])
  })
})
