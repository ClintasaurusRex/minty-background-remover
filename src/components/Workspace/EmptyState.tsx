import { ImageIcon, OpenIcon } from '../icons/icons'

const SUPPORTED_FORMATS = ['PNG', 'JPEG', 'WebP', 'SVG']

interface EmptyStateProps {
  onOpenImage: () => void
}

export function EmptyState({ onOpenImage }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <div className="empty-state__icon">
        <ImageIcon />
      </div>
      <h2 id="empty-state-title" className="empty-state__title">
        No image open
      </h2>
      <p className="empty-state__text">
        Open, drop or paste an image to remove its background and tidy it up.
      </p>
      <button type="button" className="button" onClick={onOpenImage} aria-keyshortcuts="Control+O">
        <OpenIcon />
        Open Image
      </button>
      <ul className="empty-state__formats" aria-label="Supported file formats">
        {SUPPORTED_FORMATS.map((format) => (
          <li key={format}>{format}</li>
        ))}
      </ul>
    </section>
  )
}
