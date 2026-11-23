import { rewriteModuleSpecifiers } from './lexer'
import { createModuleUrl, importModule } from './moduleUrl'
import type { AbstractPath } from './types'

/**
 * Per-`moduleCache` runtime state: generated module URLs, evaluated ESM
 * namespaces, the export value stored in `moduleCache`, object shims and
 * one-time log bookkeeping.
 *
 * @internal
 */
export type ModuleState = {
  urls: Map<string, string>
  namespaces: Map<string, any>
  exports: Map<string, any>
  shims: Map<string, { url: string; value: any }>
  bareLogged: Set<string>
}

export type JSModuleResult = {
  namespace: any
  url: string
}

export type JSModuleContext = {
  resolveSpecifier(specifier: string): Promise<string | null | undefined>
  createDynamicImportSupport(refPath: AbstractPath): {
    helperName: string
    getBindingSource: () => string
  }
}

/**
 * Turn a `.js` / `.mjs` resource into a runtime ES module.
 *
 * The source is *not* transpiled: static import specifiers are rewritten so the
 * browser can resolve them to module URLs, and dynamic imports are routed
 * through a lazy runtime helper.
 */
export async function createJSModule(
  source: string,
  path: AbstractPath,
  context: JSModuleContext,
): Promise<JSModuleResult> {
  const dynamicImport = context.createDynamicImportSupport(path)
  const rewritten = await rewriteModuleSpecifiers(
    source,
    path.toString(),
    context.resolveSpecifier,
    { dynamicImportHelper: dynamicImport.helperName },
  )
  const code = rewritten.usedDynamicImport
    ? `${dynamicImport.getBindingSource()}\n${rewritten.code}`
    : rewritten.code
  const url = createModuleUrl(code, `${path}?js`)
  const namespace = await importModule(url)
  return { namespace, url }
}
