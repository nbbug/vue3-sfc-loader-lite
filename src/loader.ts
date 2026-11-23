import { formatError } from './errors'
import { createJSModule, type JSModuleResult, type ModuleState } from './moduleRuntime'
import {
  createModuleUrl,
  importModule,
  createObjectShimUrl,
  createDynamicImportBinding,
  resolveCachedValue,
} from './moduleUrl'
import { Loading } from './loading'
import {
  defaultGetPathname,
  defaultPathResolve,
  extnamePosix,
  isBareSpecifier,
} from './path'
import { createSFCModule, type SFCCompilationContext } from './sfc'
import {
  asPrecompiledSFC,
  executePrecompiledArtifact,
  parsePrecompiledArtifact,
  type PrecompiledModuleContext,
} from './precompiled'
import type {
  AbstractPath,
  ContentData,
  File,
  ModuleExport,
  Options,
  PathContext,
  PrecompiledSFC,
  Resource,
} from './types'

/**
 * Build the default `Resource` implementation.
 *
 * The resource id is the resolved path string (including query strings); it is
 * the key used in `moduleCache`, exactly like the original loader.
 */
function defaultGetResource(pathCx: PathContext, options: Options): Resource {
  const pathResolve = options.pathResolve ?? defaultPathResolve
  const path = pathResolve(pathCx, options)
  const pathStr = path.toString()
  const getPathname = options.getPathname ?? defaultGetPathname

  return {
    id: pathStr,
    path,
    getContent: async (): Promise<File> => {
      if (!options.getFile) {
        throw new ReferenceError(
          '[vue3-sfc-loader-lite] options.getFile() is not defined (and no custom options.getResource() was provided)',
        )
      }

      const res = await options.getFile(path)

      if (typeof res === 'string' || res instanceof ArrayBuffer) {
        const type = extnamePosix(getPathname(pathStr))
        return {
          type,
          getContentData: async (asBinary: boolean): Promise<ContentData> => {
            const isBinary = res instanceof ArrayBuffer
            if (isBinary !== asBinary) {
              options.log?.(
                'warn',
                `unexpected data type. ${asBinary ? 'binary' : 'string'} is expected for "${path}"`,
              )
            }
            return res
          },
        }
      }

      if (!res) {
        const message = `There is no file available such as "${path}"`
        options.log?.('error', message)
        throw new Error(message)
      }

      return {
        type: res.type !== undefined ? res.type : extnamePosix(getPathname(pathStr)),
        getContentData: res.getContentData,
      }
    },
  }
}

const moduleStates = new WeakMap<object, ModuleState>()

/** @internal */
export function getModuleState(moduleCache: object): ModuleState {
  let state = moduleStates.get(moduleCache)
  if (!state) {
    state = {
      urls: new Map(),
      namespaces: new Map(),
      exports: new Map(),
      shims: new Map(),
      bareLogged: new Set(),
    }
    moduleStates.set(moduleCache, state)
  }
  return state
}

const clearModuleState = (state: ModuleState, id: string): void => {
  state.urls.delete(id)
  state.namespaces.delete(id)
  state.exports.delete(id)
  state.shims.delete(id)
}

const registerModule = (
  state: ModuleState,
  id: string,
  moduleExport: ModuleExport,
  namespace?: any,
  url?: string,
): void => {
  state.exports.set(id, moduleExport)
  if (namespace !== undefined) state.namespaces.set(id, namespace)
  if (url !== undefined) state.urls.set(id, url)
  state.shims.delete(id)
}

const getShimUrl = (state: ModuleState, id: string, value: any): string => {
  const existing = state.shims.get(id)
  if (existing && existing.value === value) return existing.url
  const url = createObjectShimUrl(value, id)
  state.shims.set(id, { url, value })
  return url
}

let dynamicImportCounter = 0

/**
 * Create the lazy dynamic-import binding injected into generated modules.
 * Replacing `import(spec)` with a helper call (instead of eagerly resolving it)
 * keeps recursive `defineAsyncComponent(() => import('./Self.vue'))` working.
 */
