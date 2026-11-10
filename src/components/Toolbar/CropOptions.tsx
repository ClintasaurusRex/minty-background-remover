import { useState } from 'react'
import { applyCropTitle } from '../../editor/cropCommands'
import { type CropField, cropFieldMaximum, wholeImageRect } from '../../image/crop/cropRectangle'
import { type ToleranceFieldEvent, initialToleranceFieldState, toleranceFieldEvent } from '../../editor/toleranceInput'
import type { Rectangle, Size } from '../../editor/types'
import { CloseIcon, CropIcon } from '../icons/icons'
import './ToolOptions.css'

export interface CropOptionsProps {
  /** The crop rectangle in image pixels (pendingCrop), or null when none has been chosen. */
  cropRect: Rectangle | null
  /** The open image's size; null without an image. */
  imageSize: Size | null
  /** Whether Apply Crop can run now (availableEditActions().crop). */
  canApplyCrop: boolean
  /** A field typed or stepped: X and Y move the rectangle, Width and Height resize it. */
  onCropFieldChange: (field: CropField, value: number) => void
  /** Crops the image to the rectangle (Enter does the same). */
  onApplyCrop: () => void
  /** Removes the rectangle without changing the image (Escape does the same). */
  onCancelCrop: () => void
}

const FIELDS: readonly { field: CropField; label: string; name: string; title: string }[] = [
  { field: 'x', label: 'X', name: 'Crop left edge X', title: 'Left edge of the area to keep, in image pixels' },
  { field: 'y', label: 'Y', name: 'Crop top edge Y', title: 'Top edge of the area to keep, in image pixels' },
  { field: 'width', label: 'W', name: 'Crop width', title: 'Width of the area to keep, in image pixels' },
  { field: 'height', label: 'H', name: 'Crop height', title: 'Height of the area to keep, in image pixels' },
]

/**
 * The Crop tool's contextual options (Phase 4; FEATURE_SPEC.md §11), shown as a second toolbar row
 * while it is the active tool: the rectangle's position and size in image pixels, editable from the
 * keyboard, then Apply Crop and Cancel. Without a rectangle the fields show the whole image, and
 * editing one starts a rectangle from it.
 *
 * Only Apply Crop changes the image. The fields follow the tolerance field's conventions
 * (toleranceInput.ts): a whole number within range applies as it is typed; other text waits for
 * Enter or leaving the field, when a number is rounded and clamped and anything else restores the
 * value; Up / Down step by 1 and Page Up / Page Down by 10; Escape cancels an unfinished entry. Enter
 * in a field never crops.
 */
export function CropOptions({ cropRect, imageSize, canApplyCrop, onCropFieldChange, onApplyCrop, onCancelCrop }: CropOptionsProps) {
  if (!imageSize) return null
  const rect = cropRect ?? wholeImageRect(imageSize)
  const applyTitle = applyCropTitle(cropRect, imageSize, canApplyCrop)
  return (
    <div className="tool-options" role="group" aria-label="Crop options">
      <div className="tool-options__group tool-options__crop-fields" role="group" aria-label="Area to keep">
        {FIELDS.map(({ field, label, name, title }) => (
          <CropFieldControl
            key={field}
            label={label}
            name={name}
            title={title}
            value={rect[field]}
            min={field === 'width' || field === 'height' ? 1 : 0}
            max={cropFieldMaximum(rect, field, imageSize)}
            onChange={(value) => onCropFieldChange(field, value)}
          />
        ))}
        <span className="tool-options__unit" aria-hidden="true">
          px
        </span>
      </div>
      {!cropRect && <span className="tool-options__hint">Drag on the image to choose the area to keep</span>}
      <div className="tool-options__group">
        {/* aria-disabled keeps focus on them when they become unavailable; their labels never change. */}
        <button
          type="button"
          className="button tool-options__action tool-options__apply-crop"
          aria-disabled={!canApplyCrop}
          title={applyTitle}
          onClick={() => {
            if (canApplyCrop) onApplyCrop()
          }}
        >
          <CropIcon />
          Apply Crop
        </button>
        <button
          type="button"
          className="button tool-options__action tool-options__cancel-crop"
          aria-disabled={!cropRect}
          title={cropRect ? 'Remove the crop rectangle without changing the image (Esc)' : 'Cancel — there is no crop rectangle'}
          onClick={() => {
            if (cropRect) onCancelCrop()
          }}
        >
          <CloseIcon />
          Cancel
        </button>
      </div>
    </div>
  )
}

interface CropFieldControlProps {
  label: string
  name: string
  title: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

/** One position or size field, with its visible label. Its accessible name gives the range. */
function CropFieldControl({ label, name, title, value, min, max, onChange }: CropFieldControlProps) {
  const [field, setField] = useState(() => initialToleranceFieldState(value))
  const range = { max, pageStep: 10 }

  const handleField = (event: ToleranceFieldEvent, keyEvent?: { preventDefault(): void }) => {
    const result = toleranceFieldEvent(field, event, value, range)
    if (result.handled) keyEvent?.preventDefault()
    if (result.state !== field) setField(result.state)
    // The editor rounds and clamps (setCropField); a width or height of 0 becomes 1.
    if (result.change !== undefined && result.change !== value) onChange(result.change)
    if (result.commit !== undefined && result.commit !== value) onChange(result.commit)
  }

  return (
    <label className="tool-options__crop-field" title={title}>
      <span className="tool-options__label" aria-hidden="true">
        {label}
      </span>
      <input
        type="text"
        inputMode="numeric"
        className="tool-options__number tool-options__number--crop"
        value={field.draft ?? String(value)}
        aria-label={`${name} in pixels, ${min} to ${max}`}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => handleField({ type: 'focus' })}
        onChange={(event) => handleField({ type: 'input', text: event.currentTarget.value })}
        onKeyDown={(event) => handleField({ type: 'key-down', key: event.key }, event)}
        onKeyUp={(event) => handleField({ type: 'key-up', key: event.key })}
        onBlur={() => handleField({ type: 'blur' })}
      />
    </label>
  )
}
