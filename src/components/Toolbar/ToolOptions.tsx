import type { ToolId } from '../../editor/types'
import { MagicWandOptions, type MagicWandOptionsProps } from './MagicWandOptions'

interface ToolOptionsProps extends MagicWandOptionsProps {
  /** The active tool, whose options are shown; null (no image open) shows nothing. */
  activeTool: ToolId | null
}

/** The contextual second toolbar row: the active tool's options, if it has any. */
export function ToolOptions({ activeTool, ...magicWand }: ToolOptionsProps) {
  return activeTool === 'magic-wand' ? <MagicWandOptions {...magicWand} /> : null
}
