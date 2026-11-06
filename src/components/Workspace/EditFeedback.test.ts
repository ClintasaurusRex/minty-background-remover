import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EditError, EditNotice } from '../../editor/editorState'
import { EditErrorMessage } from './EditErrorMessage'
import { Workspace } from './Workspace'

/* Markup checks for how edit outcomes are shown and announced in the workspace. */

const noop = () => {}
function renderWorkspace(editError: EditError | null, editNotice: EditNotice | null) {
  return renderToStaticMarkup(
    createElement(Workspace, {
      document: null,
      documentBitmap: null,
      selection: null,
      viewport: null,
      workspace: null,
      importing: false,
      importError: null,
      importNotice: null,
      editError,
      editNotice,
      editFeedbackId: 3,
      onResize: noop,
      onDismissError: noop,
      onDismissEditError: noop,
      onDismissNotice: noop,
      onDropFiles: noop,
      onOpenImage: noop,
      onWheelZoom: noop,
      onWheelPan: noop,
      onPanGesture: noop,
      magicWandActive: false,
      onImagePress: noop,
      onPointerPosition: noop,
    }),
  )
}

describe('edit feedback in the workspace', () => {
  it('announces a successful edit in a polite, visually hidden status region', () => {
    const markup = renderWorkspace(null, { kind: 'applied', operation: 'delete-selection', changedPixels: 31428 })
    expect(markup).toContain('<div class="visually-hidden" role="status"><span>Selection deleted: 31,428 pixels are now transparent.</span></div>')
  })

  it('keeps the region, empty, when there is nothing to announce', () => {
    expect(renderWorkspace(null, null)).toContain('<div class="visually-hidden" role="status"></div>')
  })

  it('shows a failure as a dismissible alert, with the edit message', () => {
    const markup = renderWorkspace({ operation: 'undo', detail: 'RangeError: Array buffer allocation failed' }, null)
    expect(markup).toContain('class="workspace-message workspace-message--error" role="alert"')
    expect(markup).toContain(
      'Undo could not be completed. The image and selection have not changed. There may not be enough memory for an image this large.',
    )
    expect(markup).not.toContain('RangeError')
    expect(markup).toContain('<span class="visually-hidden">Dismiss message</span>')
  })

  it('EditErrorMessage alone', () => {
    const markup = renderToStaticMarkup(createElement(EditErrorMessage, { error: { operation: 'delete-selection' }, onDismiss: noop }))
    expect(markup).toContain('The selected pixels could not be deleted. The image and selection have not changed.')
  })
})