const createDynamicImportSupport = (
  options: Options,
  state: ModuleState,
  refPath: AbstractPath,
): { helperName: string; getBindingSource: () => string } => {
  const helperName = `__vsf_lite_dynamic_import_${dynamicImportCounter++}__`
  let bindingSource: string | undefined

  const getBindingSource = (): string => {
    if (bindingSource !== undefined) return bindingSource

    bindingSource = createDynamicImportBinding(helperName, async (rawSpecifier) => {
      const specifier = String(rawSpecifier)

      if (/^(?:data|blob):/i.test(specifier)) {
        return await importModule(specifier)
      }

      const getResource = options.getResource ?? defaultGetResource
      const resource = getResource({ refPath, relPath: specifier }, options)
      const id = resource.id.toString()
      const moduleCache = options.moduleCache

      // Leave import-map/package bare specifiers to the browser when the loader
      // has no cached value and no hook that could handle them.
      if (
        isBareSpecifier(specifier) &&
        id === specifier &&
        !(id in moduleCache) &&
        !options.loadModule
      ) {
        return await importModule(specifier)
      }

      await loadModuleInternal({ refPath, relPath: specifier }, options, new Set())

      if (state.urls.has(id)) {
        return await importModule(state.urls.get(id)!)
      }

      return await importModule(getShimUrl(state, id, moduleCache[id]))
    })

    return bindingSource
  }

  return { helperName, getBindingSource }
}

/** Common module-resolution context used by SFC and precompiled artifacts. */
const createBaseModuleContext = (
  options: Options,
  state: ModuleState,
  chain: Set<string>,
): PrecompiledModuleContext => ({
  options,
  resolveSpecifier: (specifier, refPath) =>
    resolveSpecifier(specifier, refPath, options, state, chain),
  createDynamicImportSupport: (refPath) =>
    createDynamicImportSupport(options, state, refPath),
})

const readText = async (
  getContentData: File['getContentData'],
  path: AbstractPath,
): Promise<string> => {
  const data = await getContentData(false)
  if (typeof data !== 'string') {
    throw new Error(
      `[vue3-sfc-loader-lite] expected text content for "${path}" but received binary data`,
    )
  }
  return data
}

const cycleError = (chain: Set<string>, id: string): Error =>
  new Error(
    `[vue3-sfc-loader-lite] circular dependency detected: ${[...chain, id].join(' -> ')}. ` +
      'Static circular imports are not supported; use defineAsyncComponent() / dynamic import for recursive components.',
  )

/**
 * Resolve one module specifier to an importable module URL.
 *
 * - specifiers already in `moduleCache` become object shims or their loaded URL
 * - bare specifiers that are not cached are left to the browser import map
 * - paths/URLs are loaded recursively
 */
async function resolveSpecifier(
  specifier: string,
  refPath: AbstractPath,
  options: Options,
  state: ModuleState,
  chain: Set<string>,
): Promise<string | null | undefined> {
  // Already a browser module URL: leave it untouched.
  if (/^(?:data|blob):/i.test(specifier)) return specifier

  const getResource = options.getResource ?? defaultGetResource
  const resource = getResource({ refPath, relPath: specifier }, options)
  const id = resource.id.toString()
  const moduleCache = options.moduleCache

  if (id in moduleCache) {
    const cached = moduleCache[id]

    if (cached instanceof Loading) {
      if (chain.has(id)) throw cycleError(chain, id)
      await cached.promise
      const resolved = moduleCache[id]
      if (state.urls.has(id) && state.exports.get(id) === resolved) {
        return state.urls.get(id)
      }
      return getShimUrl(state, id, resolved)
    }

    if (state.urls.has(id) && state.exports.get(id) === cached) {
      return state.urls.get(id)
    }

    return getShimUrl(state, id, cached)
  }

  // Cache entry was removed, but this module is still part of the graph.
  if (state.urls.has(id) && state.exports.has(id)) {
    return state.urls.get(id)
  }

  // Bare specifier, untouched by custom path resolution: let the browser's
  // import map handle it. When a `loadModule` hook is provided, give the hook
  // a chance first (this mirrors the original loader's behavior for virtual
  // modules).
  if (isBareSpecifier(specifier) && id === specifier && !options.loadModule) {
    if (!state.bareLogged.has(id)) {
      state.bareLogged.add(id)
      options.log?.(
        'info',
        'module resolution',
        `"${specifier}" is not in options.moduleCache; leaving the bare specifier to the browser import map`,
      )
    }
    return null
  }

  await loadModuleInternal({ refPath, relPath: specifier }, options, chain)

  const resolved = moduleCache[id]
  if (state.urls.has(id) && state.exports.get(id) === resolved) {
    return state.urls.get(id)
  }
  return getShimUrl(state, id, resolved)
}

/** Create the importable module for a `.js` / `.mjs` resource. */
async function createScriptModule(
  source: string,
  path: AbstractPath,
  options: Options,
  state: ModuleState,
  chain: Set<string>,
): Promise<JSModuleResult> {
  let result: JSModuleResult
  const context = createBaseModuleContext(options, state, chain)
  try {
    result = await createJSModule(source, path, {
      resolveSpecifier: (specifier) => context.resolveSpecifier(specifier, path),
      createDynamicImportSupport: context.createDynamicImportSupport,
    })
  } catch (error: any) {
    if (!error?.message?.includes('Failed to parse ES module')) {
      options.log?.(
        'error',
        'module script',
        formatError(String(error?.message ?? error), path.toString(), source),
      )
    }
    throw error
  }
  return result
}

