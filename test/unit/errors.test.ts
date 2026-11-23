import { describe, expect, it } from 'vitest'
import {
  formatError,
  formatErrorLineColumn,
  formatLocatedError,
  offsetToLineColumn,
} from '../../src/errors'

describe('error formatting', () => {
  it('formats a plain error', () => {
    expect(formatError('boom', '/a.vue')).toBe('/a.vue\nboom')
  })

  it('formats a line/column error with a code frame', () => {
    const source = 'line one\nline two\nline three'
    const output = formatErrorLineColumn('boom', '/a.vue', source, 2, 5)
    expect(output).toContain('/a.vue:2:6')
    expect(output).toContain('line two')
    expect(output).toContain('^')
    expect(output).toContain('boom')
  })

  it('handles out-of-range lines', () => {
    expect(formatErrorLineColumn('boom', '/a.vue', 'one', 10, 0)).toBe(
      '/a.vue\nboom',
    )
  })

  it('converts offsets to line/column', () => {
    const source = 'abc\ndefgh\nij'
    expect(offsetToLineColumn(source, 0)).toEqual({ line: 1, column: 0 })
    expect(offsetToLineColumn(source, 4)).toEqual({ line: 2, column: 0 })
    expect(offsetToLineColumn(source, 7)).toEqual({ line: 2, column: 3 })
    expect(offsetToLineColumn(source, 999)).toEqual({ line: 3, column: 2 })
  })

  it('accepts compiler-style loc objects', () => {
    const output = formatLocatedError('bad', '/a.vue', 'hello', {
      start: { line: 1, column: 0 },
    })
    expect(output).toContain('/a.vue:1:1')
  })
})
