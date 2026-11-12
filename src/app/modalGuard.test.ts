import { describe, expect, it } from 'vitest'
import { createModalGuard } from './modalGuard'

describe('createModalGuard', () => {
  it('is held from hold() until its release', () => {
    const guard = createModalGuard()
    expect(guard.isHeld()).toBe(false)
    const release = guard.hold()
    expect(guard.isHeld()).toBe(true)
    release()
    expect(guard.isHeld()).toBe(false)
  })

  it('stays held while any holder remains, and a second release does nothing', () => {
    const guard = createModalGuard()
    const first = guard.hold()
    const second = guard.hold()
    first()
    first()
    expect(guard.isHeld()).toBe(true)
    second()
    expect(guard.isHeld()).toBe(false)
  })

  it('survives the mount, unmount, mount sequence of React Strict Mode', () => {
    const guard = createModalGuard()
    const mounted = guard.hold()
    mounted()
    const remounted = guard.hold()
    expect(guard.isHeld()).toBe(true)
    remounted()
    expect(guard.isHeld()).toBe(false)
  })
})
