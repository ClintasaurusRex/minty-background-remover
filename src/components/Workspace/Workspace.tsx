import { EmptyState } from './EmptyState'
import './Workspace.css'

export function Workspace() {
  return (
    <main className="workspace" aria-label="Image workspace">
      <EmptyState />
    </main>
  )
}
