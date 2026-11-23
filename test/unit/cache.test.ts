import { describe, expect, it, vi } from 'vitest'
import { withCache } from '../../src/cache'
import type { Cache } from '../../src/types'

const createCache = (storage: Record<string, string> = {}): Cache => ({
  get: vi.fn(async (key: string) => storage[key]),
  set: vi.fn(async (key: string, value: string) => {
    storage[key] = value
  }),
})

describe('withCache', () => {
  it('computes when no cache is provided', async () => {
    const factory = vi.fn(async () => 'value')
    await expect(withCache(undefined, ['k'], factory)).resolves.toBe('value')
    expect(factory).toHaveBeenCalledOnce()
  })

  it('stores and reuses values', async () => {
    const cache = createCache()
    const first = vi.fn(async () => 'first')
    await expect(withCache(cache, ['key', 1], first)).resolves.toBe('first')
    const second = vi.fn(async () => 'second')
    await expect(withCache(cache, ['key', 1], second)).resolves.toBe('first')
    expect(second).not.toHaveBeenCalled()
  })

  it('does not cache when preventCache is called', async () => {
    const cache = createCache()
    await expect(
      withCache(cache, ['key'], async ({ preventCache }) => {
        preventCache()
        return 'value'
      }),
    ).resolves.toBe('value')
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('ignores cache read/write failures', async () => {
    const log = vi.fn()
    const cache: Cache = {
      get: async () => {
        throw new Error('read failed')
      },
      set: async () => {
        throw new Error('write failed')
      },
    }
    await expect(
      withCache(cache, ['key'], async () => 'value', log),
    ).resolves.toBe('value')
    expect(log).toHaveBeenCalledWith(
      'warn',
      'compiledCache.get failed; recomputing',
      expect.any(Error),
    )
    expect(log).toHaveBeenCalledWith(
      'warn',
      'compiledCache.set failed; compilation result was not cached',
      expect.any(Error),
    )
  })

  it('recomputes when the cached value is invalid JSON', async () => {
    const storage: Record<string, string> = {}
    let storedKey = ''
    const cache: Cache = {
      get: async (key) => {
        storedKey = key
        return storage[key]
      },
      set: async (key, value) => {
        storedKey = key
        storage[key] = value
      },
    }

    await withCache(cache, ['key'], async () => 'valid')
    storage[storedKey] = 'not json'

    const factory = vi.fn(async () => 'recomputed')
    const log = vi.fn()
    await expect(withCache(cache, ['key'], factory, log)).resolves.toBe('recomputed')
    expect(factory).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(
      'warn',
      'compiledCache.get failed; recomputing',
      expect.any(Error),
    )
  })
})