/**
 * Native module handling. `handleModule` from options runs before this.
 */
async function handleModuleInternal(
  type: string,
  getContentData: File['getContentData'],
  path: AbstractPath,
  id: string,
  options: Options,
  state: ModuleState,
  chain: Set<string>,
): Promise<ModuleExport | undefined> {
  const normalizedType = type.startsWith('.')
    ? type.toLowerCase()
    : type.includes('/')
      ? type.toLowerCase()
      : `.${type.toLowerCase()}`

  switch (normalizedType) {
    case '.vue': {
      clearModuleState(state, id)
      const source = await readText(getContentData, path)
      const baseContext = createBaseModuleContext(options, state, chain)

      const precompiled = parsePrecompiledArtifact(source)
      if (precompiled) {
        const precompiledResult = await executePrecompiledArtifact(
          precompiled,
          path,
          baseContext,
        )
        registerModule(
          state,
          id,
          precompiledResult.component,
          precompiledResult.namespace,
          precompiledResult.url,
        )
        return precompiledResult.component
      }

      const context: SFCCompilationContext = {
        ...baseContext,
        loadText: async (pathCx) => {
          const resource = (options.getResource ?? defaultGetResource)(pathCx, options)
          const file = await resource.getContent()
          return {
            content: await readText(file.getContentData, resource.path),
            path: resource.path,
          }
        },
        getVueRuntime: async () => {
          const resource = (options.getResource ?? defaultGetResource)(
            { refPath: path, relPath: 'vue' },
            options,
          )
          const vueId = resource.id.toString()

          if (vueId in options.moduleCache) {
            const value = await resolveCachedValue(options.moduleCache[vueId])
            // CJS interop: { __esModule: true, default: Vue }
            if (value && value.__esModule === true && value.default !== undefined) {
              return value.default
            }
            return value
          }

          const vueUrl = await resolveSpecifier('vue', path, options, state, chain)
          if (vueUrl) return await importModule(vueUrl)

          throw new Error(
            `[vue3-sfc-loader-lite] options.moduleCache must contain "vue" to compile the template of "${path}"`,
          )
        },
      }

      const result = await createSFCModule(source, path, context)
      registerModule(state, id, result.component, result.namespace, result.url)
      return result.component
    }

    case '.js':
    case '.mjs': {
      clearModuleState(state, id)
      const source = await readText(getContentData, path)
      const result = await createScriptModule(source, path, options, state, chain)
      registerModule(state, id, result.namespace, result.namespace, result.url)
      return result.namespace
    }

    case '.json': {
      clearModuleState(state, id)
      const source = await readText(getContentData, path)

      const precompiled = parsePrecompiledArtifact(source)
      if (precompiled) {
        const precompiledResult = await executePrecompiledArtifact(
          precompiled,
          path,
          createBaseModuleContext(options, state, chain),
        )
        registerModule(
          state,
          id,
          precompiledResult.component,
          precompiledResult.namespace,
          precompiledResult.url,
        )
        return precompiledResult.component
      }

      let value: any
      try {
        value = JSON.parse(source)
      } catch (error: any) {
        const message = `Invalid JSON in "${path}": ${String(error?.message ?? error)}`
        options.log?.('error', 'module json', message)
        throw new Error(`[vue3-sfc-loader-lite] ${message}`)
      }
      const jsonSource = `export default ${JSON.stringify(value)};\n`
      const url = createModuleUrl(jsonSource, `${path}?json`)
      const namespace = await importModule(url)
      registerModule(state, id, namespace, namespace, url)
      return namespace
    }

    case '.ts':
    case '.tsx':
    case '.jsx':
      throw new Error(
        `[vue3-sfc-loader-lite] "${path}" uses TypeScript/JSX, which the lite loader does not transpile. ` +
          'Pre-compile it to JavaScript or use the full vue3-sfc-loader.',
      )

    default:
      return undefined
  }
}

/**
 * Load a module and store it in `moduleCache`.
 *
 * @internal
 */
