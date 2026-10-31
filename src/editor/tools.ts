import type { ToolDefinition } from './types'

/** Primary tools, in toolbar order. Tools become available in their assigned phase. */
export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'magic-wand',
    label: 'Magic Wand',
    description: 'Select areas of similar colour',
    available: true,
  },
  {
    id: 'crop',
    label: 'Crop',
    description: 'Crop the image to a rectangle',
    available: false,
  },
  {
    id: 'replace-color',
    label: 'Replace Colour',
    description: 'Swap one colour for another',
    available: false,
  },
  {
    id: 'auto-trim',
    label: 'Auto Trim',
    description: 'Remove empty transparent space around the image',
    available: false,
  },
]
