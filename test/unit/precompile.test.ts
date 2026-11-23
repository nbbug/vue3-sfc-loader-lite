import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { loadModule, loadPrecompiled } from '../../src/index'
import {
  precompileSFC,
  serializePrecompiled,
} from '../../src/precompile'
import type { Options, PrecompiledSFC } from '../../src/types'

const createClientOptions = (
  files: Record<string, string> = {},
): Options & { styles: { css: string; scopeId?: string }[]; logs: any[] } => {
  const styles: { css: string; scopeId?: string }[] = []
  const logs: any[] = []
  return {
    moduleCache: { vue: Vue },
    async getFile(url) {
      const file = files[url.toString()]
      if (file === undefined) throw new Error(`404 ${url}`)
      return file
    },
    addStyle(css, scopeId) {
      styles.push({ css, scopeId })
    },
    log(type, ...args) {
      logs.push([type, ...args])
    },
    styles,
    logs,
  } as Options & { styles: { css: string; scopeId?: string }[]; logs: any[] }
}

const renderComponent = async (component: any, props: Record<string, any> = {}) =>
  await renderToString(createSSRApp(component, props))

const setupComponent = `
<template>
  <div class="box">
    <span class="label">{{ label }}</span>
    <span class="doubled">{{ doubled }}</span>
    <button class="inc" @click="inc">{{ count }}</button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

defineProps({
  label: { type: String, default: 'default-label' },
})

const count = ref(1)
const doubled = computed(() => count.value * 2)

function inc() {
  count.value += 1
}
</script>

<style scoped>
.box { color: rgb(255, 0, 0); }
.box .label { font-weight: 700; }
</style>

<style>
.box { margin: 1px; }
</style>
`

