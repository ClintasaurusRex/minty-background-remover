import { useId, useState } from 'react'
import { AUTO_TRIM_PADDING_PRESETS, AUTO_TRIM_PADDING_RANGE, paddingFieldEvent } from '../../editor/autoTrimPadding'
import { type ToleranceFieldEvent, initialToleranceFieldState } from '../../editor/toleranceInput'
import { AutoTrimIcon } from '../icons/icons'
import './ToolOptions.css'

export interface AutoTrimOptionsProps {
  /** Auto Trim's padding, whole pixels from 0 to 50. */
  padding: number
  /**
   * A new padding: a preset pressed, a whole number typed, Enter or leaving the field, an arrow
   * step. Any finite number; the editor rounds and clamps it to 0–50. Never trims.
   */
  onPaddingChange: (padding: number) => void
  /** Whether Trim can run: an image is open and no other image is opening. */
  canAutoTrim: boolean
  /** Trims the image with the padding shown. */
  onAutoTrim: () => void
}

/** Trim's tooltip: what it does with the padding shown. */
function trimTitle(padding: number): string {
  return padding === 0
    ? 'Trim the image to its visible pixels, removing all the transparent space around them'
    : `Trim the image to its visible pixels with ${padding} px of padding on each side, where the image has that much`
}

/**
 * Auto Trim's contextual options (Phase 3 Step 11), shown as a second toolbar row while it is the
 * active tool: the padding, as quick presets (0, 5, 10, 20 px) and a text field for any whole
 * number from 0 to 50, then Trim, the one control that changes the image. Changing the padding
 * never trims; it only sets what the next Trim keeps.
 */
export function AutoTrimOptions({ padding, onPaddingChange, canAutoTrim, onAutoTrim }: AutoTrimOptionsProps) {
  const title = trimTitle(padding)
  return (
    <div className="tool-options" role="group" aria-label="Auto Trim options">
      <PaddingControl padding={padding} onChange={onPaddingChange} />
      <div className="tool-options__group">
        {/* aria-disabled keeps focus on it while another image opens; its label and size never change. */}
        <button
          type="button"
          className="button tool-options__action tool-options__trim"
          aria-disabled={!canAutoTrim}
          title={canAutoTrim ? title : `${title} — not available while another image is opening`}
          onClick={() => {
            if (canAutoTrim) onAutoTrim()
          }}
        >
          <AutoTrimIcon />
          Trim
        </button>
      </div>
    </div>
  )
}

interface PaddingControlProps {
  padding: number
  onChange: (padding: number) => void
}

/**
 * The padding: presets as toggle buttons (the one equal to the padding is pressed; none for other
 * amounts) and a text field with the unit. The field follows the tolerance field's conventions
 * (toleranceInput.ts) with the range 0–50: a whole number from 0 to 50 applies as it is typed;
 * other text waits for Enter or leaving the field, when a number is rounded and clamped and
 * anything else restores the padding; Up / Down step by 1 and Page Up / Page Down by 10; Escape
 * cancels an unfinished entry. Since changing the padding computes nothing, every change and
 * every finished entry simply sets it.
 */
function PaddingControl({ padding, onChange }: PaddingControlProps) {
  const labelId = useId()
  const [field, setField] = useState(() => initialToleranceFieldState(padding))

  const handleField = (event: ToleranceFieldEvent, keyEvent?: { preventDefault(): void }) => {
    const result = paddingFieldEvent(field, event, padding)
    if (result.handled) keyEvent?.preventDefault()
    if (result.state !== field) setField(result.state)
    if (result.change !== undefined) onChange(result.change)
    if (result.commit !== undefined) onChange(result.commit)
  }

  return (
    <div className="tool-options__group tool-options__padding" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="tool-options__label">
        Padding
      </span>
      <div className="tool-options__segmented" role="group" aria-label="Padding presets">
        {AUTO_TRIM_PADDING_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="tool-options__choice"
            aria-pressed={preset === padding}
            aria-label={`${preset} px`}
            title={preset === 0 ? 'No padding: trim tight to the visible pixels' : `${preset} px of padding`}
            onClick={() => onChange(preset)}
          >
            {preset}
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="numeric"
        className="tool-options__number tool-options__number--padding"
        value={field.draft ?? String(padding)}
        aria-label={`Padding in pixels, 0 to ${AUTO_TRIM_PADDING_RANGE.max}`}
        title={`Transparent space kept around the visible pixels on each side (0–${AUTO_TRIM_PADDING_RANGE.max} px)`}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => handleField({ type: 'focus' })}
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
