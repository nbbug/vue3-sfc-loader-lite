import type { AbstractPath, Options, PathContext, PathResolve } from './types'

/**
 * Minimal POSIX path helpers.
 *
 * The original loader depends on `path-browserify`; these few functions are
 * all that is needed and keep the bundle small.
 */

const posixSplit = (path: string): string[] => path.split('/')

/** Normalize a POSIX path (`.` and `..` segments, duplicate slashes). */
export function normalizePosix(path: string): string {
  if (path.length === 0) return '.'

  const isAbsolute = path.charCodeAt(0) === 47 // '/'
  const trailingSlash = path.length > 1 && path.charCodeAt(path.length - 1) === 47

  const parts: string[] = []
  for (const part of posixSplit(path)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') {
        parts.pop()
      } else if (!isAbsolute) {
        parts.push('..')
      }
      continue
    }
    parts.push(part)
  }

  let normalized = parts.join('/')
  if (isAbsolute) normalized = '/' + normalized
  if (normalized === '') normalized = isAbsolute ? '/' : '.'
  if (trailingSlash && normalized !== '/' && !normalized.endsWith('/')) normalized += '/'
  return normalized
}

export function joinPosix(...parts: string[]): string {
  const nonEmpty = parts.filter((part) => part !== '')
  if (nonEmpty.length === 0) return '.'
  return normalizePosix(nonEmpty.join('/'))
}

export function dirnamePosix(path: string): string {
  if (path === '') return '.'
  const normalized = path.replace(/\/+$/, '')
  if (normalized === '') return '/'
  const slash = normalized.lastIndexOf('/')
  if (slash === -1) return '.'
  if (slash === 0) return '/'
  return normalized.slice(0, slash)
}

export function extnamePosix(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot)
}

/**
 * Default `getPathname`: remove the search string (`?query`).
 */
export const defaultGetPathname = (path: string): string => {
  const searchPos = path.indexOf('?')
  return searchPos !== -1 ? path.slice(0, searchPos) : path
}

/**
 * Default path resolution. Handles three situations:
 *  - a relative path (e.g. `import './details.vue'`)
 *  - an absolute path (e.g. `import '/components/card.vue'`)
 *  - a module name (e.g. `import { ref } from 'vue'`)
 */
export const defaultPathResolve: PathResolve = (
  { refPath, relPath }: PathContext,
  options: Options,
): AbstractPath => {
  const getPathname = options.getPathname ?? defaultGetPathname

  // initial resolution: refPath is undefined
  if (refPath === undefined) return relPath

  const relPathStr = relPath.toString()

  // non-relative path
  if (relPathStr[0] !== '.') return relPath

  return normalizePosix(
    joinPosix(dirnamePosix(getPathname(refPath.toString())), relPathStr),
  )
}

/**
 * True when a specifier is a bare module name (e.g. `vue`, `lodash-es`,
 * `#internal`). Such specifiers are left untouched when they are not present in
 * `moduleCache`, so the browser's import map can resolve them.
 */
export function isBareSpecifier(specifier: string): boolean {
  if (specifier === '') return false
  const first = specifier[0]
  if (first === '.' || first === '/' || first === '\\') return false
  // URI scheme: https:, data:, blob:, file:, ...
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(specifier)) return false
  return true
}
