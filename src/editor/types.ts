/** Identifiers for the editing tools planned for the main toolbar. */
export type ToolId = 'magic-wand' | 'crop' | 'replace-color' | 'auto-trim'

export interface ToolDefinition {
  id: ToolId
  /** User-facing label (Canadian English). */
  label: string
  description: string
  /** False until the tool is implemented in its assigned phase. */
  available: boolean
}
