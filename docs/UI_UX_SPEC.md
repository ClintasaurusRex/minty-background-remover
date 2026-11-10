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
│        contextual tool options (second row)          │
├──────────────────────────────────────────────────────┤
│                                                      │
│                                                      │
│                 IMAGE WORKSPACE                      │
│                                                      │
│                                                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│ Status: image info / pointer / selection / zoom      │
└──────────────────────────────────────────────────────┘
```

The exact final composition may evolve during implementation.

Tool options appear in a compact contextual second row of the toolbar while the tool is active. The bottom bar is a compact status bar.

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

Tools work on the open image, so available tools are disabled until an image is open. Tools that are not available yet stay disabled with a "coming soon" tooltip. The active tool is shown pressed (`aria-pressed`), with a tinted background and border so the state is not colour-only. In Phase 2 the Magic Wand is the only available tool; while it is active over an image, the pointer is a crosshair. Auto Trim is available too since Phase 3 Step 11 (below); while it is active, clicks on the image do nothing and the pointer is the ordinary one.

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

The checkerboard uses neutral dark greys to suit the dark theme. It is drawn only inside the image boundaries.

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

The Magic Wand becomes the active tool when an image is successfully opened.

While it is active, a compact second toolbar row shows its options:

```text
New / Add / Subtract
Contiguous / Global
Tolerance (slider and number, 0–100, default 20)
Grow
Shrink
Invert
```

- The row preserves the approved dark layout, sizing, styling and responsive behaviour, and wraps on narrow windows.
- New / Add / Subtract are visible controls, so modifier keys are optional: Shift + Click adds, Ctrl + Click subtracts. Alt is not used.
- Contiguous / Global is its own visible toggle.
- Changing the tolerance re-applies the most recent Magic Wand operation when the slider is released or a typed value is committed.

As implemented (Step 9):

- The row appears below the primary toolbar whenever the Magic Wand is the active tool (so only with an image open), in this order: New / Add / Subtract, Contiguous / Global, Tolerance (slider and text field), then Select All, Clear, Invert, Grow and Shrink. Groups wrap as whole units on narrow windows; there is no horizontal scrolling.
- New / Add / Subtract and Contiguous / Global are framed rows of toggle buttons. The chosen one is pressed (`aria-pressed`) with the same tinted background and border as the active tool. Shift + Click and Ctrl + Click override the chosen mode for that click only; the pressed button does not change.
- Options apply to the next Magic Wand click. Changing them never changes the image or the view, and only a committed tolerance changes the current selection (Step 10, below).
- The slider applies every movement. The text field applies a whole number from 0 to 100 as it is typed, so the slider follows; anything else waits until Enter or leaving the field, when a number is rounded and clamped to 0–100 and other text (including an empty field) restores the current value. Up / Down arrows step by 1 and Page Up / Page Down by 10 in the text field, as on the slider. Escape in the text field restores the tolerance from before the unfinished entry (refined in Step 10, below).
- Select All, Clear, Invert, Grow and Shrink act at once. An action that would change nothing (Select All with everything selected; Clear, Grow or Shrink with nothing selected; Grow or Shrink with everything selected) is shown disabled with `aria-disabled`, which keeps keyboard focus on a button that becomes unavailable when pressed. Visible labels are short (Clear, Invert…) and accessible names full (Clear Selection, Invert Selection…); tooltips name the Ctrl + A and Esc shortcuts.
- Ctrl + A and Escape keep working while the tolerance slider has focus; only the text field keeps their text-editing meaning.

As implemented (Step 10):

- A finished tolerance adjustment re-applies the most recent Magic Wand click with the new tolerance. While the adjustment is in progress (dragging the slider, holding a key, typing) the slider and the number follow it, but the selection does not change.
- An adjustment is finished (committed) when:
  - the slider thumb is released after dragging or clicking the track;
  - the last held arrow, Page Up / Page Down, Home or End key is released on the slider, or the last held arrow or Page key in the text field (holding a key re-applies once, at the end);
  - Enter is pressed in the text field;
  - focus leaves the slider or the text field.
- Escape in the text field cancels the unfinished entry: it restores the tolerance from before that entry, re-applies nothing and does not clear the selection. After Enter or a finished arrow step there is nothing left to cancel, so Escape changes nothing. Enter or leaving the field with text that is not a number commits the tolerance the slider shows: the last whole number typed in that entry, or otherwise the tolerance from before it.
- What is re-applied is the click as it was made: its pixel, Contiguous or Global, and New, Add or Subtract including a Shift or Ctrl override, combined with the selection from before the click. Choosing other options afterwards affects only the next click. Re-applying never builds on an earlier re-applied result, so moving the tolerance up and down never adds or removes more than one click at the final tolerance would.
- Nothing is re-applied before the first click, after Select All, Clear, Invert, Grow or Shrink, or after another image opens; committing then only sets the tolerance for the next click. A failed import keeps the selection and what can be re-applied. Committing the tolerance the selection was made with does nothing.
- The status bar's selection readout and its announcement update after each re-apply, as after a click.

As implemented (Phase 3 Step 6):

- Delete Selection is the last control in the row, in its own group after Shrink: a delete icon and the visible label "Delete Selection" (also its accessible name, so it is not mistaken for Clear), with the tooltip "Make the selected pixels transparent (Delete)" and `aria-keyshortcuts="Delete"`.
- It is available whenever something is selected and no other image is opening. Unavailable, it is `aria-disabled` (styled like the other unavailable actions; focus stays on it after a Delete, and clicking does nothing) and its tooltip adds "— nothing to delete". Its label and size never change, so the row never re-wraps or resizes the workspace.

As implemented (Phase 3 Step 8):

- Two controls between Shrink and Delete Selection: "Edge cleanup" and "Feather", each a short slider (0–5, step 1) and a text field followed by the unit "px". Both show 0 by default. Each control wraps as one unit on narrow windows; the toolbar is otherwise unchanged.
- They follow the tolerance control's conventions: the slider applies every movement; the field applies a whole number from 0 to 5 as it is typed, rounds and clamps other numbers on Enter or leaving the field (other text restores the value), steps with Up / Down (and Page Up / Page Down, by 1), and Escape cancels an unfinished entry. Delete, Backspace and Ctrl + Z inside the field edit its text.
- Accessible names: the slider is named by its visible label and reads its value as "2 px"; the fields are "Edge cleanup in pixels, 0 to 5" and "Feather in pixels, 0 to 5". Tooltips say what each does and that it applies to the next Delete.
- Nothing is computed while adjusting: the amounts only set what the next Delete Selection does. Changing them never changes the image or re-applies a Delete (Step 9 adds that for a finished change right after a Delete, below). They are kept for the session, like the Magic Wand options.
- After a Delete that cleaned or feathered edge pixels, the announcement adds, for example, "1,204 edge pixels were cleaned up or feathered."

As implemented (Phase 3 Step 9):

- Right after a Delete (or its Redo), while nothing has been selected since, a finished adjustment of Edge cleanup or Feather updates that Delete with the amounts now shown. Before that Delete is made, and once anything is selected again, the controls only set the next Delete, as in Step 8.
- Finished means exactly what it means for the tolerance (Step 10 of Phase 2): the slider released after a drag or a click on its track, the last held arrow, Page Up / Page Down, Home or End key released on the slider, the last held arrow or Page key released in the text field, Enter in the text field, or focus leaving either control. While the slider is dragged or a key is held, the slider and the number follow but nothing is computed; holding a key updates once, at its release. Escape in the text field cancels an unfinished entry and computes nothing. A finished adjustment that ends on the amounts the Delete already has computes nothing.
- Only actual changes commit (review correction): a finished adjustment updates the Delete only when it ends on another amount than it started from (when the control gained focus, the slider was pressed, or the previous adjustment finished). Moving focus through the controls with Tab or the pointer, Enter or leaving a field without a change, a drag back to where it began, keys stepped back before release, and retyping the same number never edit the image, even when the amounts shown differ from those the Delete was made with (after Redo).
- One update per finished adjustment: an arrow press (pressed and released) is one adjustment, so three separate presses update three times; holding the key updates once.
- The tooltips of both controls (slider and field) say what they will do: "Edge cleanup for the next Delete: …" or "Edge cleanup, updating the last Delete: …" (likewise for Feather). Nothing else in the row changes: no label, size or layout change, so the row never re-wraps.
- While a change would update the last Delete, the status bar shows "Edge settings update last Delete" after the selection readout, in the accent colour, with a tooltip explaining that selecting something sets the amounts for the next Delete instead. It is plain text (not announced; the updates are), never changes the toolbar or status bar height, and is hidden below 800 px wide.
- The update is announced in the edit status region: "Delete Selection updated with Edge cleanup 2 px and Feather 1 px: 1,204 edge pixels were cleaned up or feathered." (or "…: no edge pixels were changed."). The slider's own value text still reads "2 px" while adjusting.
- Focus stays on the control adjusted. Undo and Redo keep their names ("Undo Delete Selection"): the updated Delete is still one Undo step.
- While the replace confirmation is open (including when opening it takes focus from a field being edited) or another image is opening, a finished adjustment only sets the amount.

The interface should not expose unnecessary technical terminology.

---

## Selection UX

Selected pixels should be clearly visible.

Approved combination:

- Mint-coloured tint, initially about 35% opacity, adjusted after visual testing if necessary
- High-contrast two-tone perimeter, visible over light and dark images
- Optional marching-ants animation, static when reduced motion is requested

The overlay is a separate canvas layer aligned exactly with the image renderer. Avoid unnecessary full-resolution RGBA overlay allocations; evaluate viewport-sized or tiled rendering before implementing it.

Selection visuals should remain understandable when zoomed in.

Reduced-motion users must still have a clear non-animated selection indicator.

As implemented (Step 8):

- Tint: the mint accent (`#6ee7b7`) at 35% opacity over every selected pixel.
- Boundary: wherever selected and unselected pixels meet, including the image edge, a black-and-white line about one CSS pixel wide on each side of the edge. With reduced motion requested its colours follow a static checkerboard of four-CSS-pixel squares anchored to the image: within a square the two sides of the edge take opposite colours, and the colours swap from square to square. Both colours therefore run along every edge, on both sides, so the boundary shows on white, black, transparent and detailed images. Otherwise the boundary is animated (Step 11, below).
- At 100% zoom and above, the tint and boundary follow exactly the image pixels as drawn, and the pixels a click would pick. Zoomed out, where one screen pixel covers several image pixels, a screen pixel shows the selection when any pixel it covers is selected, so even a single selected pixel stays visible.
- The overlay lets every pointer event through to the image, and is hidden from assistive technology; the status bar describes the selection in words.

