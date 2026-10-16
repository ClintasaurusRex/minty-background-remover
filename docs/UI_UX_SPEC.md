# Minty Background Remover UI / UX Specification

`PROJECT_BRIEF.md` is the highest-level source of truth.

---

## Design Goals

The interface should feel:

- Modern
- Dark
- Focused
- Clear
- Lightweight
- Professional

It should not imitate Paint.NET visually.

The goal is to make common image-cleanup workflows obvious without requiring the user to learn a complex graphics application.

---

## Primary Layout

The image workspace should occupy the majority of the application window.

Preferred general layout:

```text
┌──────────────────────────────────────────────────────┐
│ App / file actions / undo / redo / export           │
├──────────────────────────────────────────────────────┤
│                                                      │
│                    TOOLBAR                           │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│                                                      │
│                 IMAGE WORKSPACE                      │
│                                                      │
│                                                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Tool options / image info / zoom                     │
└──────────────────────────────────────────────────────┘
```

The exact final composition may evolve during implementation.

---

## Toolbar

The primary editing toolbar should use:

- Icon
- Tool name
- Shortcut hint when useful

Examples:

```text
Magic Wand
Crop
Eyedropper
Replace Colour
Auto Trim
Resize
Rotate
Flip
```

Tool names should remain visible rather than relying exclusively on icons.

---

## Responsive Behaviour

The interface must remain usable on:

- Typical laptop screens
- Standard desktop monitors
- Large ultrawide monitors

The workspace should scale to consume available room.

Controls should not become excessively stretched on ultrawide displays.

---

## Input Model

Primary input:

- Mouse
- Keyboard

Touch optimisation is not required.

---

## Dark Theme

The initial application uses a dark UI.

Requirements:

- Adequate text contrast
- Distinguishable control states
- Clearly visible focus states
- Selection overlays that remain visible over both dark and light images

---

## Transparency Display

Transparent regions should use a standard checkerboard appearance.

The checkerboard is a UI representation only.

It must not become part of exported image pixels.

---

## Tool State

The currently active tool must be visually obvious.

Example states:

```text
Default
Hover
Active
Disabled
Keyboard focus
```

---

## Magic Wand UX

When active, users should have access to settings such as:

```text
Tolerance
Contiguous / Global
Add
Subtract
Grow
Shrink
Invert
```

The interface should not expose unnecessary technical terminology.

---

## Selection UX

Selected pixels should be clearly visible.

Preferred combination:

- Transparent overlay
- Clear perimeter
- Optional marching-ants animation

Selection visuals should remain understandable when zoomed in.

Reduced-motion users must still have a clear non-animated selection indicator.

---

## Crop UX

When crop is active:

- User drags crop area.
- Outside region becomes visually dimmed.
- Crop handles become available.
- Dimensions appear.
- Enter applies.
- Escape cancels.

Crop should feel direct and predictable.

---

## Colour Picker UX

Colour selection should open a compact colour picker UI.

Desired features:

- Visual colour area
- Hue selection
- Alpha where relevant
- HEX input
- Current colour preview
- Confirm
- Cancel

Avoid a complicated professional colour-management interface.

---

## Replace Colour UX

Replace Colour should make the workflow easy to understand.

Example:

```text
FROM
[#A1A1A1]

TO
[#FFFFFF]

Tolerance
[------●------]

[Preview]

[Apply]
```

Where practical, the user should see changes before permanently applying them.

---

## Auto Trim UX

Auto Trim should be a highly visible action because it is part of the primary workflow.

Example:

```text
Auto Trim

Padding:
[0] [5] [10] [20] [Custom]

[Trim]
```

Default:

```text
5 px
```

A **Trim Tight** shortcut may use 0 px.

After deleting a background, Auto Trim may be surfaced prominently because it is a common next action.

---

## Zoom UX

Required controls:

```text
−
100%
+
Fit
```

Current zoom should be visible.

Ctrl + mouse wheel should zoom relative to the pointer position where practical.

---

## Pan UX

Holding:

```text
Space
```

temporarily activates pan.

Dragging then moves the image viewport.

The cursor should change appropriately.

---

## Undo / Redo

Undo and Redo should always be easy to reach.

Toolbar controls:

```text
Undo
Redo
```

Shortcuts:

```text
Ctrl + Z
Ctrl + Y
```

Disabled state should be clear when history is unavailable.

---

## Keyboard Shortcuts

Potential shortcuts include:

```text
Ctrl + O       Open
Ctrl + S       Export / Save As where appropriate
Ctrl + Z       Undo
Ctrl + Y       Redo
Ctrl + A       Select All
Ctrl + V       Paste Image
Delete         Delete Selection
Escape         Cancel / Clear Selection
Enter          Confirm current operation
Space + Drag   Pan
Ctrl + Wheel   Zoom
```

Shortcuts must not interfere with text entry controls.

---

## Accessibility

Accessibility is a product requirement.

Requirements include:

- Keyboard reachable controls
- Visible keyboard focus
- Semantic buttons
- Appropriate labels
- Tooltips where useful
- Sufficient colour contrast
- Avoid colour-only state communication
- Respect reduced-motion preferences where practical

Animated selection indicators should not be the sole way selection is communicated.

---

## User Feedback

Long-running image operations should provide feedback.

Possible states:

```text
Processing…
Exporting…
Vectorising…
```

Avoid blocking the browser UI unnecessarily.

Heavy operations may later be moved to Web Workers if profiling shows this is necessary.

---

## Error Handling

Errors should use clear human-readable messages.

Examples:

```text
This image could not be opened.
```

```text
The selected file type is not supported.
```

```text
The image is too large to process safely.
```

Avoid exposing raw internal errors unless useful for development.

---

## Destructive Operations

Actions that change pixels should normally be undoable.

The original imported file should not be automatically overwritten.

---

## Empty State

When no image is loaded, the workspace should provide a clear starting point.

Example:

```text
Drop an image here

or

[Open Image]

PNG • JPEG • WebP • SVG
```

Clipboard paste may also be mentioned.

---

## Visual Complexity Rule

Do not fill the interface with controls for features that are not currently relevant.

Contextual controls are preferred.

For example:

- Magic Wand settings appear while Magic Wand is active.
- Crop controls appear while Crop is active.
- Colour options appear during colour operations.

The interface should remain focused.
