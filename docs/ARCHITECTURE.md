# Minty Background Remover Architecture

`PROJECT_BRIEF.md` is the highest-level source of truth.

---

## Technology Stack

Initial stack:

```text
React
Vite
TypeScript
Plain CSS
HTML Canvas 2D
Vitest
```

Future desktop packaging:

```text
Tauri
```

---

## Architecture Goals

The architecture should:

- Keep image-processing logic independent from React where practical.
- Remain understandable.
- Avoid unnecessary dependencies.
- Support both web and future desktop builds.
- Keep all image processing local.
- Allow algorithm testing without rendering React components.
- Remain responsive with modern images.
- Avoid premature abstraction.

---

## Application Layers

Preferred conceptual structure:

```text
UI Layer
    ↓
Editor State / Commands
    ↓
Image Processing Functions
    ↓
Canvas / ImageData
```

React components should primarily manage:

- UI
- Tool state
- User interactions
- Presentation
- Command invocation

Pixel algorithms should not depend heavily on React.

---

## Suggested Source Structure

This structure is directional rather than mandatory.

```text
src/
├── app/
│   ├── App.tsx
│   └── app.css
│
├── components/
│   ├── Toolbar/
│   ├── Workspace/
│   ├── ToolOptions/
│   ├── ColorPicker/
│   └── StatusBar/
│
├── editor/
│   ├── types.ts
│   ├── editorState.ts
│   ├── commands/
│   └── history/
│
├── image/
│   ├── selection/
│   ├── crop/
│   ├── trim/
│   ├── colour/
│   ├── transforms/
│   └── export/
│
├── canvas/
│   ├── viewport.ts
│   ├── coordinates.ts
│   └── rendering.ts
│
├── hooks/
│
├── utils/
│
└── test/
```

Do not create directories merely because they appear here.

Create structure when functionality requires it.

---

## React Responsibilities

React should manage things such as:

- Active tool
- Tool options
- Dialog visibility
- Current zoom
- Current application state
- Toolbar state
- User feedback

React should not perform expensive per-pixel work directly during rendering.

---

## Canvas Responsibilities

Canvas is responsible for:

- Displaying raster image data
- Presenting zoomed image content
- Image rendering
- Selection visualisation where appropriate

Zoom and pan must remain separate from actual image dimensions.

---

## Image Processing

Image-processing modules should preferably expose pure or mostly pure functions.

Example:

```ts
magicWand(imageData, startPoint, options)
```

rather than:

```ts
magicWand(componentState, canvasElement, DOMEvent, ...)
```

This improves:

- Testing
- Maintainability
- Reuse
- Debugging

---

## TypeScript

Avoid unnecessary use of:

```ts
any
```

Important concepts should use explicit types.

Examples:

```ts
Point
Rectangle
RGBAColor
SelectionMask
ToolId
CropState
ViewportState
ImageDocument
HistoryEntry
```

---

## State Management

Do not add Redux, Zustand, MobX, or another external state library during early development without a demonstrated need.

Begin with appropriate React state, reducers, and plain TypeScript modules.

Introduce a state library only if application complexity clearly justifies it.

---

## CSS

Use plain CSS.

Do not add:

- Tailwind
- Bootstrap
- Material UI
- CSS-in-JS frameworks

unless the project owner explicitly changes this decision.

Use a maintainable CSS organisation with variables for recurring values.

Potential CSS variables include:

```css
--color-bg
--color-surface
--color-border
--color-text
--color-muted
--color-accent
--radius-sm
--radius-md
--space-sm
--space-md
```

---

## External Dependencies

Dependencies should be kept minimal.

Before adding a production dependency, consider:

1. Is this difficult to implement correctly ourselves?
2. Is the dependency actively maintained?
3. Is it lightweight enough?
4. Does it create lock-in?
5. Does it work in web and Tauri?
6. Does it respect local-only processing?

Examples of dependencies that may eventually be justified:

- Compact React colour picker
- SVG tracing library
- Tauri packages

The image editor should not become dependent on a large graphics framework without strong justification.

---

## Testing

Use Vitest for image algorithm unit tests.

React component testing may be added where useful.

Algorithms should be tested separately from UI.

---

## Desktop Architecture

The web application remains the core frontend.

Tauri should later wrap the same application.

Platform-specific desktop features may include:

- Native file dialogs
- Remembered file paths
- Native Save As
- Last export directory
- Application menu integration

Core image-processing algorithms must not depend on Tauri APIs.

---

## Browser Compatibility

Target modern evergreen browsers.

The application does not need to support obsolete browsers.

---

## Persistence

Initial web application should avoid unnecessary persistent storage.

Potential local preferences may eventually include:

- Last Magic Wand tolerance
- Last Auto Trim padding
- UI preferences

Browser storage may be used later for small preferences.

Images should not be permanently stored in browser storage by default.

---

## Security and Privacy

Do not transmit image contents.

Avoid remote scripts.

Avoid analytics.

Avoid dependencies that unexpectedly perform remote processing.

All file handling should remain local.

---

## Web Workers

Do not start with Web Workers unless needed.

When large image operations begin causing noticeable UI stalls, evaluate moving pure processing functions into workers.

The architecture should make that migration possible by keeping image algorithms independent of React.

---

## Error Boundaries

Unexpected UI errors should eventually be handled gracefully.

Image-processing failures should not silently corrupt the working document.

---

## Git Architecture Rules

Agents may inspect Git.

Agents must not modify repository history or create commits unless explicitly authorised by the project owner.

See `AGENTS.md`.
