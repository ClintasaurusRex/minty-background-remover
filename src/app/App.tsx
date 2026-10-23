import { useCallback, useEffect, useReducer } from 'react'
import { AppHeader } from '../components/AppHeader/AppHeader'
import { StatusBar } from '../components/StatusBar/StatusBar'
import { Toolbar } from '../components/Toolbar/Toolbar'
import { Workspace } from '../components/Workspace/Workspace'
import {
  type WorkspaceMetrics,
  displayViewport,
  editorReducer,
  initialEditorState,
  isImporting,
} from '../editor/editorState'
import type { PanGestureEffect } from '../editor/panGesture'
import type { Point } from '../editor/types'
import { IMAGE_FILE_ACCEPT, useImageImport } from './useImageImport'
import './App.css'

function App() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  const { inputRef, openFilePicker, handleFileChange, openDroppedFiles } = useImageImport(dispatch)
  const viewport = displayViewport(state)

  const handleResize = useCallback(
    (workspace: WorkspaceMetrics) => dispatch({ type: 'workspace-resized', workspace }),
    [],
  )
  const dismissImportError = useCallback(() => dispatch({ type: 'import-error-dismissed' }), [])
  const dismissImportNotice = useCallback(() => dispatch({ type: 'import-notice-dismissed' }), [])
  const zoomWithWheel = useCallback(
    (anchor: Point, factor: number) => dispatch({ type: 'zoom-scaled', anchor, factor }),
    [],
  )
  const panWithWheel = useCallback((delta: Point) => dispatch({ type: 'wheel-panned', delta }), [])
  const panWithDrag = useCallback((effect: PanGestureEffect) => {
    switch (effect.type) {
      case 'drag-started':
        return dispatch({ type: 'pan-drag-started' })
      case 'dragged':
        return dispatch({ type: 'pan-dragged', delta: effect.delta })
      case 'drag-ended':
        return dispatch({ type: 'pan-drag-ended' })
    }
  }, [])

  // Developer detail (sizes, causes) is kept out of the UI but logged in development.
  const { importError } = state
  useEffect(() => {
    if (import.meta.env.DEV && importError?.detail) {
      console.warn(`Import failed (${importError.code}): ${importError.detail}`)
    }
  }, [importError])

  return (
    <div className="app">
      <AppHeader onOpenImage={openFilePicker} />
      <Toolbar />
      <Workspace
        document={state.document}
        documentBitmap={state.documentBitmap}
        viewport={viewport}
        workspace={state.workspace}
        importing={isImporting(state)}
        importError={state.importError}
        importNotice={state.importNotice}
        onResize={handleResize}
        onDismissError={dismissImportError}
        onDismissNotice={dismissImportNotice}
        onDropFiles={openDroppedFiles}
        onOpenImage={openFilePicker}
        onWheelZoom={zoomWithWheel}
        onWheelPan={panWithWheel}
        onPanGesture={panWithDrag}
      />
      <StatusBar
        document={state.document}
        zoom={viewport?.zoom ?? null}
        onZoomIn={() => dispatch({ type: 'zoom-stepped', direction: 1 })}
        onZoomOut={() => dispatch({ type: 'zoom-stepped', direction: -1 })}
        onFit={() => dispatch({ type: 'zoom-fitted' })}
        onActualSize={() => dispatch({ type: 'zoom-actual-size' })}
      />
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        hidden
        tabIndex={-1}
        onChange={handleFileChange}
      />
    </div>
  )
}

export default App
