import {
  parse as parseSfc,
  compileScript,
  compileTemplate,
  version as compilerVersion,
} from '@vue/compiler-sfc'
import type { SFCDescriptor } from '@vue/compiler-sfc'
import { formatLocatedError } from './errors'
import { buildScopeId } from './hash'
import { scopeCss } from './scopedCss'
import type { CustomBlock, PrecompiledSFC } from './types'

export type PrecompileOptions = {
  /**
   * Stable filename/id of the SFC. It determines the scoped-style id and should
   * not change between compilations of the same component.
   */
  filename?: string
  /** Override the generated `data-v-xxxxxxxx` scope id. */
  scopeId?: string
  /** Production template compilation (default: true). */
  isProd?: boolean
  delimiters?: [string, string]
  whitespace?: 'preserve' | 'condense'
  isCustomElement?: (tag: string) => boolean
}

const supportedScriptLangs = new Set(['js', 'javascript', 'mjs', 'esm', 'module'])

const fail = (message: string, filename: string): never => {
  throw new Error(`[vue3-sfc-loader-lite/precompile] ${message} (${filename})`)
}

const assertPlainJavaScript = (descriptor: SFCDescriptor, filename: string): void => {
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue
    const lang = (block.lang ?? 'js').toLowerCase()
    if (!supportedScriptLangs.has(lang)) {
      fail(
        `the <script lang="${block.lang}"> block is not supported by the precompiler; only plain JavaScript is accepted`,
        filename,
      )
    }
    if (block.src) {
      fail(
        'external <script src="..."> blocks are not supported by the precompiler; inline the script first',
        filename,
      )
    }
  }
}

/**
 * Compile an SFC (including `<script setup>` in plain JavaScript) on the
 * admin/server side into a JSON-serializable artifact.
 *
 * The artifact can be stored in a database and later executed by the small
 * client runtime with `loadPrecompiled()` or `loadModule()`.
 */
export async function precompileSFC(
  source: string,
  options: PrecompileOptions = {},
): Promise<PrecompiledSFC> {
  if (typeof source !== 'string') {
    throw new TypeError('[vue3-sfc-loader-lite/precompile] source must be a string')
  }

  const filename = options.filename ?? 'anonymous.vue'
  const isProd = options.isProd ?? true
  const { descriptor, errors } = parseSfc(source, {
    filename,
    sourceMap: false,
  })

  if (errors.length > 0) {
    const details = errors
      .map((error) => {
        if (typeof error === 'string') return error
        return formatLocatedError(error.message, filename, source, (error as any).loc)
      })
      .join('\n\n')
    throw new Error(
      `[vue3-sfc-loader-lite/precompile] failed to parse "${filename}":\n\n${details}`,
    )
  }

  assertPlainJavaScript(descriptor, filename)

  if (descriptor.template) {
    const lang = descriptor.template.lang
    if (lang && lang.toLowerCase() !== 'html') {
      fail(
        `the <template lang="${lang}"> block is not supported by the precompiler; only HTML is accepted`,
        filename,
      )
    }
    if (descriptor.template.src) {
      fail(
        'external <template src="..."> blocks are not supported by the precompiler; inline the template first',
        filename,
      )
    }
  }

  for (const style of descriptor.styles) {
    const lang = (style.lang ?? 'css').toLowerCase()
    if (lang !== 'css') {
      fail(
        `the <style lang="${style.lang}"> block is not supported by the precompiler; only plain CSS is accepted`,
        filename,
      )
    }
    if (style.module) {
      fail('CSS Modules (<style module>) are not supported by the precompiler', filename)
    }
    if (style.src) {
      fail(
        'external <style src="..."> blocks are not supported by the precompiler; inline the CSS first',
        filename,
      )
    }
  }

  if (descriptor.cssVars.length > 0) {
    fail('v-bind() in CSS is not supported by the precompiler', filename)
  }

  for (const block of descriptor.customBlocks) {
    if (block.attrs.src) {
      fail(
        `external custom block <${block.type} src="..."> is not supported by the precompiler`,
        filename,
      )
    }
  }

  const scopeId = options.scopeId ?? buildScopeId(filename)
  const hasScoped = descriptor.styles.some((style) => style.scoped)

  let script: string | null = null
  let bindingMetadata: Record<string, any> | undefined

  if (descriptor.script || descriptor.scriptSetup) {
    let compiled: any
    try {
      compiled = compileScript(descriptor, {
        id: scopeId,
        isProd,
        sourceMap: false,
        inlineTemplate: false,
      })
    } catch (error: any) {
      fail(`failed to compile the script: ${String(error?.message ?? error)}`, filename)
    }
    script = compiled.content
    bindingMetadata = compiled.bindings as Record<string, any> | undefined
  }

  let render: string | null = null
  const templateBlock = descriptor.template
  if (templateBlock) {
    let result: any
    try {
      result = compileTemplate({
        source: templateBlock.content,
        filename,
        id: scopeId,
        scoped: hasScoped,
        slotted: descriptor.slotted,
        isProd,
        transformAssetUrls: false,
        compilerOptions: {
          mode: 'module',
          prefixIdentifiers: true,
          sourceMap: false,
          bindingMetadata,
          scopeId: hasScoped ? scopeId : undefined,
          isCustomElement: options.isCustomElement,
          whitespace: options.whitespace,
          delimiters: options.delimiters,
        },
      })
    } catch (error: any) {
      fail(`failed to compile the template: ${String(error?.message ?? error)}`, filename)
    }

    if (result.errors.length > 0) {
      const details = result.errors
        .map((error: any) => {
          if (typeof error === 'string') return error
          return formatLocatedError(
            error.message,
            filename,
            templateBlock.content,
            (error as any).loc,
          )
        })
        .join('\n\n')
      fail(`failed to compile the template:\n\n${details}`, filename)
    }
    render = result.code
  }

  const styles = descriptor.styles.map((style) => {
    const css = style.scoped ? scopeCss(style.content, scopeId) : style.content
    return css.trim()
  })

  const customBlocks: CustomBlock[] = descriptor.customBlocks.map((block) => ({
    type: block.type,
    content: block.content,
    attrs: block.attrs,
  }))

  return {
    __vsf_lite_precompiled__: 1,
    version: 1,
    filename,
    scopeId,
    hasScoped,
    script,
    render,
    styles,
    customBlocks,
    compilerVersion,
  }
}

/** Alias for {@link precompileSFC}. */
export const precompile = precompileSFC

/** Serialize a precompiled artifact for database/file storage. */
export function serializePrecompiled(artifact: PrecompiledSFC): string {
  return JSON.stringify(artifact)
}

export type { PrecompiledSFC } from './types'
