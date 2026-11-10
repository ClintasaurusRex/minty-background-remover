import { type KeyboardEvent, type PointerEvent, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  DEFAULT_PICKER_COLOUR,
  describeColour,
  pickerColour,
  svAtPoint,
  svKey,
  svValueText,
  withAlpha,
  withHex,
  withHsv,
} from '../../editor/colourPicker'
import { type Rgba, cssColour, formatAlphaPercent, formatHex, formatRgba, hsvToRgb } from '../../image/colour/colour'
import './ColourPicker.css'

interface ColourPickerProps {
  /** The colour it opens with, kept exactly until changed; null opens with opaque white. */
  initial: Rgba | null
  /** The control that opened it: the picker is placed next to it, and focus returns to it. */
  anchorRef: RefObject<HTMLElement | null>
  /** Apply: the colour shown as New. */
  onApply: (colour: Rgba) => void
  /** Cancel or Escape: nothing changes. Should keep its identity (the dialog reopens when it changes). */
  onCancel: () => void
}

/**
 * A compact colour picker (Phase 4; UI_UX_SPEC.md, Colour Picker UX): a saturation / brightness area,
 * hue and alpha sliders, a hex field, the current and new colours side by side, and Cancel / Apply.
 *
 * A modal dialog (showModal), placed below the control that opened it: the rest of the page is inert
 * and its shortcuts do nothing, focus starts on the saturation / brightness area, Tab moves through
 * the controls, Escape cancels, and focus returns to the opening control when it closes. Keys never
 * reach the editor's shortcuts while it is open.
 *
 * Everything is keyboard operable: the area takes arrow keys (Shift for 10%), Page Up / Page Down,
 * Home and End; the sliders their usual keys; the hex field accepts #RGB, #RGBA, #RRGGBB or #RRGGBBAA
 * on Enter or leaving it (other text is restored; Escape restores an unfinished entry).
 */
export function ColourPicker({ initial, anchorRef, onApply, onCancel }: ColourPickerProps) {
  const start = initial ?? DEFAULT_PICKER_COLOUR
  const dialogRef = useRef<HTMLDialogElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const hexId = useId()
  const [colour, setColour] = useState(() => pickerColour(start))
  const [hexDraft, setHexDraft] = useState<string | null>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    placeNear(dialog, anchorRef.current)
    areaRef.current?.focus()
    const handleCancel = (event: Event) => {
      event.preventDefault()
      onCancel()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      // Closing while still in the page lets the browser return focus to the opening control.
      if (dialog.open) dialog.close()
    }
  }, [anchorRef, onCancel])

  const { rgba, hsv } = colour
  const hueColour = cssColour(hsvToRgb({ h: hsv.h, s: 1, v: 1 }))
  const opaque = cssColour({ ...rgba, a: 255 })

  const moveArea = (event: PointerEvent<HTMLDivElement>) => {
    const area = event.currentTarget
    const r = area.getBoundingClientRect()
    const { s, v } = svAtPoint({ x: event.clientX - r.left, y: event.clientY - r.top }, { width: r.width, height: r.height })
    setColour(withHsv(colour, { h: hsv.h, s, v }))
  }

  const commitHex = () => {
    if (hexDraft === null) return
    const next = withHex(colour, hexDraft)
    if (next) setColour(next)
    setHexDraft(null)
  }

  return (
    <dialog
      ref={dialogRef}
      className="colour-picker"
      aria-labelledby={titleId}
      // Keys belong to the picker: the editor's window shortcuts (Delete, Undo, Escape clearing the
      // selection) must not act behind it. The dialog's own Escape (cancel) is unaffected.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2 id={titleId} className="colour-picker__title">
        Choose a colour
      </h2>
      <div
        ref={areaRef}
        className="colour-picker__area"
        style={{ backgroundColor: hueColour }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={svValueText(hsv)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.focus()
          moveArea(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) moveArea(event)
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          const next = svKey(hsv, event.key, event.shiftKey)
          if (!next) return
          event.preventDefault()
          setColour(withHsv(colour, next))
        }}
      >
        <span className="colour-picker__thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} aria-hidden="true" />
      </div>
      <label className="colour-picker__slider-row">
        <span className="colour-picker__label">Hue</span>
        <input
          type="range"
          className="colour-picker__slider colour-picker__slider--hue"
          min={0}
          max={359}
          step={1}
          value={Math.round(hsv.h) % 360}
          aria-valuetext={`${Math.round(hsv.h) % 360}°`}
          onChange={(event) => setColour(withHsv(colour, { ...hsv, h: Number(event.currentTarget.value) }))}
        />
      </label>
      <label className="colour-picker__slider-row">
        <span className="colour-picker__label">Alpha</span>
        <span className="colour-picker__alpha-track checkerboard">
          <input
            type="range"
            className="colour-picker__slider colour-picker__slider--alpha"
            style={{ backgroundImage: `linear-gradient(to right, transparent, ${opaque})` }}
            min={0}
            max={255}
            step={1}
            value={rgba.a}
            aria-valuetext={`${formatAlphaPercent(rgba.a)} (${rgba.a} of 255)`}
            onChange={(event) => setColour(withAlpha(colour, Number(event.currentTarget.value)))}
          />
        </span>
      </label>
      <div className="colour-picker__values">
        <label className="colour-picker__hex" htmlFor={hexId}>
          <span className="colour-picker__label">Hex</span>
        </label>
        <input
          id={hexId}
          type="text"
          className="colour-picker__hex-input"
          value={hexDraft ?? formatHex(rgba)}
          aria-label="Hex colour, #RRGGBB or #RRGGBBAA"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setHexDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitHex()
            } else if (event.key === 'Escape' && hexDraft !== null) {
              // Cancels the unfinished entry only; a second Escape cancels the picker.
              event.preventDefault()
              setHexDraft(null)
            }
          }}
          onBlur={commitHex}
        />
      </div>
      <output className="colour-picker__rgba" aria-label={`RGBA ${formatRgba(rgba)}, alpha ${formatAlphaPercent(rgba.a)}`}>
        RGBA {formatRgba(rgba)} · Alpha {formatAlphaPercent(rgba.a)}
      </output>
      <div className="colour-picker__compare" aria-hidden="true">
        <span className="colour-picker__label">Current</span>
        <span className="colour-picker__swatch checkerboard" title={describeColour(start)}>
          <span style={{ backgroundColor: cssColour(start) }} />
        </span>
        <span className="colour-picker__label">New</span>
        <span className="colour-picker__swatch checkerboard" title={describeColour(rgba)}>
          <span style={{ backgroundColor: cssColour(rgba) }} />
        </span>
      </div>
      <div className="colour-picker__actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button colour-picker__apply" onClick={() => onApply(rgba)}>
          Apply
        </button>
      </div>
    </dialog>
  )
}

/** Places the open dialog just below `anchor`, kept inside the window; centred without one. */
function placeNear(dialog: HTMLDialogElement, anchor: HTMLElement | null) {
  if (!anchor) return
  const gap = 6
  const margin = 8
  const a = anchor.getBoundingClientRect()
  const d = dialog.getBoundingClientRect()
  const below = a.bottom + gap
  const top = below + d.height <= window.innerHeight - margin ? below : Math.max(margin, a.top - gap - d.height)
  const left = Math.min(Math.max(margin, a.left), Math.max(margin, window.innerWidth - margin - d.width))
  dialog.style.margin = '0'
  dialog.style.top = `${top}px`
  dialog.style.left = `${left}px`
}
