# Minty Background Remover Agent Instructions

This file defines mandatory rules for AI coding agents working on Minty Background Remover.

These instructions apply to Claude Code, Codex, and other implementation agents.

---

## Before Editing Anything

Read:

1. `PROJECT_BRIEF.md`
2. This file
3. `IMPLEMENTATION_PLAN.md`
4. Any specification relevant to the current task

Additional relevant documents include:

- `FEATURE_SPEC.md`
- `UI_UX_SPEC.md`
- `IMAGE_PROCESSING_SPEC.md`
- `ARCHITECTURE.md`

Do not rely solely on the user's latest prompt if project documentation provides important context.

---

## Source of Truth

`PROJECT_BRIEF.md` is the highest-level source of truth.

When specifications conflict:

1. `PROJECT_BRIEF.md` wins.
2. More specific feature documents come next.
3. Current explicit project-owner instructions may override documentation.

If an important conflict remains unclear, stop and report it.

Do not silently choose a new product direction.

---

## Scope

Minty Background Remover is a focused image-cleanup utility.

It is **not** a general-purpose graphics editor.

Do not add features simply because they are common in:

- Photoshop
- GIMP
- Paint.NET
- Other image editors

Every significant feature should support the project's defined workflows.

---

## Current Technical Direction

Use:

- React
- Vite
- TypeScript
- Plain CSS
- Canvas 2D
- Vitest

Future:

- Tauri for Linux and Windows

Do not replace this stack without explicit approval.

---

## Local Processing Requirement

All image processing must remain local.

Do not introduce:

- Backend services
- Image upload APIs
- Cloud storage
- Accounts
- Authentication
- Analytics
- Telemetry
- Advertising
- AI APIs
- Remote processing

without explicit approval.

---

## Dependency Rule

Do not casually add dependencies.

Before adding a production dependency:

1. Explain what problem it solves.
2. Explain why existing platform APIs are insufficient.
3. Consider package size.
4. Consider maintenance quality.
5. Confirm browser compatibility.
6. Confirm future Tauri compatibility.

Do not install a large framework to solve a small problem.

---

## Architecture Rule

Keep image-processing algorithms separate from React UI code wherever practical.

Prefer:

```ts
const selection = createMagicWandSelection(imageData, point, options)
```

over functions that tightly couple:

- DOM events
- React state
- Canvas rendering
- Pixel algorithms

Algorithms should be independently testable.

---

## TypeScript Rule

Use meaningful types.

Avoid:

```ts
any
```

unless there is a compelling documented reason.

Do not silence TypeScript errors merely to make checks pass.

---

## CSS Rule

Use plain CSS.

Do not introduce:

- Tailwind
- Bootstrap
- Material UI
- styled-components
- Emotion

unless explicitly approved.

---

## Testing Rule

Testing occurs throughout development.

Do not wait until the project is finished.

Image-processing algorithms should have deterministic automated tests.

Important areas include:

- Magic Wand
- Selection masks
- Trim calculations
- Crop
- Colour replacement
- Transformations
- Undo/redo

Before reporting completion, run all relevant checks.

---

## Required Completion Checks

Where configured, run:

```bash
npm run lint
npm run test
npm run build
```

Also run TypeScript checking if it is a separate command.

Do not claim success when checks are failing.

Report warnings honestly.

---

## Git Rules

The project owner alone performs Git write operations.

Unless explicitly instructed otherwise:

**DO NOT:**

- `git commit`
- `git push`
- `git merge`
- `git rebase`
- `git reset --hard`
- `git cherry-pick`
- `git tag`
- `git branch -D`
- `git push --force`
- rewrite history

You **may** inspect:

```bash
git status
git diff
git log
git branch
```

Creating or switching branches should also be left to the project owner unless explicitly authorised.

Never perform destructive Git operations without explicit permission.

---

## Current Agent Workflow

Claude Code is currently the primary implementation agent.

The normal workflow is:

```text
Project owner + ChatGPT
        ↓
Define phase
        ↓
Write implementation prompt
        ↓
Claude Code implements
        ↓
Claude stops at checkpoint
        ↓
Project owner + ChatGPT review
        ↓
Fixes if required
        ↓
Project owner commits
```

Do not continue into the next phase automatically.

---

## Phase Discipline

Only implement the phase/task currently assigned.

If you complete early:

**STOP.**

Do not begin another feature because it seems like the logical next step.

---

## Unspecified Requirements

When something is unspecified:

First inspect project documentation.

If the choice is minor, reversible, and implementation-level, use reasonable engineering judgement.

If the choice materially affects:

- Product scope
- UX
- Architecture
- Dependencies
- Image quality
- Performance
- Privacy
- Compatibility
- File formats
- Git history

do not guess.

Report the unresolved decision.

---

## Refactoring

Do not perform unrelated refactors during feature work.

A useful refactor may be proposed separately.

Keep diffs focused.

---

## Performance

Do not prematurely optimise.

However, avoid obviously dangerous patterns such as:

- Recursive flood fill over millions of pixels
- Unlimited full-resolution undo snapshots
- Per-pixel React state
- Re-rendering React for every pixel operation

Profile before introducing complex performance architecture.

---

## Accessibility

Accessibility is a requirement.

New UI should consider:

- Keyboard access
- Focus state
- Semantic buttons
- Labels
- Contrast
- Reduced motion
- Non-colour-only communication

Do not defer all accessibility work until the end.

---

## Platform Compatibility

The web application is first.

Architecture must remain compatible with eventual:

- Linux desktop
- Windows desktop

Do not introduce unnecessary platform-specific assumptions into core image logic.

---

## Image Integrity

Do not silently:

- Resize imported images
- Reduce resolution
- Compress PNG data destructively
- Alter aspect ratios
- Flatten transparency

unless the user explicitly performs an operation requiring it.

---

## Error Handling

Do not hide failures.

If an operation fails:

- Preserve the current image state where possible.
- Show a useful error.
- Report the issue during development.

---

## Completion Report

At the end of every assigned task, report:

### Summary

What was completed.

### Files Changed

Exact files created, modified, or deleted.

### Implementation Decisions

Any meaningful technical decisions.

### Dependencies

Any packages added or removed and why.

### Testing

Commands run and results.

### Manual Testing

Any behaviour manually verified.

### Known Issues

Anything incomplete, broken, questionable, or requiring review.

### Unresolved Decisions

Anything needing project-owner input.

### Recommended Next Step

Recommend only the next logical action.

Do not begin it automatically.

---

## Final Rule

Do not optimise for producing the largest amount of code.

Optimise for:

- Correctness
- Clarity
- Maintainability
- Testability
- Predictable image behaviour
- Staying within project scope
