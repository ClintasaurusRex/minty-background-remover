import { useEffect, useId, useRef, useState } from 'react'
import type { MagicWandSettings } from '../../editor/editorState'
import type { SelectionAction } from '../../editor/selectionCommands'
import {
  type ToleranceFieldEvent,
  type ToleranceSliderEvent,
  EDGE_PIXEL_RANGE,
  NO_KEYS_HELD,
  finishAdjustment,
  initialToleranceFieldState,
  toleranceFieldEvent,
  toleranceSliderEvent,
} from '../../editor/toleranceInput'
import type { FloodMode, SelectionMode } from '../../editor/types'
import type { EdgeSettings } from '../../image/edit/deleteWithEdges'
import { MAX_TOLERANCE } from '../../image/selection/colourDistance'
import { DeleteIcon } from '../icons/icons'
import './ToolOptions.css'

export interface MagicWandOptionsProps {
  settings: MagicWandSettings
  /** Which selection actions would change anything; the others are shown disabled. */
  availableActions: Readonly<Record<SelectionAction, boolean>>
  onSelectionModeChange: (mode: SelectionMode) => void
  onFloodModeChange: (mode: FloodMode) => void
  /**
   * The tolerance while it is being adjusted (every slider movement, typed whole numbers).
   * Any finite number; the editor rounds and clamps it to 0–100.
   */
  onToleranceChange: (tolerance: number) => void
  /**
   * A finished tolerance adjustment (slider released, key released, typed value entered):
   * the editor sets it and re-applies the last Magic Wand click if the tolerance differs
   * from the one that click's selection was made with.
   */
  onToleranceCommit: (tolerance: number) => void
  onSelectionAction: (action: SelectionAction) => void
  /** Edge cleanup and feather amounts (0–5 px) the next Delete Selection uses. */
  edgeSettings: EdgeSettings
  /** An edge cleanup or feather amount while it is being adjusted: it sets what the next Delete does. */
  onEdgeSettingsChange: (settings: Partial<EdgeSettings>) => void
  /**
   * A finished edge amount adjustment (slider released, last key released, Enter, leaving the
   * control): it sets the amount and, while the last Delete can be adjusted, makes it again.
   */
  onEdgeSettingsCommit: (settings: Partial<EdgeSettings>) => void
  /**
   * Whether a finished adjustment of the amounts updates the last Delete (just made, with nothing
   * selected since) rather than only setting them for the next one (Phase 3 Step 9).
   */
  adjustsLastDelete: boolean
  /** Whether Delete Selection can run: something is selected (and no other image is opening). */
  canDeleteSelection: boolean
  /** Makes the selected pixels transparent (the Delete key does the same). */
  onDeleteSelection: () => void
}

interface Choice<T> {
  readonly value: T
  readonly label: string
  readonly title: string
}

const SELECTION_MODES: readonly Choice<SelectionMode>[] = [
  { value: 'new', label: 'New', title: 'New selection: a click replaces the selection' },
  { value: 'add', label: 'Add', title: 'Add to the selection (or hold Shift while clicking)' },
  { value: 'subtract', label: 'Subtract', title: 'Subtract from the selection (or hold Ctrl while clicking)' },
]

const FLOOD_MODES: readonly Choice<FloodMode>[] = [
  { value: 'contiguous', label: 'Contiguous', title: 'Select similar colours connected to the clicked pixel' },
  { value: 'global', label: 'Global', title: 'Select similar colours anywhere in the image' },
]

const ACTIONS: readonly { action: SelectionAction; label: string; name: string; title: string }[] = [
  { action: 'select-all', label: 'Select All', name: 'Select All', title: 'Select the whole image (Ctrl+A)' },
  { action: 'clear', label: 'Clear', name: 'Clear Selection', title: 'Clear the selection (Esc)' },
  { action: 'invert', label: 'Invert', name: 'Invert Selection', title: 'Select everything that is not selected' },
  { action: 'grow', label: 'Grow', name: 'Grow Selection', title: 'Grow the selection by 1 pixel' },
  { action: 'shrink', label: 'Shrink', name: 'Shrink Selection', title: 'Shrink the selection by 1 pixel' },
]

const DELETE_TITLE = 'Make the selected pixels transparent (Delete)'

const EDGE_CLEANUP_WHAT =
  'remove the background colour left in edge pixels, up to this many pixels in from the deleted area (0–5 px; 0 = off)'
const FEATHER_WHAT =
  'fade the edge over this many pixels in from the deleted area; thin lines and small text are kept (0–5 px; 0 = off)'