As implemented (Step 11):

- Marching ants: the boundary is drawn with diagonal black and white stripes, four CSS pixels wide, which step about one CSS pixel every 150 ms. Along horizontal and vertical edges they form four-pixel dashes that move steadily right or down, without changing shape; a full cycle takes 1.2 seconds. As with the static pattern, the two sides of an edge take opposite colours and both colours run along every edge, so the boundary stays visible on white, black, transparent and detailed images.
- Only the boundary moves. The tint, which pixels are boundary, and the selection itself never change from step to step, and the pattern stays anchored to the image while zooming and panning.
- Reduced motion: when the system or browser asks for reduced motion (`prefers-reduced-motion: reduce`), nothing moves and the boundary is the static checkerboard of Step 8. The preference is followed live: switching it on stops the ants at once, switching it off starts them. There is no separate setting in the app.
- The ants do not run when nothing is selected, when no part of the boundary is in view (for example zoomed into the middle of a selection), while the page is hidden (another tab, a minimised window), or while the boundary in view covers more than 10 million device pixels (more than a whole 4K screen of complex boundary); they continue from where they stopped.
- Steps are kept light: when a step takes longer than usual (very complex boundaries, high-DPI screens, slower computers) the next one waits longer, so the animation never takes more than about a twentieth of the main thread. The ants then move more slowly; the rest of the app does not.
- Selection state is never communicated by motion alone: the tint, the boundary and the status bar show it whether or not the ants move.

