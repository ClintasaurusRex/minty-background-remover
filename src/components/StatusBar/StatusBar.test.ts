import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LastDeleteNote, UnexportedEditsNote } from './StatusBar'

/*
 * Markup of the status bar's notes that the edge amounts update the last Delete (Phase 3 Step 9) and
 * that the image has unexported edits.
 * The status bar itself reads the pointer store with useSyncExternalStore, which cannot render on
 * the server; where the note appears is checked in the browsers (scripts/browser/edge-adjust.mjs).
 */

describe('LastDeleteNote', () => {
  it('says in text that a change of Edge cleanup or Feather updates the last Delete, after a divider, outside any live region', () => {
    const markup = renderToStaticMarkup(createElement(LastDeleteNote))
    expect(markup).toBe(
      '<span class="status-bar__divider status-bar__adjust" aria-hidden="true"></span>' +
        '<span class="status-bar__adjust" title="Changing Edge cleanup or Feather now updates the last Delete. Select something to set them for the next Delete instead.">Edge settings update last Delete</span>',
    )
    expect(markup).not.toContain('role=')
    expect(markup).not.toContain('aria-live')
  })
})

describe('UnexportedEditsNote', () => {
  it('says in text that the image has unexported edits, outside any live region', () => {
    const markup = renderToStaticMarkup(createElement(UnexportedEditsNote))
    expect(markup).toBe(
      '<span class="status-bar__unexported" title="This image has edits that have not been exported. Export saves them as a new PNG file.">Unexported edits</span>',
    )
  })
})
