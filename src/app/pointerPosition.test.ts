import { describe, expect, it } from 'vitest'
import { createPointerPositionStore } from './pointerPosition'

describe('createPointerPositionStore', () => {
  it('starts with no position', () => {
    expect(createPointerPositionStore().get()).toBeNull()
  })

  it('notifies subscribers only when the position changes', () => {
    const store = createPointerPositionStore()
    let calls = 0
    const unsubscribe = store.subscribe(() => calls++)

    store.set({ x: 1, y: 2 })
    store.set({ x: 1, y: 2 })
    expect(calls).toBe(1)
    expect(store.get()).toEqual({ x: 1, y: 2 })

    store.set({ x: 1.5, y: 2 })
    store.set(null)
    store.set(null)
    expect(calls).toBe(3)
    expect(store.get()).toBeNull()

    unsubscribe()
    store.set({ x: 3, y: 4 })
    expect(calls).toBe(3)
  })
})