describe('precompileSFC / loadPrecompiled', () => {
  it('compiles <script setup>, template and scoped CSS into a JSON artifact', async () => {
    const artifact = await precompileSFC(setupComponent, {
      filename: '/components/Counter.vue',
    })

    expect(artifact.__vsf_lite_precompiled__).toBe(1)
    expect(artifact.version).toBe(1)
    expect(artifact.filename).toBe('/components/Counter.vue')
    expect(artifact.scopeId).toMatch(/^data-v-[0-9a-f]{8}$/)
    expect(artifact.hasScoped).toBe(true)
    expect(artifact.script).toContain('export default')
    expect(artifact.script).toContain('setup')
    expect(artifact.render).toContain('export function render')
    expect(artifact.styles).toHaveLength(2)
    expect(artifact.styles[0]).toContain(`[${artifact.scopeId}]`)
    expect(artifact.styles[1]).not.toContain('data-v-')
    expect(artifact.customBlocks).toEqual([])

    // Artifact must be JSON serializable.
    expect(JSON.parse(serializePrecompiled(artifact))).toMatchObject({
      __vsf_lite_precompiled__: 1,
      filename: '/components/Counter.vue',
    })
  })

  it('executes the artifact on the client and renders setup bindings', async () => {
    const artifact = await precompileSFC(setupComponent, {
      filename: '/components/Counter.vue',
    })
    const options = createClientOptions()
    const component = await loadPrecompiled(artifact, options)

    expect(typeof component.render).toBe('function')
    expect(component.__scopeId).toBe(artifact.scopeId)
    expect(component.__file).toBe('/components/Counter.vue')
    expect(options.styles).toHaveLength(2)
    expect(options.styles[0].scopeId).toBe(artifact.scopeId)

    const html = await renderComponent(component, { label: 'hello' })
    expect(html).toContain('class="box"')
    expect(html).toContain('>hello<')
    expect(html).toContain('>2<')
    expect(html).toContain('>1<')
    expect(html).toContain(`data-v-${artifact.scopeId.slice('data-v-'.length)}`)
  })

  it('accepts the artifact as a JSON string', async () => {
    const artifact = await precompileSFC(setupComponent, {
      filename: '/components/Counter.vue',
    })
    const options = createClientOptions()
    const component = await loadPrecompiled(serializePrecompiled(artifact), options)
    const html = await renderComponent(component, { label: 'string' })
    expect(html).toContain('>string<')
  })

  it('deduplicates concurrent loadPrecompiled calls by path', async () => {
    const artifact = await precompileSFC(setupComponent, {
      filename: '/components/Counter.vue',
    })
    const options = createClientOptions()
    const [a, b] = await Promise.all([
      loadPrecompiled(artifact, options, '/components/Counter.vue'),
      loadPrecompiled(artifact, options, '/components/Counter.vue'),
    ])
    expect(a).toBe(b)
    expect(options.moduleCache['/components/Counter.vue']).toBe(a)
  })

  it('detects artifacts returned by getFile for .vue and .json paths', async () => {
    const artifact = await precompileSFC(setupComponent, {
      filename: '/components/Counter.vue',
    })
    const json = serializePrecompiled(artifact)

    for (const path of ['/components/Counter.vue', '/components/Counter.json']) {
      const options = createClientOptions({ [path]: json })
      const component = await loadModule(path, options)
      expect(component.__scopeId).toBe(artifact.scopeId)
      const html = await renderComponent(component, { label: path })
      expect(html).toContain(path)
      expect(options.moduleCache[path]).toBe(component)
    }
  })

  it('supports precompiled components importing other precompiled components', async () => {
    const childArtifact = await precompileSFC(
      `
        <template><span class="child">{{ msg }}</span></template>
        <script setup>
          defineProps({ msg: { type: String, required: true } })
        </script>
      `,
      { filename: '/components/Child.vue' },
    )

    const parentArtifact = await precompileSFC(
      `
        <template><div class="parent"><Child :msg="msg" /></div></template>
        <script setup>
          import Child from './Child.vue'
          const msg = 'nested-precompiled'
        </script>
      `,
      { filename: '/components/Parent.vue' },
    )

    const options = createClientOptions({
      '/components/Parent.vue': serializePrecompiled(parentArtifact),
      '/components/Child.vue': serializePrecompiled(childArtifact),
    })

    const component = await loadModule('/components/Parent.vue', options)
    const html = await renderComponent(component)
    expect(html).toContain('class="parent"')
    expect(html).toContain('class="child"')
    expect(html).toContain('nested-precompiled')
    expect(options.moduleCache['/components/Child.vue']).toBeTruthy()
  })

  it('supports normal <script> components and custom blocks', async () => {
    const artifact = await precompileSFC(
      `
        <template><span>{{ msg }}</span></template>
        <script>
          export default { data() { return { msg: 'options-api' } } }
        </script>
        <i18n>translated</i18n>
      `,
      { filename: '/components/Options.vue' },
    )
    expect(artifact.script).toContain('export default')
    expect(artifact.customBlocks).toEqual([
      { type: 'i18n', content: 'translated', attrs: {} },
    ])

    const options = createClientOptions()
    const handler = vi.fn(async (block: any) => (component: any) => {
      component.i18n = block.content.trim()
    })
    options.customBlockHandler = handler

    const component = await loadPrecompiled(artifact, options)
    expect(component.i18n).toBe('translated')
    expect(handler).toHaveBeenCalledOnce()
    expect(await renderComponent(component)).toContain('options-api')
  })

  it('can execute a template-only artifact', async () => {
    const artifact = await precompileSFC(`<template><b>only-template</b></template>`, {
      filename: '/components/TemplateOnly.vue',
    })
    expect(artifact.script).toBeNull()
    const options = createClientOptions()
    const component = await loadPrecompiled(artifact, options)
    expect(await renderComponent(component)).toContain('only-template')
  })

  it('rejects invalid artifacts', async () => {
    await expect(loadPrecompiled('{}' as any, createClientOptions())).rejects.toThrow(
      /invalid precompiled artifact/,
    )
    const artifact = await precompileSFC('<template><div/></template>')
    const tampered = { ...artifact, version: 2 }
    await expect(loadPrecompiled(tampered as PrecompiledSFC, createClientOptions())).rejects.toThrow(
      /invalid precompiled artifact/,
    )
  })

  it('rejects TypeScript/JSX scripts, preprocessors, CSS modules and v-bind() CSS', async () => {
    await expect(
      precompileSFC('<script setup lang="ts">const x: number = 1</script>'),
    ).rejects.toThrow(/only plain JavaScript/)

    await expect(
      precompileSFC('<style lang="scss">.a { color: red; }</style>'),
    ).rejects.toThrow(/only plain CSS|parse/)

    await expect(
      precompileSFC('<template><div/></template><style module>.a { color: red; }</style>'),
    ).rejects.toThrow(/CSS Modules/)

    await expect(
      precompileSFC('<template lang="pug">div hi</template>'),
    ).rejects.toThrow(/only HTML/)

    await expect(
      precompileSFC('<template><div/></template><style>div { color: v-bind(color); }</style>'),
    ).rejects.toThrow(/v-bind\(\) in CSS/)

    await expect(
      precompileSFC('<script src="./x.js"></script>'),
    ).rejects.toThrow(/external <script src=/)

    await expect(
      precompileSFC('<template><div/></template><style src="./x.css"></style>'),
    ).rejects.toThrow(/external <style src=/)
  })
})
