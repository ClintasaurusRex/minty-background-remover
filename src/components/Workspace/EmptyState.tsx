import { ImageIcon } from '../icons/icons'

const PLANNED_FORMATS = ['PNG', 'JPEG', 'WebP', 'SVG']

export function EmptyState() {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <div className="empty-state__icon">
        <ImageIcon />
      </div>
      <h2 id="empty-state-title" className="empty-state__title">
        No image open
      </h2>
      <p className="empty-state__text">
        Opening images isn’t available yet. Soon you’ll be able to open, drag in,
        or paste an image here to remove its background and tidy it up.
      </p>
      <ul className="empty-state__formats" aria-label="Planned file formats">
        {PLANNED_FORMATS.map((format) => (
          <li key={format}>{format}</li>
        ))}
      </ul>
    </section>
  )
}