/** The tooltip of an edge amount: what it does, and whether it applies to the next Delete or updates the last one. */
function edgeAmountTitle(label: string, what: string, adjustsLastDelete: boolean): string {
  return adjustsLastDelete ? `${label}, updating the last Delete: ${what}` : `${label} for the next Delete: ${what}`
}

/**
 * The Magic Wand's contextual options, shown as a second toolbar row while it is the
 * active tool. Options apply to the next Magic Wand click; a finished tolerance adjustment
 * also re-applies the last click. The selection actions change the selection at once.
 * Delete Selection, last, edits the image: it makes the selected pixels transparent, then
 * applies the edge cleanup and feather amounts shown just before it (both 0 by default). Right
 * after a Delete, with nothing selected since, a finished change of those amounts updates that
 * Delete instead (Phase 3 Step 9).
 */
export function MagicWandOptions({
  settings,
  availableActions,
  onSelectionModeChange,
  onFloodModeChange,
  onToleranceChange,
  onToleranceCommit,
  onSelectionAction,
  edgeSettings,
  onEdgeSettingsChange,
  onEdgeSettingsCommit,
  adjustsLastDelete,
  canDeleteSelection,
  onDeleteSelection,
}: MagicWandOptionsProps) {
  return (
    <div className="tool-options" role="group" aria-label="Magic Wand options">
      <Segmented
        label="Selection mode"
        choices={SELECTION_MODES}
        value={settings.selectionMode}
        onChange={onSelectionModeChange}
      />
      <Segmented label="Flood mode" choices={FLOOD_MODES} value={settings.floodMode} onChange={onFloodModeChange} />
      <ToleranceControl tolerance={settings.tolerance} onChange={onToleranceChange} onCommit={onToleranceCommit} />
      <div className="tool-options__group" role="group" aria-label="Selection actions">
        {ACTIONS.map(({ action, label, name, title }) => {
          const available = availableActions[action]
          return (
            <button
              key={action}
              type="button"
              className="button tool-options__action"
              // aria-disabled rather than disabled keeps keyboard focus on a button that
              // becomes unavailable when pressed (Clear, Select All, Shrink to nothing).
              aria-disabled={!available}
              aria-label={name}
              title={available ? title : `${title} — nothing to change`}
              onClick={() => {
                if (available) onSelectionAction(action)
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
      <EdgeAmountControl
        setting="cleanup"
        label="Edge cleanup"
        fieldLabel="Edge cleanup in pixels, 0 to 5"
        title={edgeAmountTitle('Edge cleanup', EDGE_CLEANUP_WHAT, adjustsLastDelete)}
        value={edgeSettings.cleanup}
        onChange={onEdgeSettingsChange}
        onCommit={onEdgeSettingsCommit}
      />
      <EdgeAmountControl
        setting="feather"
        label="Feather"
        fieldLabel="Feather in pixels, 0 to 5"
        title={edgeAmountTitle('Feather', FEATHER_WHAT, adjustsLastDelete)}
        value={edgeSettings.feather}
        onChange={onEdgeSettingsChange}
        onCommit={onEdgeSettingsCommit}
      />
      <div className="tool-options__group">
        {/* Its label and size never change, so the row never re-wraps when it becomes available. */}
        <button
          type="button"
          className="button tool-options__action tool-options__delete"
          aria-disabled={!canDeleteSelection}
          aria-keyshortcuts="Delete"
          title={canDeleteSelection ? DELETE_TITLE : `${DELETE_TITLE} — nothing to delete`}
          onClick={() => {
            if (canDeleteSelection) onDeleteSelection()
          }}
        >
          <DeleteIcon />
          Delete Selection
        </button>
      </div>
    </div>
  )
}

/** Mutually exclusive options as a row of toggle buttons; the chosen one is pressed. */
function Segmented<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string
  choices: readonly Choice<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="tool-options__group tool-options__segmented" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className="tool-options__choice"
          aria-pressed={choice.value === value}
          title={choice.title}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}

interface ToleranceControlProps {
  tolerance: number
  onChange: (tolerance: number) => void
  onCommit: (tolerance: number) => void
}

/**
 * A slider and a text field for the same tolerance. The slider applies every movement.
 * The text field applies a whole number from 0 to 100 as it is typed, so the slider
 * follows; anything else waits until Enter or leaving the field, when a number is
 * rounded and clamped and other text restores the current tolerance. Escape cancels an
 * unfinished entry.
 *
 * Finished adjustments are committed (see toleranceInput.ts): releasing the slider,
 * releasing the last arrow or Page key on either control, Enter or leaving either control.
 * Only a commit re-applies the last Magic Wand click, so dragging or typing never does.
 */
function ToleranceControl({ tolerance, onChange, onCommit }: ToleranceControlProps) {
  const labelId = useId()
  const sliderRef = useRef<HTMLInputElement>(null)
  // Adjustment keys held on the slider; read by the native change listener, so not render state.
  const sliderKeys = useRef(NO_KEYS_HELD)
  const [field, setField] = useState(() => initialToleranceFieldState(tolerance))

  const handleSlider = (event: ToleranceSliderEvent, value: number) => {
    const result = toleranceSliderEvent(sliderKeys.current, event)
    sliderKeys.current = result.held
    if (result.commit) onCommit(value)
  }

  // React's onChange reports every movement of the slider (the input event). The native
  // change event reports a committed value: the thumb released, or a value set by assistive
  // technology.
  useEffect(() => {
    const slider = sliderRef.current
    if (!slider) return
    const handleChange = () => {
      const result = toleranceSliderEvent(sliderKeys.current, { type: 'change' })
      sliderKeys.current = result.held
      if (result.commit) onCommit(Number(slider.value))
    }
    slider.addEventListener('change', handleChange)
    return () => slider.removeEventListener('change', handleChange)
  }, [onCommit])

  const handleField = (event: ToleranceFieldEvent, keyEvent?: { preventDefault(): void }) => {
    const result = toleranceFieldEvent(field, event, tolerance)
    if (result.handled) keyEvent?.preventDefault()
    if (result.state !== field) setField(result.state)
    if (result.change !== undefined) onChange(result.change)
    if (result.commit !== undefined) onCommit(result.commit)
  }

  return (
    <div className="tool-options__group tool-options__tolerance">
      <span id={labelId} className="tool-options__label">
        Tolerance
      </span>
      <input
        ref={sliderRef}
        type="range"
        className="tool-options__slider"
        min={0}
        max={MAX_TOLERANCE}
        step={1}
        value={tolerance}
        aria-labelledby={labelId}
        title="How different a colour can be and still be selected (0–100)"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onPointerDown={(event) => handleSlider({ type: 'pointer-down' }, Number(event.currentTarget.value))}
        onKeyDown={(event) => handleSlider({ type: 'key-down', key: event.key }, Number(event.currentTarget.value))}
        onKeyUp={(event) => handleSlider({ type: 'key-up', key: event.key }, Number(event.currentTarget.value))}
        onBlur={(event) => handleSlider({ type: 'blur' }, Number(event.currentTarget.value))}
      />
      <input
        type="text"
        inputMode="numeric"
        className="tool-options__number"
        value={field.draft ?? String(tolerance)}
        aria-label="Tolerance value, 0 to 100"
        title="Tolerance (0–100)"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => handleField({ type: 'focus' })}
        onChange={(event) => handleField({ type: 'input', text: event.currentTarget.value })}
        onKeyDown={(event) => handleField({ type: 'key-down', key: event.key }, event)}
        onKeyUp={(event) => handleField({ type: 'key-up', key: event.key })}
        onBlur={() => handleField({ type: 'blur' })}
      />
    </div>
  )
}

interface EdgeAmountControlProps {
  /** Which amount this control sets. */
  setting: keyof EdgeSettings
  /** Visible label, also the slider's accessible name. */
  label: string
  /** The text field's accessible name, with the unit and range. */
  fieldLabel: string
  title: string
  /** Whole pixels, 0–5. */
  value: number
  /** The amount while it is being adjusted. */
  onChange: (settings: Partial<EdgeSettings>) => void
  /** A finished adjustment, with the amount committed. */
  onCommit: (settings: Partial<EdgeSettings>) => void
}

/**
 * A slider and a text field for one Delete edge amount, in whole pixels from 0 to 5, built like
 * the tolerance control: the slider applies every movement, and the text field applies a whole
 * number from 0 to 5 as it is typed, other text on Enter or leaving it (rounded and clamped, or
 * restored if it is not a number); Up / Down step by 1; Escape cancels an unfinished entry.
 *
 * Also like the tolerance control, adjustments are finished only when the slider is released, the
 * last arrow, Page, Home or End key is released, on Enter, or when focus leaves either control
 * (see toleranceInput.ts), and nothing is computed while adjusting. Unlike the tolerance, a
 * finished adjustment is committed (and can make the last Delete again, Phase 3 Step 9) only when
 * it ends on another amount than the interaction started from (finishAdjustment): moving focus
 * through the controls, or changing the amount and back before finishing, never edits the image.
 * Otherwise the amount is only set again (so Escape restores it).
 */
function EdgeAmountControl({ setting, label, fieldLabel, title, value, onChange, onCommit }: EdgeAmountControlProps) {
  const labelId = useId()
  const sliderRef = useRef<HTMLInputElement>(null)
  // Adjustment keys held on the slider; read by the native change listener, so not render state.
  const sliderKeys = useRef(NO_KEYS_HELD)
  // The amount when the current interaction began (focus, a slider press, the previous finished
  // adjustment). Shared by the slider and the field, which show the same amount.
  const start = useRef(value)
  const [field, setField] = useState(() => initialToleranceFieldState(value))
  const amount = (pixels: number): Partial<EdgeSettings> => (setting === 'cleanup' ? { cleanup: pixels } : { feather: pixels })

  const finish = (pixels: number) => {
    const result = finishAdjustment(start.current, pixels)
    start.current = result.start
    if (result.changed) onCommit(amount(pixels))
    else onChange(amount(pixels))
  }

  const handleSlider = (event: ToleranceSliderEvent, pixels: number) => {
    const result = toleranceSliderEvent(sliderKeys.current, event)
    sliderKeys.current = result.held
    if (result.commit) finish(pixels)
    // A pointer press starts a new adjustment from the amount shown (after finishing any keyboard one).
    if (event.type === 'pointer-down') start.current = pixels
  }

  // React's onChange reports every movement of the slider (the input event). The native change
  // event reports a finished value: the thumb released, or a value set by assistive technology.
  useEffect(() => {
    const slider = sliderRef.current
    if (!slider) return
    const handleChange = () => {
      const result = toleranceSliderEvent(sliderKeys.current, { type: 'change' })
      sliderKeys.current = result.held
      if (!result.commit) return
      const pixels = Number(slider.value)
      const finished = finishAdjustment(start.current, pixels)
      start.current = finished.start
      const settings: Partial<EdgeSettings> = setting === 'cleanup' ? { cleanup: pixels } : { feather: pixels }
      if (finished.changed) onCommit(settings)
      else onChange(settings)
    }
    slider.addEventListener('change', handleChange)
    return () => slider.removeEventListener('change', handleChange)
  }, [onCommit, onChange, setting])

  const handleField = (event: ToleranceFieldEvent, keyEvent?: { preventDefault(): void }) => {
    const result = toleranceFieldEvent(field, event, value, EDGE_PIXEL_RANGE)
    if (result.handled) keyEvent?.preventDefault()
    if (result.state !== field) setField(result.state)
    if (result.change !== undefined) onChange(amount(result.change))
    if (result.commit !== undefined) finish(result.commit)
  }

  return (
    <div className="tool-options__group tool-options__amount">
      <span id={labelId} className="tool-options__label">
        {label}
      </span>
      <input
        ref={sliderRef}
        type="range"
        className="tool-options__slider tool-options__slider--amount"
        min={0}
        max={EDGE_PIXEL_RANGE.max}
        step={1}
        value={value}
        aria-labelledby={labelId}
        aria-valuetext={`${value} px`}
        title={title}
        onChange={(event) => onChange(amount(Number(event.currentTarget.value)))}
        onFocus={(event) => {
          start.current = Number(event.currentTarget.value)
        }}
        onPointerDown={(event) => handleSlider({ type: 'pointer-down' }, Number(event.currentTarget.value))}
        onKeyDown={(event) => handleSlider({ type: 'key-down', key: event.key }, Number(event.currentTarget.value))}
        onKeyUp={(event) => handleSlider({ type: 'key-up', key: event.key }, Number(event.currentTarget.value))}
        onBlur={(event) => handleSlider({ type: 'blur' }, Number(event.currentTarget.value))}
      />
      <input
        type="text"
        inputMode="numeric"
        className="tool-options__number tool-options__number--amount"
        value={field.draft ?? String(value)}
        aria-label={fieldLabel}
        title={title}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          start.current = value
          handleField({ type: 'focus' })
        }}
        onChange={(event) => handleField({ type: 'input', text: event.currentTarget.value })}
        onKeyDown={(event) => handleField({ type: 'key-down', key: event.key }, event)}
        onKeyUp={(event) => handleField({ type: 'key-up', key: event.key })}
        onBlur={() => handleField({ type: 'blur' })}
      />
      <span className="tool-options__unit" aria-hidden="true">
        px
      </span>
    </div>
  )
}
