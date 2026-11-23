import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadModule } from '../../src/index'
import { Loading } from '../../src/loading'
import type { Cache, Options } from '../../src/types'

/**
 * A tiny Vue runtime stand-in. The compiled render functions only call these
 * helpers for the templates used in this file.
 */
const Vue = {
  toDisplayString: (value: any) => String(value ?? ''),
  openBlock: () => {},
  createElementBlock: (tag: string, props: any, children: any) => ({
    tag,
    props,
    children,
  }),
  createElementVNode: (tag: string, props: any, children: any) => ({
    tag,
    props,
    children,
  }),
  createTextVNode: (text: any) => text,
  resolveComponent: (name: string) => name,
  createBlock: (tag: any, props: any, children: any) => ({ tag, props, children }),
  createVNode: (tag: any, props: any, children: any) => ({ tag, props, children }),
  Fragment: Symbol('Fragment'),
  renderList: (value: any[], render: (item: any) => any) => value.map(render),
  withCtx: (fn: any) => fn,
}

const createOptions = (
  files: Record<string, string | { type: string; content: string }>,
  overrides: Partial<Options> = {},
): Options & { styles: { css: string; scopeId?: string }[]; logs: any[] } => {
  const styles: { css: string; scopeId?: string }[] = []
  const logs: any[] = []
  return {
    moduleCache: { vue: Vue },
    async getFile(url) {
      const file = files[url.toString()]
      if (file === undefined) {
        throw Object.assign(new Error(`404 ${url}`), { status: 404 })
      }
      if (typeof file === 'string') return file
      return {
        type: file.type,
        getContentData: async () => file.content,
      }
    },
    addStyle(css, scopeId) {
      styles.push({ css, scopeId })
    },
    log(type, ...args) {
      logs.push([type, ...args])
    },
    styles,
    logs,
    ...overrides,
  } as Options & { styles: { css: string; scopeId?: string }[]; logs: any[] }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('loadModule / SFC compilation', () => {
  it('compiles a template and script and injects styles', async () => {
    const options = createOptions({
      '/App.vue': `
        <template><div class="app">{{ msg }}</div></template>
        <script>export default { data() { return { msg: 'hello' } } }</script>
        <style scoped>.app:hover { color: red; }</style>
      `,
    })

    const component = await loadModule('/App.vue', options)

    expect(typeof component).toBe('object')
    expect(typeof component.render).toBe('function')
    expect(component.__scopeId).toMatch(/^data-v-[0-9a-f]{8}$/)
    expect(component.render({ msg: 'hello' })).toEqual({
      tag: 'div',
      props: { class: 'app' },
      children: 'hello',
    })
    expect(options.styles).toHaveLength(1)
    expect(options.styles[0].css).toBe(
      `.app[${component.__scopeId}]:hover { color: red; }`,
    )
    expect(options.styles[0].scopeId).toBe(component.__scopeId)

    // moduleCache holds the component (not a namespace)
    expect(options.moduleCache['/App.vue']).toBe(component)
    expect(options.moduleCache['vue']).toBe(Vue)
  })

  it('supports a template-only SFC and a script-only SFC', async () => {
    const templateOnly = createOptions({
      '/T.vue': `<template><p>hi</p></template>`,
    })
    const t = await loadModule('/T.vue', templateOnly)
    expect(t.render({})).toEqual({ tag: 'p', props: null, children: 'hi' })

    const scriptOnly = createOptions({
      '/S.vue': `<script>export default { name: 'S' }</script>`,
    })
    const s = await loadModule('/S.vue', scriptOnly)
    expect(s.name).toBe('S')
    expect(s.render).toBeUndefined()
  })

  it('creates an empty component when the script has no default export', async () => {
    const options = createOptions({
      '/App.vue': `<template><span>side</span></template><script>globalThis.__liteSideEffect = true</script>`,
    })
    const component = await loadModule('/App.vue', options)
    expect(typeof component).toBe('object')
    expect(typeof component.render).toBe('function')
    expect((globalThis as any).__liteSideEffect).toBe(true)
  })

  it('returns the same component from moduleCache on repeated loads', async () => {
    const options = createOptions({
      '/App.vue': `<script>export default { name: 'App' }</script>`,
    })
    const getFile = vi.spyOn(options, 'getFile')
    const first = await loadModule('/App.vue', options)
    const second = await loadModule('/App.vue', options)
    expect(second).toBe(first)
    expect(getFile).toHaveBeenCalledOnce()
  })

  it('deduplicates concurrent loads with a Loading placeholder', async () => {
    const options = createOptions({
      '/Slow.vue': `<script>export default { name: 'Slow' }</script>`,
    })
    const first = loadModule('/Slow.vue', options)
    expect(options.moduleCache['/Slow.vue']).toBeInstanceOf(Loading)
    const second = loadModule('/Slow.vue', options)
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(options.moduleCache['/Slow.vue']).toBe(a)
  })

  it('supports delimiters', async () => {
    const options = createOptions(
      {
        '/App.vue': `<template><b>[[ msg ]]</b></template><script>export default { data: () => ({ msg: 'x' }) }</script>`,
      },
      { delimiters: ['[[', ']]'] },
    )
    const component = await loadModule('/App.vue', options)
    expect(component.render({ msg: 'x' })).toEqual({
      tag: 'b',
      props: null,
      children: 'x',
    })
  })

  it('loads external script, template and style files', async () => {
    const options = createOptions({
      '/App.vue': `
        <template src="./app.html"></template>
        <script src="./app.js"></script>
        <style src="./app.css" scoped></style>
      `,
      '/app.html': `<div>{{ msg }}</div>`,
      '/app.js': `export default { data() { return { msg: 'external' } } }`,
      '/app.css': `.x { color: red }`,
    })
    const component = await loadModule('/App.vue', options)
    expect(component.render({ msg: 'external' })).toEqual({
      tag: 'div',
      props: null,
      children: 'external',
    })
    expect(options.styles[0].css).toContain('.x[')
  })

  it('runs custom block handlers and callbacks', async () => {
    const handler = vi.fn(async (block: any) => (component: any) => {
      component.i18n = block.content.trim()
    })
    const options = createOptions(
      {
        '/App.vue': `<script>export default { name: 'App' }</script><i18n>hello-i18n</i18n>`,
      },
      { customBlockHandler: handler },
    )
    const component = await loadModule('/App.vue', options)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: 'i18n',
      content: 'hello-i18n',
    })
    expect(component.i18n).toBe('hello-i18n')
  })

  it('uses the options.loadModule hook for virtual modules', async () => {
    const hooked = { name: 'Hooked' }
    const hook = vi.fn(async (id: any) => (id === '/hooked.vue' ? hooked : undefined))
    const options = createOptions(
      {
        '/App.vue': `
          <script>
            import Hooked from './hooked.vue'
            export default { components: { Hooked } }
          </script>
        `,
      },
      { loadModule: hook },
    )
    const component = await loadModule('/App.vue', options)
    expect(hook).toHaveBeenCalledWith('/hooked.vue', expect.anything())
    expect(component.components.Hooked).toBe(hooked)
    expect(options.moduleCache['/hooked.vue']).toBe(hooked)
  })


  it('gives the loadModule hook a chance to handle bare specifiers', async () => {
    const hooked = { name: 'VirtualHooked' }
    const hook = vi.fn(async (id: any) => (id === 'virtual:hooked' ? hooked : undefined))
    const options = createOptions(
      {
        '/App.vue': `
          <script>
            import Hooked from 'virtual:hooked'
            export default { components: { Hooked } }
          </script>
        `,
      },
      { loadModule: hook },
    )
    const component = await loadModule('/App.vue', options)
    expect(hook).toHaveBeenCalledWith('virtual:hooked', expect.anything())
    expect(component.components.Hooked).toBe(hooked)
    expect(options.moduleCache['virtual:hooked']).toBe(hooked)
  })

  it('uses options.handleModule for custom file types', async () => {
    const handleModule = vi.fn(async (type: string, getContentData: any) => {
      if (type === '.txt') return await getContentData(false)
      return undefined
    })
    const options = createOptions(
      { '/message.txt': 'hello text' },
      { handleModule },
    )
    await expect(loadModule('/message.txt', options)).resolves.toBe('hello text')
    expect(handleModule).toHaveBeenCalledOnce()
  })

  it('supports .json modules', async () => {
    const options = createOptions({ '/data.json': `{"a":1,"b":[2]}` })
    const namespace = await loadModule('/data.json', options)
    expect(namespace.default).toEqual({ a: 1, b: [2] })
  })

  it('supports .js and .mjs modules with imports and dynamic imports', async () => {
    const options = createOptions({
      '/main.mjs': `
        import { value } from './value.js'
        export const result = value + 1
        export default { name: 'main' }
      `,
      '/value.js': `export const value = 41`,
    })
    const namespace = await loadModule('/main.mjs', options)
    expect(namespace.result).toBe(42)
    expect(namespace.default).toEqual({ name: 'main' })
  })

  it('supports query strings in paths', async () => {
    const options = createOptions({
      '/App.vue?v=1': `<script>export default { name: 'V1' }</script>`,
    })
    // getResource strips the query for the file extension but keeps it in the id.
    options.pathResolve = ({ refPath, relPath }) =>
      refPath === undefined ? relPath : relPath
    const component = await loadModule('/App.vue?v=1', options)
    expect(component.name).toBe('V1')
  })
})

