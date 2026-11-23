/**
 * Public types of vue3-sfc-loader-lite.
 *
 * The option surface intentionally mirrors `vue3-sfc-loader` so existing code
 * can switch by only changing the imported package / script URL. Options that
 * only existed to configure Babel or PostCSS are gone: the lite loader treats
 * `<script>` as a browser-ready ES module and `<style>` as plain CSS.
 */

export type ModuleCacheId = string

/**
 * An abstract way to specify a path. It can be a string or an object such as a
 * URL. An AbstractPath must always be convertible to a string.
 */
export type AbstractPath = {
  toString(): string
}

/**
 * A PathContext represents a path (`relPath`) relative to an absolute path
 * (`refPath`). `relPath` is not necessarily relative: when it is, it is
 * resolved against `refPath`.
 */
export type PathContext = {
  /** reference path */
  refPath: AbstractPath | undefined
  /** relative to `refPath` */
  relPath: AbstractPath
}

/** Relative to absolute module path resolution. */
export type PathResolve = (pathCx: PathContext, options: Options) => AbstractPath

export type ContentData = string | ArrayBuffer

/**
 * Represents a file content and its type (usually the file extension).
 */
export type File = {
  /** The content data accessor (request data as text or binary). */
  getContentData: (asBinary: boolean) => Promise<ContentData> | ContentData
  /** The content type (file extension name, e.g. `.vue`). */
  type: string
}

/**
 * Represents a resource. `id` is used as the key of `Options.moduleCache`.
 */
export type Resource = {
  id: ModuleCacheId
  path: AbstractPath
  getContent: () => Promise<File>
}

export type CustomBlock = {
  type: string
  content: string
  attrs: Record<string, string | true>
}

export type CustomBlockCallback = (component: ModuleExport) => void

/**
 * Used by the library for file types it does not know how to handle natively
 * (e.g. `.json`, `.svg`, ...). Return `undefined` to let the library continue.
 */
export type ModuleHandler = (
  type: string,
  getContentData: File['getContentData'],
  path: AbstractPath,
  options: Options,
) => Promise<ModuleExport | undefined>

/**
 * Represents a loaded JS module exports / a Vue component.
 */
export type ModuleExport = any

/** @internal */
export type LoadingType<T> = {
  promise: Promise<T>
}

/**
 * Asynchronous cache used by `compiledCache`. Both `get` and `set` may return
 * a promise (as in the original loader) or a plain value.
 */
export type Cache = {
  get(key: string): Promise<string | undefined> | string | undefined
  set(key: string, value: string): Promise<void> | void
}

export type Options = {
  /**
   * Initial cache containing resolved dependencies. All new modules are stored
   * here. `vue` must initially be contained in this object.
   *
   * It is recommended to use a prototype-less object. The loader sets the
   * prototype to `null` when possible to avoid conflicts with `Object`
   * properties (`constructor`, `__proto__`, ...).
   *
   * The cache must be shared between all `loadModule` calls of an application.
   */
  moduleCache: Record<ModuleCacheId, LoadingType<ModuleExport> | ModuleExport>

  /**
   * Called when the library needs a file. Return either the text/ArrayBuffer
   * directly or an object with `getContentData` and `type`.
   */
  getFile?: (path: AbstractPath) => Promise<File | ContentData>

  /**
   * Called when a `<style>` block must be injected into the document.
   * Required when the component has at least one style block.
   */
  addStyle?: (style: string, scopeId: string | undefined) => void

  /**
   * Called by the library when there is something to log. `type` follows
   * console method names (`error`, `warn`, `info`).
   */
  log?: (type: string, ...data: any[]) => void

  /** Delimiters used for text interpolation inside the template. */
  delimiters?: [string, string]

  /** Whitespace handling strategy. */
  whitespace?: 'preserve' | 'condense'

  /** Specifies a check method to recognize native custom elements. */
  isCustomElement?: (tag: string) => boolean

  /**
   * Handle additional module types (e.g. `.json`, `.svg`). The lite loader
   * natively handles `.vue`, `.js`, `.mjs` and `.json`.
   */
  handleModule?: ModuleHandler

  /**
   * `get()` / `set()` used to persist compiled template code and scoped CSS.
   * Compilation is CPU intensive, so providing this is recommended.
   */
  compiledCache?: Cache

  /**
   * Called when the library requires a module. Return `undefined` to let the
   * library handle it.
   */
  loadModule?: (path: AbstractPath, options: Options) => Promise<ModuleExport | undefined>

  /** Relative to absolute module path resolution. */
  pathResolve?: PathResolve

  /**
   * Returns the pathname part of a path (by default the search string is
   * removed). Use `path => path` if your paths must stay intact.
   */
  getPathname?: (path: string) => string

  /** Abstract resource handling. */
  getResource?: (pathCx: PathContext, options: Options) => Resource

  /**
   * Called for each custom block. The returned callback is invoked with the
   * component after it has been created.
   */
  customBlockHandler?: (
    block: CustomBlock,
    filename: AbstractPath,
    options: Options,
  ) => Promise<CustomBlockCallback | undefined>

  /**
   * Development mode: keeps production warnings in the template compiler.
   * The lite loader never minifies the generated ES modules.
   */
  devMode?: boolean
}
