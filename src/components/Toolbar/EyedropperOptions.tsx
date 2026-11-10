import { useCallback, useRef, useState } from 'react'
import { describeColour } from '../../editor/colourPicker'
import type { ChosenColour } from '../../editor/editorState'
import type { PixelCoordinate } from '../../editor/types'
import { type Rgba, cssColour, formatAlphaPercent, formatHex, formatRgba } from '../../image/colour/colour'
import { ColourPicker } from '../ColourPicker/ColourPicker'
import './ToolOptions.css'

export interface EyedropperOptionsProps {
  /** The colour read by the Eyedropper or set with the colour picker, or null before either. */
  colour: ChosenColour | null
  /** The pixel it was read from while that is still the image shown (sampledPixel), else null. */
  sampledPixel: PixelCoordinate | null
  /** The colour picker's Apply. */
  onChooseColour: (colour: Rgba) => void
}

/**
 * The Eyedropper's contextual options (Phase 4; FEATURE_SPEC.md §12): the colour last read from the
 * image, as a swatch (over a checkerboard, so alpha shows), hex (#RRGGBB, or #RRGGBBAA when not
 * opaque), its four RGBA values, alpha as a percentage and the pixel it came from. The swatch opens
 * the colour picker to adjust it or type another. Nothing here changes the image.
 *
 * Each new reading is announced once (a polite status region keyed by the reading).
 */
export function EyedropperOptions({ colour, sampledPixel, onChooseColour }: EyedropperOptionsProps) {
  const swatchRef = useRef<HTMLButtonElement>(null)
  const [picking, setPicking] = useState(false)
  const value = colour?.value ?? null
  const cancel = useCallback(() => setPicking(false), [])
  const apply = useCallback(
    (chosen: Rgba) => {
      setPicking(false)
      onChooseColour(chosen)
    },
    [onChooseColour],
  )
  const where = sampledPixel ? `pixel ${sampledPixel.x}, ${sampledPixel.y}` : null

  return (
    <div className="tool-options" role="group" aria-label="Eyedropper options">
      <div className="tool-options__group tool-options__colour">
        <span className="tool-options__label" aria-hidden="true">
          Colour
        </span>
        <button
          ref={swatchRef}
          type="button"
          className="tool-options__swatch checkerboard"
          aria-haspopup="dialog"
          aria-label={value ? `Edit colour ${describeColour(value)} in the colour picker` : 'Choose a colour in the colour picker'}
          title={value ? 'Adjust this colour, or type another, in the colour picker' : 'Choose a colour in the colour picker'}
          onClick={() => setPicking(true)}
        >
          <span style={value ? { backgroundColor: cssColour(value) } : undefined} className={value ? undefined : 'tool-options__swatch-empty'} />
        </button>
        {value ? (
          <>
            <output className="tool-options__hex" title="Hex: #RRGGBB, or #RRGGBBAA when not fully opaque">
              {formatHex(value)}
            </output>
            <output className="tool-options__rgba" title="Red, green, blue and alpha, each 0–255">
              RGBA {formatRgba(value)}
            </output>
            <output className="tool-options__alpha" title="Alpha: 0% is fully transparent, 100% fully opaque">
              Alpha {formatAlphaPercent(value.a)}
            </output>
            {where && <span className="tool-options__hint">from {where}</span>}
          </>
        ) : (
          <span className="tool-options__hint">Click the image to read a pixel’s colour</span>
        )}
      </div>
      <div className="visually-hidden" role="status">
        {colour && where && (
          <span key={`${where}:${formatHex(colour.value)}:${colour.sample?.version.revision}`}>
            Colour read from {where}: {describeColour(colour.value)}.
          </span>
        )}
      </div>
      {picking && <ColourPicker initial={value} anchorRef={swatchRef} onApply={apply} onCancel={cancel} />}
    </div>
  )
}
