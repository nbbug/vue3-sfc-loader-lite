import { loadModule } from './loader'
import { version, vueVersion } from './version'

export { loadModule, version, vueVersion }
export * from './types'

/**
 * Re-export the compiler version under a descriptive alias (same value as
 * `vueVersion`). Useful for diagnostics.
 */
export { vueVersion as compilerVersion } from './version'

/**
 * @deprecated Custom template preprocessors are not supported by the lite
 * loader. This stub is exported so existing imports fail with a clear message
 * instead of `undefined is not a function`.
 */
export function buildTemplateProcessor(..._args: any[]): never {
  throw new Error(
    '[vue3-sfc-loader-lite] buildTemplateProcessor() is not supported: templates must be plain HTML. ' +
      'Pre-compile custom template languages or use the full vue3-sfc-loader.',
  )
}
