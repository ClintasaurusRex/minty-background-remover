import { createContext, useContext, useLayoutEffect } from 'react'

/*
 * Whether a modal surface (the colour picker) is open over the editor (Phase 4 audit, M3).
 *
 * While one is, the editor behind it must not act: no image import (paste, Ctrl + O, drops) and no
 * editing shortcut. Focus and event propagation alone do not guarantee that: a paste goes to the
 * document whatever is focused, and window listeners can run before a dialog stops an event. So the
 * app asks this guard directly, as it already asks whether the replace confirmation is open.
 */

export interface ModalGuard {
  /** Marks a modal as open until the returned function is called (calling it again does nothing). */
  hold(): () => void
  /** Whether any modal is open now. */
  isHeld(): boolean
}

export function createModalGuard(): ModalGuard {
  let held = 0
  return {
    hold() {
      held++
      let released = false
      return () => {
        if (released) return
        released = true
        held--
      }
    },
    isHeld: () => held > 0,
  }
}

/** The app's modal guard; without a provider, modals hold nothing (for components shown alone). */
export const ModalGuardContext = createContext<ModalGuard | null>(null)

/**
 * Holds the app's modal guard while the calling component is mounted. A layout effect, so the
 * guard is held before the browser can deliver any event to the newly shown modal.
 */
export function useModalHold(): void {
  const guard = useContext(ModalGuardContext)
  useLayoutEffect(() => guard?.hold(), [guard])
}