---

## Status Bar

The status bar stays compact and responsive. It shows:

- Image information and zoom
- The active tool
- Selection information: the number of selected pixels and the width × height of the area containing them (for example `Selection: 31,428 px · 200 × 200`), or `No selection`
- The image pixel under the pointer, as `x, y`

Selection state is therefore never communicated by colour or motion alone. Selection changes are announced to assistive technology in words; the pointer readout is not announced.

On narrower windows the selection and pointer readouts keep priority: the image format and file size are hidden below 1200 px wide, and the active tool (already shown in the toolbar) below 900 px.

As implemented with PNG export (2026-11-08): while the open image has unexported edits (`FEATURE_SPEC.md` §1 and §22), "Unexported edits" follows the image's name, in the accent colour, with a tooltip saying that Export saves the edits as a new PNG file. It is text, not colour alone, is never hidden at narrow widths, and is not a live region (Delete, Undo, Redo and Export announce what happened).

---

## Export Button

As implemented with PNG export (2026-11-08; `FEATURE_SPEC.md` §22): the header's primary **Export** button, after Undo and Redo.

- Without an image it is unavailable (`aria-disabled`, dimmed, tooltip "Export — no image open").
- With an image its tooltip names the file it would save: "Export as PNG: pump-station-cleaned.png". A selection does not affect it.
- While another image is opening it is unavailable (`aria-disabled`, dimmed, keeps focus), with the tooltip "Export — not available while another image is opening", as Trim says the same (owner decision, 2026-11-09). The tooltip is also the button's accessible description; its name stays "Export".
- While the file is written its label is "Exporting…" and it is unavailable but keeps its accent look, slightly dimmed, and keyboard focus. Its width does not change, so the header never shifts.
- A successful export is announced; the browser shows the download. A failure shows the dismissible workspace alert described under Error Handling.
- The wording "Export", "Exporting…" and "Unexported edits" is owner-approved (2026-11-09).

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

