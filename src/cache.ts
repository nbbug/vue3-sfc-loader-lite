import { hash } from './hash'
import type { Cache } from './types'

/** @internal */
export type ValueFactoryApi = {
  /** Call when the produced value must not be written to the cache. */
  preventCache(): void
}

/** @internal */
export type ValueFactory<T> = (api: ValueFactoryApi) => Promise<T> | T

/**
 * Simple cache helper. A failing cache must never break module loading, so
 * cache errors are reported through `log` and ignored.
 *
 * @internal
 */
export async function withCache<T>(
  cache: Cache | undefined,
  keyParts: any[],
  factory: ValueFactory<T>,
  log?: (type: string, ...data: any[]) => void,
): Promise<T> {
  let prevented = false
  const api: ValueFactoryApi = {
    preventCache() {
      prevented = true
    },
  }

  if (cache === undefined) return await factory(api)

  const cacheKey = hash(...keyParts)

  try {
    const raw = await cache.get(cacheKey)
    if (raw !== undefined && raw !== null) {
      return JSON.parse(raw) as T
    }
  } catch (error) {
    log?.('warn', 'compiledCache.get failed; recomputing', error)
  }

  const value = await factory(api)

  if (!prevented) {
    try {
      await cache.set(cacheKey, JSON.stringify(value))
    } catch (error) {
      log?.('warn', 'compiledCache.set failed; compilation result was not cached', error)
    }
  }

  return value
}