describe('compiledCache', () => {
  it('reuses compiled templates and scoped CSS across module caches', async () => {
    const storage: Record<string, string> = {}
    const cache: Cache = {
      get: vi.fn(async (key) => storage[key]),
      set: vi.fn(async (key, value) => {
        storage[key] = value
      }),
    }
    const files = {
      '/App.vue': `<template><div>{{ n }}</div></template><script>export default { data: () => ({ n: 1 }) }</script><style scoped>.a{color:red}</style>`,
    }

    const first = createOptions(files, { compiledCache: cache })
    await loadModule('/App.vue', first)
    const firstSetCount = (cache.set as any).mock.calls.length
    expect(firstSetCount).toBeGreaterThan(0)

    const second = createOptions(files, { compiledCache: cache })
    await loadModule('/App.vue', second)
    expect((cache.set as any).mock.calls.length).toBe(firstSetCount)
    expect((cache.get as any).mock.calls.length).toBeGreaterThan(firstSetCount)
  })
})

describe('errors and unsupported features', () => {
  it('rejects <script setup> with a clear message', async () => {
    const options = createOptions({
      '/App.vue': `<script setup>const x = 1</script>`,
    })
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /<script setup> is not supported/,
    )
  })

  it('rejects TypeScript/JSX scripts', async () => {
    const options = createOptions({
      '/App.vue': `<script lang="ts">export default {}</script>`,
    })
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /Only plain JavaScript ES modules are accepted/,
    )
  })

  it('rejects style preprocessors', async () => {
    const options = createOptions({
      '/App.vue': `<style lang="scss">.a{color:red}</style>`,
    })
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /Only plain CSS is accepted/,
    )
  })

  it('rejects template preprocessors', async () => {
    const options = createOptions({
      '/App.vue': `<template lang="pug">div hi</template>`,
    })
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /Only plain HTML templates are accepted/,
    )
  })

  it('requires addStyle when the component has styles', async () => {
    const options = createOptions({
      '/App.vue': `<template><div/></template><style>.a{color:red}</style>`,
    })
    delete (options as any).addStyle
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /options\.addStyle\(\) is not defined/,
    )
  })

  it('logs and rejects template compilation errors', async () => {
    const options = createOptions({
      '/App.vue': `<template><div v-if></div></template>`,
    })
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /failed to compile the template/,
    )
    expect(
      options.logs.some(
        ([type, category]) => type === 'error' && category === 'SFC template',
      ),
    ).toBe(true)
  })

  it('rejects invalid script syntax', async () => {
    const options = createOptions({
      '/App.vue': `<script>export default {</script>`,
    })
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /Failed to parse ES module/,
    )
  })

  it('reports missing getFile', async () => {
    const options = createOptions({})
    delete (options as any).getFile
    await expect(loadModule('/App.vue', options)).rejects.toThrow(
      /options\.getFile\(\) is not defined/,
    )
  })

  it('detects circular dependencies instead of hanging', async () => {
    const options = createOptions({
      '/A.vue': `<script>import B from './B.vue'; export default { components: { B } }</script>`,
      '/B.vue': `<script>import A from './A.vue'; export default { components: { A } }</script>`,
    })
    await expect(loadModule('/A.vue', options)).rejects.toThrow(
      /circular dependency detected/,
    )
  })

  it('rejects unknown file types', async () => {
    const options = createOptions({ '/x.wasm': 'binary' })
    await expect(loadModule('/x.wasm', options)).rejects.toThrow(
      /unable to handle/,
    )
  })
})
