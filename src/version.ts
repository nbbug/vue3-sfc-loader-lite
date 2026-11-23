/**
 * Versions reported by the public API. The build replaces the compile-time
 * constants; the fallbacks keep TypeScript/Vitest and unbundled usage working.
 */
declare const __SFC_LITE_VERSION__: string | undefined
declare const __VUE_VERSION__: string | undefined

export const version: string =
  typeof __SFC_LITE_VERSION__ === 'string' ? __SFC_LITE_VERSION__ : '0.0.0-dev'

export const vueVersion: string =
  typeof __VUE_VERSION__ === 'string' ? __VUE_VERSION__ : '3.x'
