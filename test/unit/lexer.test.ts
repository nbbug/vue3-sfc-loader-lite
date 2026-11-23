import { describe, expect, it, vi } from 'vitest'
import { parseModuleImports, rewriteModuleSpecifiers } from '../../src/lexer'

const rewrite = async (
  source: string,
  map: Record<string, string | null | undefined>,
  filename = '/App.vue',
) =>
  rewriteModuleSpecifiers(source, filename, (specifier) =>
    Object.prototype.hasOwnProperty.call(map, specifier) ? map[specifier] : null,
  )

describe('module import parsing', () => {
  it('parses static, dynamic, re-export and import.meta', async () => {
    const source = `
      import a from './a.vue'
      import { b } from "vue"
      export * from './all.js'
      const p = import('./lazy.vue')
      const u = import.meta.url
    `
    const imports = await parseModuleImports(source, '/App.vue')
    expect(imports.map((entry) => [entry.specifier, entry.kind])).toEqual([
      ['./a.vue', 'static'],
      ['vue', 'static'],
      ['./all.js', 'static'],
      ['./lazy.vue', 'dynamic'],
    ])
  })
})

describe('rewriteModuleSpecifiers', () => {
  it('rewrites static import specifiers and preserves quote style', async () => {
    const source = `import a from './a.vue'\nimport b from "./b.vue"\n`
    const result = await rewrite(source, {
      './a.vue': 'data:text/javascript,a',
      './b.vue': 'data:text/javascript,b',
    })
    expect(result.code).toContain(`from 'data:text/javascript,a'`)
    expect(result.code).toContain(`from "data:text/javascript,b"`)
    expect(result.deps).toEqual(['./a.vue', './b.vue'])
  })

  it("escapes single quotes for single-quoted static imports", async () => {
    const source = `import a from './a.vue'`
    const result = await rewrite(source, {
      './a.vue': "data:text/javascript,export default 'hi'",
    })
    expect(result.code).toBe(
      `import a from 'data:text/javascript,export default \\'hi\\''`,
    )
  })

  it('rewrites dynamic imports including their quotes', async () => {
    const source = `const a = import('./a.vue')\nconst b = import("./b.vue")\nconst c = import(\`./c.vue\`)\n`
    const result = await rewrite(source, {
      './a.vue': 'data:a',
      './b.vue': 'data:b',
      './c.vue': 'data:c',
    })
    expect(result.code).toContain(`import('data:a')`)
    expect(result.code).toContain(`import("data:b")`)
    expect(result.code).toContain(`import("data:c")`)
  })

  it('leaves import.meta, comments and strings untouched', async () => {
    const source = `
      // import x from './nope.vue'
      /* import y from './nope2.vue' */
      const s = "import z from './nope3.vue'"
      const u = import.meta.url
      import a from './yes.vue'
    `
    const result = await rewrite(source, { './yes.vue': 'data:yes' })
    expect(result.code).toContain(`// import x from './nope.vue'`)
    expect(result.code).toContain(`const s = "import z from './nope3.vue'"`)
    expect(result.code).toContain('import.meta.url')
    expect(result.code).toContain(`import a from 'data:yes'`)
  })


  it('rewrites dynamic imports to a lazy helper when requested', async () => {
    const source = `
      const a = import('./a.vue')
      const b = import(\`./lazy/${'${name}'}.vue\`)
      const c = import(specifier)
      const u = import.meta.url
    `
    const resolver = vi.fn(() => null)
    const result = await rewriteModuleSpecifiers(
      source,
      '/App.vue',
      resolver,
      { dynamicImportHelper: '__lazy__' },
    )
    expect(result.usedDynamicImport).toBe(true)
    expect(result.code).toContain(`__lazy__('./a.vue')`)
    expect(result.code).toContain('__lazy__(`./lazy/${name}.vue`)')
    expect(result.code).toContain('__lazy__(specifier)')
    expect(result.code).toContain('import.meta.url')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('leaves dynamic imports static when no helper is provided', async () => {
    const source = `const a = import('./a.vue')`
    const result = await rewrite(
      source,
      { './a.vue': 'data:a' },
    )
    expect(result.usedDynamicImport).toBe(false)
    expect(result.code).toBe(`const a = import('data:a')`)
  })

  it('leaves specifiers untouched when the resolver returns null/undefined', async () => {
    const source = `import { ref } from 'vue'\nimport a from './a.vue'`
    const result = await rewrite(source, { './a.vue': 'data:a' })
    expect(result.code).toContain(`from 'vue'`)
    expect(result.code).toContain(`from 'data:a'`)
    expect(result.deps).toEqual(['vue', './a.vue'])
  })

  it('supports re-export star specifiers', async () => {
    const source = `export * from './all.js'`
    const result = await rewrite(source, { './all.js': 'data:all' })
    expect(result.code).toBe(`export * from 'data:all'`)
  })

  it('reports parse errors with a code frame', async () => {
    await expect(
      rewriteModuleSpecifiers('import x from', '/bad.vue', () => null),
    ).rejects.toThrow(/\/bad\.vue:1:/)
  })
})
