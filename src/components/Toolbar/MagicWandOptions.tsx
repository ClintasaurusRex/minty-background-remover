import { type KeyboardEvent, useId, useRef, useState } from 'react'
import type { MagicWandSettings } from '../../editor/editorState'
import type { SelectionAction } from '../../editor/selectionCommands'
import { committedToleranceInput, exactToleranceInput, steppedTolerance } from '../../editor/toleranceInput'
import type { FloodMode, SelectionMode } from '../../editor/types'
import { MAX_TOLERANCE } from '../../image/selection/colourDistance'
import './ToolOptions.css'

export interface MagicWandOptionsProps {
  settings: MagicWandSettings
  /** Which selection actions would change anything; the others are shown disabled. */
  availableActions: Readonly<Record<SelectionAction, boolean>>
  onSelectionModeChange: (mode: SelectionMode) => void
  onFloodModeChange: (mode: FloodMode) => void
  /** Any finite number; the editor rounds and clamps it to 0–100. */
  onToleranceChange: (tolerance: number) => void
  onSelectionAction: (action: SelectionAction) => void
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

/**
 * The Magic Wand's contextual options, shown as a second toolbar row while it is the
 * active tool. Options apply to the next Magic Wand click and never change the current
 * selection; the selection actions change it at once.
 */
export function MagicWandOptions({
  settings,
  availableActions,
  onSelectionModeChange,
  onFloodModeChange,
  onToleranceChange,
  onSelectionAction,
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
      <ToleranceControl tolerance={settings.tolerance} onChange={onToleranceChange} />
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

/**
 * A slider and a text field for the same tolerance. The slider applies every movement.
 * The text field applies a whole number from 0 to 100 as it is typed, so the slider
 * follows; anything else waits until Enter or leaving the field, when a number is
 * rounded and clamped and other text restores the current tolerance. Escape restores
 * the tolerance from before editing started.
 */
function ToleranceControl({ tolerance, onChange }: { tolerance: number; onChange: (tolerance: number) => void }) {
  const labelId = useId()
  // The text being typed, or null to show the current tolerance.
  const [draft, setDraft] = useState<string | null>(null)
  const toleranceBeforeEditing = useRef(tolerance)

  const commit = () => {
    if (draft === null) return
    const value = committedToleranceInput(draft)
    if (value !== null) onChange(value)
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit()
      return
    }
    if (event.key === 'Escape') {
      // Handled here, so Escape does not also clear the selection.
      event.preventDefault()
      onChange(toleranceBeforeEditing.current)
      setDraft(null)
      return
    }
    const stepped = steppedTolerance(committedToleranceInput(draft ?? '') ?? tolerance, event.key)
    if (stepped !== null) {
      event.preventDefault()
      onChange(stepped)
      setDraft(null)
    }
  }

  return (
    <div className="tool-options__group tool-options__tolerance">
      <span id={labelId} className="tool-options__label">
        Tolerance
      </span>
      <input
        type="range"
        className="tool-options__slider"
        min={0}
        max={MAX_TOLERANCE}
        step={1}
        value={tolerance}
        aria-labelledby={labelId}
        title="How different a colour can be and still be selected (0–100)"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <input
        type="text"
        inputMode="numeric"
        className="tool-options__number"
        value={draft ?? String(tolerance)}
        aria-label="Tolerance value, 0 to 100"
        title="Tolerance (0–100)"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          toleranceBeforeEditing.current = tolerance
        }}
        onChange={(event) => {
          const text = event.currentTarget.value
          setDraft(text)
          const exact = exactToleranceInput(text)
          if (exact !== null) onChange(exact)
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
