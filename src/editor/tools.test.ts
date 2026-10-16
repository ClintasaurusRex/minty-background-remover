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
})
