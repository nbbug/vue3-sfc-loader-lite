import { describe, expect, it } from 'vitest'
import { buildScopeId, hash } from '../../src/hash'

describe('hashing', () => {
  it('is deterministic and stable', () => {
    expect(hash('abc')).toBe(hash('abc'))
    expect(hash('abc')).not.toBe(hash('abd'))
    expect(hash('a', 'b')).not.toBe(hash('ab'))
    expect(hash('abc')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('builds data-v scope ids', () => {
    const id = buildScopeId('/components/App.vue')
    expect(id).toMatch(/^data-v-[0-9a-f]{8}$/)
    expect(buildScopeId('/components/App.vue')).toBe(id)
    expect(buildScopeId('/components/Other.vue')).not.toBe(id)
  })
})
