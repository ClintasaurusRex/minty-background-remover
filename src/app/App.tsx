import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader/AppHeader'
import { DiscardEditsDialog } from '../components/DiscardEditsDialog/DiscardEditsDialog'
import { StatusBar } from '../components/StatusBar/StatusBar'
import { ToolOptions } from '../components/Toolbar/ToolOptions'
import { Toolbar } from '../components/Toolbar/Toolbar'
import { Workspace } from '../components/Workspace/Workspace'
import {
  type WorkspaceMetrics,
  displayViewport,
  editorReducer,
  initialEditorState,
  isImporting,
} from '../editor/editorState'
import { availableEditActions, hasUnexportedEdits } from '../editor/editCommands'
import type { PanGestureEffect } from '../editor/panGesture'
import {
  type PointerPress,
  type SelectionAction,
  availableSelectionActions,
  clickSelectionMode,
  commitToleranceCommand,
  magicWandClick,
  selectionActionCommand,
} from '../editor/selectionCommands'
import type { FloodMode, Point, SelectionMode, ToolId } from '../editor/types'
import type { EdgeSettings } from '../image/edit/deleteWithEdges'
import { createPointerPositionStore } from './pointerPosition'
import { useEditCommands } from './useEditCommands'
import { IMAGE_FILE_ACCEPT, useImageImport } from './useImageImport'
import { useSelectionShortcuts } from './useSelectionShortcuts'
import './App.css'

function App() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  const viewport = displayViewport(state)

  // The latest committed state, for input handlers that compute from it (Magic Wand
  // clicks, selection and edit shortcuts) without being re-created on every change.
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  })
  // Read when an import is about to replace the open image (P3-D12).
  const shouldConfirmReplace = useCallback(() => hasUnexportedEdits(stateRef.current), [])
  const { inputRef, openFilePicker, handleFileChange, openDroppedFiles, question, answerQuestion, isConfirming } =
    useImageImport(dispatch, shouldConfirmReplace)
  const [pointer] = useState(createPointerPositionStore)
  // While the replace confirmation is open, keyboard shortcuts belong to it.
  useSelectionShortcuts(stateRef, dispatch, isConfirming)
  const runEditAction = useEditCommands(stateRef, dispatch, isConfirming)
  const deleteSelection = useCallback(() => runEditAction('delete-selection'), [runEditAction])
  const undo = useCallback(() => runEditAction('undo'), [runEditAction])
  const redo = useCallback(() => runEditAction('redo'), [runEditAction])
  const cancelReplace = useCallback(() => answerQuestion(false), [answerQuestion])
  const continueReplace = useCallback(() => answerQuestion(true), [answerQuestion])
  const editActions = availableEditActions(state)

  const handleResize = useCallback(
    (workspace: WorkspaceMetrics) => dispatch({ type: 'workspace-resized', workspace }),
    [],
  )
  const dismissImportError = useCallback(() => dispatch({ type: 'import-error-dismissed' }), [])
  const dismissImportNotice = useCallback(() => dispatch({ type: 'import-notice-dismissed' }), [])
  const dismissEditError = useCallback(() => dispatch({ type: 'edit-error-dismissed' }), [])
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
  // Magic Wand options apply to the next click. Only a committed tolerance (below) changes
  // the current selection, by re-applying the last click.
  const changeSelectionMode = useCallback(
    (selectionMode: SelectionMode) => dispatch({ type: 'magic-wand-selection-mode-changed', selectionMode }),
    [],
  )
  const changeFloodMode = useCallback(
    (floodMode: FloodMode) => dispatch({ type: 'magic-wand-flood-mode-changed', floodMode }),
    [],
  )
  const changeTolerance = useCallback(
    (tolerance: number) => dispatch({ type: 'magic-wand-tolerance-changed', tolerance }),
    [],
  )
  const commitTolerance = useCallback((tolerance: number) => {
    // A re-applied click is computed here, outside the reducer, from the latest committed
    // state and only when its tolerance differs; the reducer discards it if anything has
    // changed the selection or the image since.
    for (const action of commitToleranceCommand(stateRef.current, tolerance)) dispatch(action)
  }, [])
  // Edge cleanup and feather apply to the next Delete only; changing them computes nothing.
  const changeEdgeSettings = useCallback(
    (settings: Partial<EdgeSettings>) => dispatch({ type: 'edge-settings-changed', settings }),
    [],
  )
  const runSelectionAction = useCallback((selectionAction: SelectionAction) => {
    // Computed here, outside the reducer, from the latest committed state and tagged with
    // the document version it used.
    const action = selectionActionCommand(stateRef.current, selectionAction)
    if (action) dispatch(action)
  }, [])
  const pressImage = useCallback((point: Point, press: PointerPress) => {
    const current = stateRef.current
    const mode = clickSelectionMode(press, current.magicWand.selectionMode)
    if (!mode) return
    // Computed here, outside the reducer, and tagged with the document version it used.
    const action = magicWandClick(current, point, mode)
    if (action) dispatch(action)
  }, [])

  // Developer detail (sizes, causes) is kept out of the UI but logged in development.
  const { importError, editError } = state
  useEffect(() => {
    if (import.meta.env.DEV && importError?.detail) {
      console.warn(`Import failed (${importError.code}): ${importError.detail}`)
    }
  }, [importError])
  useEffect(() => {
    if (import.meta.env.DEV && editError?.detail) {
      console.warn(`Edit failed (${editError.operation}): ${editError.detail}`)
    }
  }, [editError])

  return (
    <div className="app">
      <AppHeader
        onOpenImage={openFilePicker}
        undo={editActions.undo}
        redo={editActions.redo}
        onUndo={undo}
        onRedo={redo}
      />
      <div className="app__toolbars">
        <Toolbar activeTool={state.activeTool} imageOpen={state.document !== null} onSelectTool={selectTool} />
        <ToolOptions
          activeTool={state.activeTool}
          settings={state.magicWand}
          availableActions={availableSelectionActions(state)}
          onSelectionModeChange={changeSelectionMode}
          onFloodModeChange={changeFloodMode}
          onToleranceChange={changeTolerance}
          onToleranceCommit={commitTolerance}
          onSelectionAction={runSelectionAction}
          edgeSettings={state.edgeSettings}
          onEdgeSettingsChange={changeEdgeSettings}
          canDeleteSelection={editActions.deleteSelection}
          onDeleteSelection={deleteSelection}
        />
      </div>
      <Workspace
        document={state.document}
        documentBitmap={state.documentBitmap}
        selection={state.selection}
        viewport={viewport}
        workspace={state.workspace}
        importing={isImporting(state)}
        importError={state.importError}
        importNotice={state.importNotice}
        editError={state.editError}
        editNotice={state.editNotice}
        editFeedbackId={state.editFeedbackId}
        onResize={handleResize}
        onDismissError={dismissImportError}
        onDismissEditError={dismissEditError}
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
      {question && (
        <DiscardEditsDialog
          imageName={question.name}
          source={question.source}
          onCancel={cancelReplace}
          onContinue={continueReplace}
        />
      )}
    </div>
  )
}

export default App
