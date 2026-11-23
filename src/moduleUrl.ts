import { Loading } from './loading'

/**
 * Runtime ES module execution.
 *
 * Compiled modules are turned into blob URLs (browsers) or data URLs (Node).
 * Modules that live in `moduleCache` as plain objects (Vue, user libraries) are
 * exposed to ESM imports through a generated "shim" module that re-exports
 * their enumerable properties. This is what keeps the familiar
 * `moduleCache: { vue: Vue }` usage working without a CommonJS transform.
 */

const REGISTRY_KEY = 'vue3-sfc-loader-lite.registry.v1'
const INSTANCE_ID = Math.random().toString(36).slice(2, 8)
let objectCounter = 0
let dynamicImporterCounter = 0

type DynamicImporter = (specifier: any) => Promise<any>

type Registry = {
  objects: Record<string, any>
  defaults: Record<string, any>
  dynamicImports: Record<string, DynamicImporter>
}

const getRegistry = (): Registry => {
  const globalObject = globalThis as any
  const symbol = Symbol.for(REGISTRY_KEY)
  let registry: Registry | undefined = globalObject[symbol]
  if (!registry) {
    registry = {
      objects: Object.create(null),
      defaults: Object.create(null),
      dynamicImports: Object.create(null),
    }
    try {
      Object.defineProperty(globalObject, symbol, {
        value: registry,
        configurable: true,
      })
    } catch {
      globalObject[symbol] = registry
    }
  }
  if (!registry.dynamicImports) {
    registry.dynamicImports = Object.create(null)
  }
  return registry
}

const isObjectLike = (value: any): boolean =>
  value !== null && (typeof value === 'object' || typeof value === 'function')

/** Mirrors the original loader's `interopRequireDefault` behavior. */
const getDefaultExport = (value: any): any => {
  if (!isObjectLike(value)) return value
  const isEsModule = value.__esModule === true
  const isNamespace =
    !isEsModule && Object.prototype.toString.call(value) === '[object Module]'
  if ((isEsModule || isNamespace) && 'default' in value) return value.default
  return value
}

/**
 * Register an object for use by a generated shim module. Returns a unique key.
 */
function registerObject(value: any): string {
  const registry = getRegistry()
  const key = `${INSTANCE_ID}:${objectCounter++}`
  registry.objects[key] = value
  registry.defaults[key] = getDefaultExport(value)
  return key
}

/**
 * Register a runtime dynamic-import implementation and return the module-level
 * binding that generated modules should use to call it.
 */
export function createDynamicImportBinding(
  name: string,
  importer: DynamicImporter,
): string {
  const registry = getRegistry()
  const key = `${INSTANCE_ID}:d${dynamicImporterCounter++}`
  registry.dynamicImports[key] = importer
  return `const ${name} = globalThis[Symbol.for(${JSON.stringify(REGISTRY_KEY)})].dynamicImports[${JSON.stringify(key)}];`
}

const RESERVED_WORDS = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

const IDENTIFIER_RE = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u

const isExportableName = (name: string): boolean =>
  name !== 'default' &&
  // Exporting `then` makes the whole module namespace thenable, which breaks
  // dynamic import. No Vue export is named `then`.
  name !== 'then' &&
  !RESERVED_WORDS.has(name) &&
  IDENTIFIER_RE.test(name)

function getNamedExportNames(value: any): string[] {
  if (!isObjectLike(value)) return []
  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return []
  }
  return keys.filter(isExportableName)
}

/**
 * Build and register a shim module that re-exports all enumerable properties
 * of `value`. Returns an importable blob/data URL.
 */
export function createObjectShimUrl(value: any, debugName?: string): string {
  const key = registerObject(value)
  const names = getNamedExportNames(value)

  let helper = '__vsf_lite_shim__'
  while (names.includes(helper)) helper += '_'

  const registry = `globalThis[Symbol.for(${JSON.stringify(REGISTRY_KEY)})]`
  const lines = [
    `const ${helper} = (${registry}.objects[${JSON.stringify(key)}] ?? {});`,
    `export default ${registry}.defaults[${JSON.stringify(key)}];`,
  ]
  for (const name of names) {
    lines.push(`export const ${name} = ${helper}[${JSON.stringify(name)}];`)
  }

  return createModuleUrl(lines.join('\n'), `object:${debugName ?? key}`)
}

const isNodeRuntime = (): boolean => {
  try {
    // Declared locally so the generated .d.ts does not depend on @types/node.
    const nodeProcess = (globalThis as any).process
    return (
      !!nodeProcess &&
      !!nodeProcess.versions &&
      typeof nodeProcess.versions.node === 'string'
    )
  } catch {
    return false
  }
}

const sanitizeSourceURL = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]/g, '_')

function withSourceUrl(source: string, name: string): string {
  // Do not append if the caller already provided one.
  if (/\/\/# sourceURL=/.test(source)) return source
  return `${source}\n//# sourceURL=${sanitizeSourceURL(`vue3-sfc-loader-lite/${name}`)}`
}

/**
 * Create an importable URL for an ES module source string.
 */
export function createModuleUrl(source: string, debugName = 'module'): string {
  const code = withSourceUrl(source, debugName)

  if (!isNodeRuntime()) {
    try {
      if (
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function' &&
        typeof Blob !== 'undefined'
      ) {
        return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      }
    } catch {
      // fall through to data URL
    }
  }

  if (typeof encodeURIComponent !== 'function') {
    throw new Error('[vue3-sfc-loader-lite] unable to create a module URL in this environment')
  }
  // `'` is not escaped by encodeURIComponent and would break single-quoted
  // import specifiers when this URL is nested in another generated module.
  return (
    'data:text/javascript;charset=utf-8,' +
    encodeURIComponent(code).replace(/'/g, '%27')
  )
}

/** Native dynamic import that bundlers must not try to resolve. */
export function importModule(url: string): Promise<any> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ url)
}

/** Await a `Loading` placeholder stored in `moduleCache`. */
export async function resolveCachedValue(value: any): Promise<any> {
  return value instanceof Loading ? await value.promise : value
}
