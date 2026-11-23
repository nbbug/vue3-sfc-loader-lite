import { describe, expect, it } from 'vitest'
import {
  createModuleUrl,
  createObjectShimUrl,
  importModule,
} from '../../src/moduleUrl'

const decodeModuleUrl = (url: string): string =>
  decodeURIComponent(url.slice(url.indexOf(',') + 1))

describe('createModuleUrl', () => {
  it('creates a data URL in Node and appends sourceURL', () => {
    const url = createModuleUrl('export const x = 1', 'test.js')
    expect(url.startsWith('data:text/javascript;charset=utf-8,')).toBe(true)
    const code = decodeModuleUrl(url)
    expect(code).toContain('export const x = 1')
    expect(code).toContain('//# sourceURL=')
  })

  it('does not leave quotes that could break nested import specifiers', () => {
    const url = createModuleUrl(`export default 'hi'`, 'quotes.js')
    expect(url).not.toContain("'")
    expect(url).not.toContain('"')
  })
})

describe('createObjectShimUrl', () => {
  it('exports the default and named members of a plain object', async () => {
    const value = { default: { name: 'default' }, ref: 1, computed: 2 }
    // `default` is the interop key only for __esModule / namespace values.
    const shimUrl = createObjectShimUrl(value, 'plain')
    const namespace = await importModule(shimUrl)
    expect(namespace.ref).toBe(1)
    expect(namespace.computed).toBe(2)
    expect(namespace.default).toBe(value)
  })

  it('follows interopRequireDefault for __esModule values', async () => {
    const esModule = {
      __esModule: true,
      default: { name: 'component' },
      helper: 42,
    }
    const namespace = await importModule(createObjectShimUrl(esModule, 'esm'))
    expect(namespace.default).toEqual({ name: 'component' })
    expect(namespace.helper).toBe(42)
  })

  it('follows ES module namespace interop', async () => {
    const namespaceObject = Object.create(null)
    Object.defineProperty(namespaceObject, Symbol.toStringTag, { value: 'Module' })
    namespaceObject.default = { name: 'ns-default' }
    namespaceObject.named = 'yes'
    const namespace = await importModule(
      createObjectShimUrl(namespaceObject, 'ns'),
    )
    expect(namespace.default).toEqual({ name: 'ns-default' })
    expect(namespace.named).toBe('yes')
  })

  it('skips invalid, reserved and `then` keys', () => {
    const value = {
      valid: 1,
      'not-valid': 2,
      class: 3,
      default: 4,
      then: () => {},
    }
    const code = decodeModuleUrl(createObjectShimUrl(value, 'keys'))
    expect(code).toContain('export const valid =')
    expect(code).not.toContain('export const not-valid =')
    expect(code).not.toContain('export const class =')
    expect(code).not.toContain('export const default =')
    expect(code).not.toContain('export const then =')
  })

  it('handles null and primitive values', async () => {
    const nullNamespace = await importModule(createObjectShimUrl(null, 'null'))
    expect(nullNamespace.default).toBeNull()

    const stringNamespace = await importModule(createObjectShimUrl('hello', 'str'))
    expect(stringNamespace.default).toBe('hello')
  })

  it('keeps named members live at shim evaluation time', async () => {
    const value: Record<string, any> = { a: 1 }
    const shimUrl = createObjectShimUrl(value, 'mutable')
    value.b = 2
    const namespace = await importModule(shimUrl)
    expect(namespace.b).toBe(2)
  })
})
