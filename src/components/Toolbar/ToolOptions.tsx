import type { ToolId } from '../../editor/types'
import { AutoTrimOptions, type AutoTrimOptionsProps } from './AutoTrimOptions'
import { CropOptions, type CropOptionsProps } from './CropOptions'
import { EyedropperOptions, type EyedropperOptionsProps } from './EyedropperOptions'
import { MagicWandOptions, type MagicWandOptionsProps } from './MagicWandOptions'

interface ToolOptionsProps extends MagicWandOptionsProps, AutoTrimOptionsProps, CropOptionsProps, EyedropperOptionsProps {
  /** The active tool, whose options are shown; null (no image open) shows nothing. */
  activeTool: ToolId | null
}

/** The contextual second toolbar row: the active tool's options, if it has any. */
export function ToolOptions({
  activeTool,
  padding,
  onPaddingChange,
  canAutoTrim,
  onAutoTrim,
  cropRect,
  imageSize,
  canApplyCrop,
  onCropFieldChange,
  onApplyCrop,
  onCancelCrop,
  colour,
  sampledPixel,
  onChooseColour,
  ...magicWand
}: ToolOptionsProps) {
  switch (activeTool) {
    case 'magic-wand':
      return <MagicWandOptions {...magicWand} />
    case 'crop':
      return (
        <CropOptions
          cropRect={cropRect}
          imageSize={imageSize}
          canApplyCrop={canApplyCrop}
          onCropFieldChange={onCropFieldChange}
          onApplyCrop={onApplyCrop}
          onCancelCrop={onCancelCrop}
        />
      )
    case 'eyedropper':
      return <EyedropperOptions colour={colour} sampledPixel={sampledPixel} onChooseColour={onChooseColour} />
    case 'auto-trim':
      return (
        <AutoTrimOptions padding={padding} onPaddingChange={onPaddingChange} canAutoTrim={canAutoTrim} onAutoTrim={onAutoTrim} />
      )
    default:
      return null
  }
}
