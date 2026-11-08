import { describe, expect, it } from 'vitest'
import { TOOLS } from './tools'

describe('TOOLS', () => {
  it('has unique tool ids', () => {
    const ids = TOOLS.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every tool a visible label and description', () => {
    for (const tool of TOOLS) {
      expect(tool.label.trim()).not.toBe('')
      expect(tool.description.trim()).not.toBe('')
    }
  })

  it('makes the Magic Wand the first tool; Auto Trim is available from Phase 3 Step 11', () => {
    expect(TOOLS[0]).toMatchObject({ id: 'magic-wand', available: true })
    expect(TOOLS.filter((tool) => tool.available).map((tool) => tool.id)).toEqual(['magic-wand', 'auto-trim'])
  })
})
