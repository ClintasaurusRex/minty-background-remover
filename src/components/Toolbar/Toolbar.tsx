import { TOOLS } from '../../editor/tools'
import type { ToolId } from '../../editor/types'
import { ToolIcon } from '../icons/icons'
import './Toolbar.css'

interface ToolbarProps {
  /** The active tool, shown pressed. */
  activeTool: ToolId | null
  /** Tools work on the open image, so they are disabled until one is open. */
  imageOpen: boolean
  onSelectTool: (tool: ToolId) => void
}

export function Toolbar({ activeTool, imageOpen, onSelectTool }: ToolbarProps) {
  const hasUnavailableTools = TOOLS.some((tool) => !tool.available)

  return (
    <div className="toolbar" role="group" aria-label="Editing tools">
      <div className="toolbar__tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="toolbar__tool"
            disabled={!tool.available || !imageOpen}
            aria-pressed={tool.available ? tool.id === activeTool : undefined}
            title={toolTitle(tool.label, tool.description, tool.available, imageOpen)}
            onClick={() => onSelectTool(tool.id)}
          >
            <ToolIcon toolId={tool.id} />
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      {hasUnavailableTools && <p className="toolbar__note">More tools are coming in upcoming releases.</p>}
    </div>
  )
}

function toolTitle(label: string, description: string, available: boolean, imageOpen: boolean): string {
  if (!available) return `${label} — coming soon`
  return imageOpen ? description : `${description} — open an image first`
}
