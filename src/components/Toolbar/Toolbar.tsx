import { TOOLS } from '../../editor/tools'
import { ToolIcon } from '../icons/icons'
import './Toolbar.css'

export function Toolbar() {
  const hasUnavailableTools = TOOLS.some((tool) => !tool.available)

  return (
    <div className="toolbar" role="group" aria-label="Editing tools">
      <div className="toolbar__tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="toolbar__tool"
            disabled={!tool.available}
            title={tool.available ? tool.description : `${tool.label} — coming soon`}
          >
            <ToolIcon toolId={tool.id} />
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      {hasUnavailableTools && (
        <p className="toolbar__note">Editing tools are coming in upcoming releases.</p>
      )}
    </div>
  )
}
