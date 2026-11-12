import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { AppHeader, type ExportStatus } from '../components/AppHeader/AppHeader'
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
  pendingCrop,
  sampledPixel,
  zoomAvailability,
} from '../editor/editorState'
import { adjustableDelete, availableEditActions, hasUnexportedEdits } from '../editor/editCommands'
import { canExport, exportFileName } from '../editor/exportCommands'
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
import type { CropPointerEvent } from '../components/Workspace/workspaceInput'
import { eyedropperClick } from '../editor/colourCommands'
import type { Rgba } from '../image/colour/colour'
import type { CropField } from '../image/crop/cropRectangle'
import type { EdgeSettings } from '../image/edit/deleteWithEdges'
import { createPointerPositionStore } from './pointerPosition'
import { useCropCommands } from './useCropCommands'
import { ModalGuardContext, createModalGuard } from './modalGuard'
import { useEditCommands } from './useEditCommands'
import { useExportCommand } from './useExportCommand'
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
  // Held while the colour picker is open (Phase 4 audit, M3).
  const [modals] = useState(createModalGuard)
  const { inputRef, openFilePicker, handleFileChange, openDroppedFiles, question, answerQuestion, isConfirming } =
    useImageImport(dispatch, shouldConfirmReplace, modals.isHeld)
  const [pointer] = useState(createPointerPositionStore)
  // While the replace confirmation or the colour picker is open, keyboard shortcuts belong to it.
  const isBlocked = useCallback(() => isConfirming() || modals.isHeld(), [isConfirming, modals])
  useSelectionShortcuts(stateRef, dispatch, isBlocked)
  const { run: runEditAction, commitEdgeSettings } = useEditCommands(stateRef, dispatch, isBlocked)
  const deleteSelection = useCallback(() => runEditAction('delete-selection'), [runEditAction])
  const autoTrim = useCallback(() => runEditAction('auto-trim'), [runEditAction])
  const applyCrop = useCallback(() => runEditAction('crop'), [runEditAction])
  // Enter applies and Escape cancels the crop rectangle (Phase 4).
  useCropCommands(stateRef, dispatch, isBlocked, runEditAction)
  const undo = useCallback(() => runEditAction('undo'), [runEditAction])
  const redo = useCallback(() => runEditAction('redo'), [runEditAction])
  const exportImage = useExportCommand(stateRef, dispatch, isBlocked)
  const cancelReplace = useCallback(() => answerQuestion(false), [answerQuestion])
  const continueReplace = useCallback(() => answerQuestion(true), [answerQuestion])
  const editActions = availableEditActions(state)
  const cropRect = pendingCrop(state)
  // Whether a finished change of the edge amounts updates the last Delete (Phase 3 Step 9).
  const adjustsLastDelete = adjustableDelete(state) !== null
  const exportStatus: ExportStatus = state.exporting
    ? { kind: 'running' }
    : !state.document
      ? { kind: 'unavailable' }
      : canExport(state)
        ? { kind: 'ready', fileName: exportFileName(state.document.name) }
        : { kind: 'importing' }

  const handleResize = useCallback(
    (workspace: WorkspaceMetrics) => dispatch({ type: 'workspace-resized', workspace }),
    [],
  )
  const dismissImportError = useCallback(() => dispatch({ type: 'import-error-dismissed' }), [])
  const dismissImportNotice = useCallback(() => dispatch({ type: 'import-notice-dismissed' }), [])
  const dismissEditError = useCallback(() => dispatch({ type: 'edit-error-dismissed' }), [])
  const dismissEditNotice = useCallback(() => dispatch({ type: 'edit-notice-dismissed' }), [])
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
  // Edge cleanup and feather while they are being adjusted: they set what the next Delete does and
  // compute nothing. A finished adjustment (commitEdgeSettings) also makes the last Delete again
  // while that Delete can still be adjusted (Phase 3 Step 9).
  const changeEdgeSettings = useCallback(
    (settings: Partial<EdgeSettings>) => dispatch({ type: 'edge-settings-changed', settings }),
    [],
  )
  // Auto Trim's padding only sets what the next Trim keeps; it never trims by itself.
  const changePadding = useCallback(
    (padding: number) => dispatch({ type: 'auto-trim-padding-changed', padding }),
    [],
  )
  // The crop rectangle is view state: dragging and typing it never touch pixels; only Apply Crop does.
  const changeCropField = useCallback(
    (field: CropField, value: number) => dispatch({ type: 'crop-field-changed', field, value }),
    [],
  )
  const cancelCrop = useCallback(() => dispatch({ type: 'crop-cancelled' }), [])
  const cropWithPointer = useCallback((event: CropPointerEvent) => {
    switch (event.type) {
      case 'start':
        return dispatch({ type: 'crop-drag-started', point: event.point })
      case 'move':
        return dispatch({ type: 'crop-dragged', point: event.point })
      case 'end':
        return dispatch({ type: 'crop-drag-ended' })
    }
  }, [])
  const runSelectionAction = useCallback((selectionAction: SelectionAction) => {
    // Computed here, outside the reducer, from the latest committed state and tagged with
    // the document version it used.
    const action = selectionActionCommand(stateRef.current, selectionAction)
    if (action) dispatch(action)
  }, [])
  // The colour picker's Apply. Choosing a colour never changes the image.
  const chooseColour = useCallback((colour: Rgba) => dispatch({ type: 'colour-chosen', colour }), [])
  const pressImage = useCallback((point: Point, press: PointerPress) => {
    const current = stateRef.current
    if (current.activeTool === 'eyedropper') {
      // Only the primary button reads a colour; computed here, outside the reducer, tagged with its version.
      const action = press.button === 0 ? eyedropperClick(current, point) : null
      if (action) dispatch(action)
      return
    }
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
      console.warn(
        editError.operation === 'export'
          ? `Export failed: ${editError.detail}`
          : `Edit failed (${editError.operation}): ${editError.detail}`,
      )
    }
  }, [editError])

  return (
    <ModalGuardContext.Provider value={modals}>
      <div className="app">
        <AppHeader
          onOpenImage={openFilePicker}
          undo={editActions.undo}
          redo={editActions.redo}
          onUndo={undo}
          onRedo={redo}
          exportStatus={exportStatus}
          onExport={exportImage}
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
            onEdgeSettingsCommit={commitEdgeSettings}
            adjustsLastDelete={adjustsLastDelete}
            canDeleteSelection={editActions.deleteSelection}
            onDeleteSelection={deleteSelection}
            padding={state.autoTrimPadding}
            onPaddingChange={changePadding}
            canAutoTrim={editActions.autoTrim}
            onAutoTrim={autoTrim}
            cropRect={cropRect}
            imageSize={state.document}
            canApplyCrop={editActions.crop}
            onCropFieldChange={changeCropField}
            onApplyCrop={applyCrop}
            onCancelCrop={cancelCrop}
            colour={state.colour}
            sampledPixel={sampledPixel(state)}
            onChooseColour={chooseColour}
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
          onDismissEditNotice={dismissEditNotice}
          onDismissNotice={dismissImportNotice}
          onDropFiles={openDroppedFiles}
          onOpenImage={openFilePicker}
          onWheelZoom={zoomWithWheel}
          onWheelPan={panWithWheel}
          onPanGesture={panWithDrag}
          crosshairPointer={state.activeTool === 'magic-wand' || state.activeTool === 'eyedropper'}
          cropActive={state.activeTool === 'crop'}
          cropRect={cropRect}
          onCropPointer={cropWithPointer}
          onImagePress={pressImage}
          onPointerPosition={pointer.set}
        />
        <StatusBar
          document={state.document}
          viewport={viewport}
          devicePixelRatio={state.workspace?.devicePixelRatio ?? 1}
          activeTool={state.activeTool}
          selection={state.selection}
          adjustsLastDelete={adjustsLastDelete}
          unexportedEdits={hasUnexportedEdits(state)}
          pointer={pointer}
          canZoomIn={zoomAvailability(state).zoomIn}
          canZoomOut={zoomAvailability(state).zoomOut}
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
    </ModalGuardContext.Provider>
  )
}

export default App