As implemented (Phase 3 Step 11; owner's provisional decisions):

```text
Padding  [0] [5] [10] [20]  [ 5 ] px      [⌗ Trim]
```

- Auto Trim is the last tool in the toolbar (its icon, the label "Auto Trim", the tooltip "Remove empty transparent space around the image"). Choosing it presses it and replaces the Magic Wand's options row with its own. The row is one line at the widths tested (640 px and up); its groups wrap as units like the Magic Wand's. Opening another image makes the Magic Wand active again, as before.
- Padding: the visible label "Padding" names the group. The presets 0, 5, 10 and 20 are toggle buttons in a framed row like New / Add / Subtract: the one equal to the padding is pressed (`aria-pressed`, tinted background and border), none when the padding is another number. Their accessible names include the unit ("5 px"); tooltips say what they keep ("No padding: trim tight to the visible pixels", "10 px of padding").
- The field (accessible name "Padding in pixels, 0 to 50", followed by the unit "px") follows the tolerance field's conventions with the range 0–50: a whole number from 0 to 50 applies as it is typed; anything else waits for Enter or leaving the field, when a number is rounded and clamped and other text restores the padding; Up / Down step by 1 and Page Up / Page Down by 10; Escape cancels an unfinished entry. Enter in the field never trims.
- The padding is 5 px by default and goes back to 5 px whenever another image is opened. Changing it never changes the image.
- Trim: an icon and the visible label "Trim" (its accessible name), with a tooltip that says what it will keep ("Trim the image to its visible pixels with 5 px of padding on each side, where the image has that much"; at 0 px "…removing all the transparent space around them"). One click trims; there is no preview. While another image is opening it is `aria-disabled` and its tooltip adds "— not available while another image is opening". Its label and size never change, and focus stays on it after trimming.
- Tab order: the presets, the field, then Trim. No keyboard shortcut runs Auto Trim.
- After a trim the selection is cleared and the trimmed image is fitted to the workspace, as Fit does; Undo and Redo of a trim fit the image they restore. The header's Undo and Redo read "Undo Auto Trim" / "Redo Auto Trim".
- Feedback: a trim is announced ("Auto Trim applied: 1,920 × 1,080 px trimmed to 642 × 410 px."); the image itself shows it. When there is nothing to trim, a dismissible message at the top of the workspace says why (in the style of the import notices, in the polite status region, so it is announced once): "Nothing to trim: the image has no visible pixels.", "Nothing to trim: no side has more than 5 px of transparent space." or, at 0 px, "Nothing to trim: visible pixels already reach every edge of the image." When a trim makes the history drop older Undo steps, the same kind of message adds "Undo history is full, so the oldest Undo step is no longer available." (or "the 3 oldest Undo steps are"). A later outcome replaces the message; opening another image or its dismiss button removes it. A failed trim shows "Auto Trim could not be completed. The image and selection have not changed." as an alert, like other edit failures.
- Not provided: a separate Trim Tight action, a padding slider, a threshold control, a preview of the kept rectangle.

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
Ctrl + Shift + Z   (Redo, alternative)
```

Disabled state should be clear when history is unavailable.

Approved for Phase 3 (P3-D9): Ctrl + Z undoes, and Ctrl + Y or Ctrl + Shift + Z redoes, wherever keyboard focus is except in text fields and editable content, where they keep their text-editing meaning. Undo and Redo cover image edits; undoing an edit also brings back the selection from just before it (P3-D3, P3-D7).

As implemented (Phase 3 Step 6):

- The header's Undo and Redo icon buttons name what they would do: "Undo Delete Selection" / "Redo Delete Selection" (accessible name and tooltip, with the shortcut: "Undo Delete Selection (Ctrl+Z)", "Redo … (Ctrl+Y or Ctrl+Shift+Z)"); "Undo" and "Redo" with "— nothing to undo / redo" when unavailable.
- Unavailable (nothing to undo or redo, no image, or another image opening), they are `aria-disabled` and look disabled, so keyboard focus stays on them after undoing the last edit; clicking does nothing.
- ⌘ Command works in place of Ctrl. Holding Ctrl + Z or Ctrl + Y repeats. With an image open the keys are taken over even when there is nothing to undo or redo; without one they keep their browser meaning.

---

## Keyboard Shortcuts

Potential shortcuts include:

```text
Ctrl + O       Open
Ctrl + S       Export / Save As where appropriate
Ctrl + Z       Undo
Ctrl + Y       Redo
Ctrl+Shift+Z   Redo (alternative)
Ctrl + A       Select All
Ctrl + V       Paste Image
Delete         Delete Selection
Escape         Cancel / Clear Selection
Enter          Confirm current operation
Space + Drag   Pan
Ctrl + Wheel   Zoom
```

Shortcuts must not interfere with text entry controls.

Selection shortcuts in Phase 2 are limited to Ctrl + A and Escape, plus Shift + Click and Ctrl + Click with the Magic Wand. Additional selection hotkeys are deferred to the planned shortcut work.

Approved for Phase 3 (P3-D9): Delete (Delete Selection; ignored while held down, so it never repeats), Ctrl + Z (Undo), Ctrl + Y and Ctrl + Shift + Z (Redo). Backspace is not a Delete shortcut. None of them act while a text field has focus.

As implemented (Phase 3 Step 6): Delete with any modifier is ignored; the shortcuts work with focus on buttons and on the tolerance slider; the tolerance text field keeps its own Delete and Undo. While the replace confirmation is open, Delete, Undo, Redo, Ctrl + A and Escape (which cancels the dialog) belong to the dialog, and Ctrl + O and Ctrl + V do nothing.

PNG export (2026-11-08) has no shortcut yet: Ctrl + S is deferred to Phase 6 (owner decision, 2026-11-09) and keeps its browser meaning until then.

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

As implemented for PNG export: "Exporting…" on the Export button while the file is written. The file is written in small slices with the page free to respond between them, so the editor keeps drawing and responding (measured: no frame gap over 17 ms in Chrome and 84 ms in headless Firefox, also near 50 megapixels).

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

As implemented for exports: a failed export shows the same kind of alert, "The image could not be exported. Nothing was downloaded, and the image has not changed.", with the memory hint when it applies; nothing is downloaded and Export becomes available again.

As implemented for edits (Phase 3 Step 6): a failed Delete, Undo or Redo shows a dismissible message at the top of the workspace, like an import error, announced as an alert: "The selected pixels could not be deleted." (or "Undo could not be completed." / "Redo could not be completed."), "The image and selection have not changed.", and, when the cause looks like memory, "There may not be enough memory for an image this large." Successful edits, Undo and Redo, and a Delete that changed nothing, are announced politely to assistive technology ("Selection deleted: 31,428 pixels are now transparent.", "Undone: Delete Selection.", "Nothing was deleted: the selected pixels are already transparent."); the image itself is the visible feedback. Each outcome is announced once, and again if it is repeated.

---

## Destructive Operations

Actions that change pixels should normally be undoable.

The original imported file should not be automatically overwritten.

Approved for Phase 3:

- Delete Selection needs a selection and clears it afterwards; Undo brings back the pixels and the selection (P3-D3).
- Edge cleanup and feathering default to 0 px, so Delete alone never alters fine lines or anti-aliasing outside the selection (P3-D4).
- Before an image with unsaved pixel edits is replaced (by Open, drop or paste), the user is warned (P3-D12).

As implemented (Phase 3 Step 6): a modal dialog in the dark theme, centred over the dimmed app.

```text
Discard unexported edits?

The current image has edits that have not been exported. Opening
“photo.png” will replace it and discard those edits and its Undo history.

                                              [Cancel]  [Continue]
```

- "the pasted image" replaces the name for a paste. The dialog does not offer to export first (a possible later improvement).
- Cancel has focus first; Escape also cancels. Continue is marked with the error colours (text and border). Focus returns to where it was when the dialog closes. The rest of the page is inert while it is open.
- Asked only when the open image has unexported edits and another image is about to be opened; never for the first image, an unedited one, one whose edits have all been undone, or one exported as it is now.

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