export async function loadModuleInternal(
  pathCx: PathContext,
  options: Options,
  chain: Set<string> = new Set(),
): Promise<ModuleExport> {
  const getResource = options.getResource ?? defaultGetResource
  const resource = getResource(pathCx, options)
  const id = resource.id.toString()
  const moduleCache = options.moduleCache
  const state = getModuleState(moduleCache)

  if (id in moduleCache) {
    const cached = moduleCache[id]
    if (cached instanceof Loading) {
      if (chain.has(id)) throw cycleError(chain, id)
      return await cached.promise
    }
    return cached
  }

  if (chain.has(id)) throw cycleError(chain, id)

  const nextChain = new Set(chain)
  nextChain.add(id)

  const promise = (async (): Promise<ModuleExport> => {
    let moduleExport: ModuleExport | undefined

    if (options.loadModule) {
      moduleExport = await options.loadModule(id, options)
    }

    if (moduleExport === undefined) {
      const file = await resource.getContent()

      if (options.handleModule) {
        moduleExport = await options.handleModule(
          file.type,
          file.getContentData,
          resource.path,
          options,
        )
      }

      if (moduleExport === undefined) {
        moduleExport = await handleModuleInternal(
          file.type,
          file.getContentData,
          resource.path,
          id,
          options,
          state,
          nextChain,
        )
      }

      if (moduleExport === undefined) {
        throw new TypeError(
          `[vue3-sfc-loader-lite] unable to handle "${file.type}" files (${resource.path})`,
        )
      }
    }

    moduleCache[id] = moduleExport
    return moduleExport
  })()

  const loading = new Loading(promise)
  moduleCache[id] = loading

  try {
    return await promise
  } catch (error) {
    if (moduleCache[id] === loading) delete moduleCache[id]
    throw error
  }
}

const normalizeOptions = (options: Options): Options => {
  if (options === undefined || options === null) {
    throw new ReferenceError('[vue3-sfc-loader-lite] options is not defined')
  }

  const moduleCache = options.moduleCache
  if (moduleCache === null || typeof moduleCache !== 'object') {
    throw new ReferenceError('[vue3-sfc-loader-lite] options.moduleCache is not defined')
  }

  // moduleCache should be prototype-less so `constructor`, `__proto__`, etc.
  // cannot accidentally resolve as modules.
  try {
    Object.setPrototypeOf(moduleCache, null)
  } catch {
    // a frozen/non-extensible cache is still usable
  }

  const normalizedOptions: Options = {
    ...options,
    moduleCache,
    pathResolve: options.pathResolve ?? defaultPathResolve,
    getPathname: options.getPathname ?? defaultGetPathname,
    getResource: options.getResource ?? defaultGetResource,
  }

  if (normalizedOptions.devMode && normalizedOptions.compiledCache === undefined) {
    normalizedOptions.log?.(
      'info',
      'options.compiledCache is not defined, performance will be affected',
    )
  }

  return normalizedOptions
}

/**
 * Normalize the public options and load the entry module.
 *
 * @param path The path of the `.vue` file. If it is not a path (e.g. a string
 *   ID), `getFile` must return the content for it.
 * @param options The options. `moduleCache` must be shared by all calls.
 */
export async function loadModule(
  path: AbstractPath,
  options: Options,
): Promise<ModuleExport> {
  const normalizedOptions = normalizeOptions(options)
  return await loadModuleInternal(
    { refPath: undefined, relPath: path },
    normalizedOptions,
    new Set(),
  )
}

/**
 * Load a precompiled artifact produced by `precompileSFC()` without parsing or
 * compiling the original `.vue` source.
 *
 * `artifact` may be the object itself or its JSON string. `path` is the
 * logical path used for relative imports and the module cache id (defaults to
 * `artifact.filename`).
 */
export async function loadPrecompiled(
  artifact: PrecompiledSFC | string,
  options: Options,
  path?: AbstractPath,
): Promise<ModuleExport> {
  const parsed =
    typeof artifact === 'string'
      ? parsePrecompiledArtifact(artifact)
      : asPrecompiledSFC(artifact)

  if (!parsed) {
    throw new TypeError(
      '[vue3-sfc-loader-lite] loadPrecompiled() received an invalid precompiled artifact',
    )
  }

  const normalizedOptions = normalizeOptions(options)
  const moduleCache = normalizedOptions.moduleCache
  const artifactPath = path ?? parsed.filename
  const id = artifactPath.toString()
  const state = getModuleState(moduleCache)

  if (id in moduleCache) {
    const cached = moduleCache[id]
    if (cached instanceof Loading) return await cached.promise
    return cached
  }

  const chain = new Set<string>([id])
  const promise = (async (): Promise<ModuleExport> => {
    const result = await executePrecompiledArtifact(
      parsed,
      artifactPath,
      createBaseModuleContext(normalizedOptions, state, chain),
    )
    registerModule(state, id, result.component, result.namespace, result.url)
    moduleCache[id] = result.component
    return result.component
  })()

  const loading = new Loading(promise)
  moduleCache[id] = loading

  try {
    return await promise
  } catch (error) {
    if (moduleCache[id] === loading) delete moduleCache[id]
    throw error
  }
}
