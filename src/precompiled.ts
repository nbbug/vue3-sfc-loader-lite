import { createModuleUrl, importModule } from './moduleUrl'
import { rewriteModuleSpecifiers } from './lexer'
import type {
  AbstractPath,
  Options,
  PrecompiledSFC,
} from './types'

const MARKER = '__vsf_lite_precompiled__'

/**
 * Runtime context required to execute a precompiled artifact. It is the same
 * module resolution context used by the normal SFC compiler.
 */
export type PrecompiledModuleContext = {
  options: Options
  resolveSpecifier(
    specifier: string,
    refPath: AbstractPath,
  ): Promise<string | null | undefined>
  createDynamicImportSupport(refPath: AbstractPath): {
    helperName: string
    getBindingSource: () => string
  }
}

const isObject = (value: any): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Validate a parsed JSON value as a precompiled artifact.
 */
export function asPrecompiledSFC(value: any): PrecompiledSFC | null {
  if (!isObject(value)) return null
  if (value[MARKER] !== 1) return null
  if (value.version !== 1) return null
  if (typeof value.filename !== 'string') return null
  if (typeof value.scopeId !== 'string') return null
  if (typeof value.hasScoped !== 'boolean') return null
  if (value.script !== null && typeof value.script !== 'string') return null
  if (value.render !== null && typeof value.render !== 'string') return null
  if (!Array.isArray(value.styles) || !value.styles.every((css: any) => typeof css === 'string')) {
    return null
  }
  if (!Array.isArray(value.customBlocks)) return null
  return value as PrecompiledSFC
}

/**
 * Detect and parse a precompiled artifact returned by `getFile` (or stored in a
 * database as a JSON string).
 */
export function parsePrecompiledArtifact(source: string): PrecompiledSFC | null {
  if (typeof source !== 'string') return null
  const trimmed = source.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes(MARKER)) return null
  try {
    return asPrecompiledSFC(JSON.parse(trimmed))
  } catch {
    return null
  }
}

async function buildArtifactModule(
  context: PrecompiledModuleContext,
  source: string,
  filename: AbstractPath,
  suffix: string,
): Promise<string> {
  const dynamicImport = context.createDynamicImportSupport(filename)
  const rewritten = await rewriteModuleSpecifiers(
    source,
    filename.toString(),
    (specifier) => context.resolveSpecifier(specifier, filename),
    { dynamicImportHelper: dynamicImport.helperName },
  )
  const code = rewritten.usedDynamicImport
    ? `${dynamicImport.getBindingSource()}\n${rewritten.code}`
    : rewritten.code
  return createModuleUrl(code, `${filename}?${suffix}`)
}

/**
 * Execute a precompiled artifact: create ESM URLs for the script/render code,
 * compose the facade module, inject final CSS and run custom-block callbacks.
 */
export async function executePrecompiledArtifact(
  artifact: PrecompiledSFC,
  filename: AbstractPath,
  context: PrecompiledModuleContext,
): Promise<{ component: any; namespace: any; url: string }> {
  const options = context.options
  const strFilename = filename.toString()

  const scriptUrl =
    artifact.script !== null && artifact.script.trim() !== ''
      ? await buildArtifactModule(context, artifact.script, filename, 'script')
      : undefined
  const renderUrl =
    artifact.render !== null && artifact.render.trim() !== ''
      ? await buildArtifactModule(context, artifact.render, filename, 'render')
      : undefined

  const facadeLines: string[] = []
  if (scriptUrl) {
    facadeLines.push(
      `import * as __script_ns__ from ${JSON.stringify(scriptUrl)};`,
    )
  }
  if (renderUrl) {
    facadeLines.push(
      `import { render as __render__ } from ${JSON.stringify(renderUrl)};`,
    )
  }

  const base = scriptUrl ? '__script_ns__.default' : 'null'
  facadeLines.push(
    `const __base__ = ${base};`,
    `const __component__ = __base__ && (typeof __base__ === 'object' || typeof __base__ === 'function')`,
    `  ? (Object.isExtensible(__base__) ? __base__ : Object.assign({}, __base__))`,
    `  : {};`,
  )
  if (renderUrl) {
    facadeLines.push(`__component__.render = __render__;`)
  }
  facadeLines.push(`__component__.__file = ${JSON.stringify(strFilename)};`)
  if (artifact.hasScoped) {
    facadeLines.push(`__component__.__scopeId = ${JSON.stringify(artifact.scopeId)};`)
  }
  facadeLines.push(`export default __component__;`)
  if (scriptUrl) {
    facadeLines.push(`export * from ${JSON.stringify(scriptUrl)};`)
  }

  const facadeUrl = createModuleUrl(
    facadeLines.join('\n'),
    `${strFilename}?precompiled`,
  )

  let namespace: any
  try {
    namespace = await importModule(facadeUrl)
  } catch (error: any) {
    options.log?.(
      'error',
      'precompiled module',
      `${strFilename}\nFailed to evaluate precompiled artifact: ${String(
        error?.message ?? error,
      )}`,
    )
    throw error
  }

  const component = namespace.default

  if (artifact.styles.length > 0) {
    if (!options.addStyle) {
      throw new ReferenceError(
        `[vue3-sfc-loader-lite] options.addStyle() is not defined but precompiled "${strFilename}" contains styles`,
      )
    }
    for (const css of artifact.styles) {
      options.addStyle(css, artifact.hasScoped ? artifact.scopeId : undefined)
    }
  }

  if (
    options.customBlockHandler &&
    artifact.customBlocks.length > 0
  ) {
    const callbacks = await Promise.all(
      artifact.customBlocks.map((block) =>
        options.customBlockHandler!(block, filename, options),
      ),
    )
    await Promise.all(callbacks.map((callback) => callback?.(component)))
  }

  return { component, namespace, url: facadeUrl }
}
