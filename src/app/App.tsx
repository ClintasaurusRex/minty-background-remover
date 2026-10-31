import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
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
import { type PointerPress, clickSelectionMode, magicWandClick } from '../editor/selectionCommands'
import type { Point, ToolId } from '../editor/types'
import { createPointerPositionStore } from './pointerPosition'
import { IMAGE_FILE_ACCEPT, useImageImport } from './useImageImport'
import { useSelectionShortcuts } from './useSelectionShortcuts'
import './App.css'

function App() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  const { inputRef, openFilePicker, handleFileChange, openDroppedFiles } = useImageImport(dispatch)
  const viewport = displayViewport(state)

  // The latest committed state, for input handlers that compute from it (Magic Wand
  // clicks, selection shortcuts) without being re-created on every change.
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  const [pointer] = useState(createPointerPositionStore)
  useSelectionShortcuts(stateRef, dispatch)

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

  const selectTool = useCallback((tool: ToolId) => dispatch({ type: 'tool-selected', tool }), [])
  const pressImage = useCallback((point: Point, press: PointerPress) => {
    const current = stateRef.current
    const mode = clickSelectionMode(press, current.magicWand.selectionMode)
    if (!mode) return
    // Computed here, outside the reducer, and tagged with the document version it used.
    const action = magicWandClick(current, point, mode)
    if (action) dispatch(action)
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
      <Toolbar activeTool={state.activeTool} imageOpen={state.document !== null} onSelectTool={selectTool} />
      <Workspace
        document={state.document}
        documentBitmap={state.documentBitmap}
        selection={state.selection}
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
        magicWandActive={state.activeTool === 'magic-wand'}
        onImagePress={pressImage}
        onPointerPosition={pointer.set}
      />
      <StatusBar
        document={state.document}
        viewport={viewport}
        devicePixelRatio={state.workspace?.devicePixelRatio ?? 1}
        activeTool={state.activeTool}
        selection={state.selection}
        pointer={pointer}
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
