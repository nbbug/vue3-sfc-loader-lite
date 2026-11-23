import { describe, expect, it } from 'vitest'
import {
  defaultGetPathname,
  defaultPathResolve,
  dirnamePosix,
  extnamePosix,
  isBareSpecifier,
  joinPosix,
  normalizePosix,
} from '../../src/path'
import type { Options } from '../../src/types'

const options = { moduleCache: {} } as Options

describe('posix path helpers', () => {
  it('normalizes dot segments', () => {
    expect(normalizePosix('./a/./b/../c')).toBe('a/c')
    expect(normalizePosix('/a/b/../c')).toBe('/a/c')
    expect(normalizePosix('a//b///c')).toBe('a/b/c')
    expect(normalizePosix('')).toBe('.')
    expect(normalizePosix('/')).toBe('/')
    expect(normalizePosix('../../a')).toBe('../../a')
  })

  it('joins and resolves dirs', () => {
    expect(joinPosix('/a/b', '../c.vue')).toBe('/a/c.vue')
    expect(joinPosix('a', 'b', 'c')).toBe('a/b/c')
    expect(dirnamePosix('/a/b/c.vue')).toBe('/a/b')
    expect(dirnamePosix('c.vue')).toBe('.')
    expect(dirnamePosix('/c.vue')).toBe('/')
  })

  it('extracts extensions like node', () => {
    expect(extnamePosix('/a/b.vue')).toBe('.vue')
    expect(extnamePosix('/a/b.tar.gz')).toBe('.gz')
    expect(extnamePosix('/a/.vue')).toBe('')
    expect(extnamePosix('/a/b')).toBe('')
  })
})

describe('defaultGetPathname', () => {
  it('removes the search string only', () => {
    expect(defaultGetPathname('./a.vue?v=1')).toBe('./a.vue')
    expect(defaultGetPathname('./a.vue')).toBe('./a.vue')
    expect(defaultGetPathname('/a?x=1#frag')).toBe('/a')
  })
})

describe('defaultPathResolve', () => {
  it('resolves relative imports against the reference path', () => {
    expect(
      defaultPathResolve(
        { refPath: '/components/App.vue', relPath: './Child.vue' },
        options,
      ),
    ).toBe('/components/Child.vue')

    expect(
      defaultPathResolve(
        { refPath: '/components/App.vue', relPath: '../lib/util.js' },
        options,
      ),
    ).toBe('/lib/util.js')
  })

  it('strips the query string of the reference path', () => {
    expect(
      defaultPathResolve(
        { refPath: '/components/App.vue?v=2', relPath: './Child.vue' },
        options,
      ),
    ).toBe('/components/Child.vue')
  })

  it('keeps bare and absolute specifiers as-is', () => {
    const bare = { toString: () => 'vue' }
    expect(defaultPathResolve({ refPath: '/App.vue', relPath: bare }, options)).toBe(bare)
    expect(
      defaultPathResolve({ refPath: '/App.vue', relPath: '/abs.vue' }, options),
    ).toBe('/abs.vue')
    expect(
      defaultPathResolve(
        { refPath: '/App.vue', relPath: 'https://cdn/x.vue' },
        options,
      ),
    ).toBe('https://cdn/x.vue')
  })

  it('returns the entry path when refPath is undefined', () => {
    expect(
      defaultPathResolve({ refPath: undefined, relPath: './App.vue' }, options),
    ).toBe('./App.vue')
  })
})

describe('isBareSpecifier', () => {
  it('distinguishes bare names, paths and URLs', () => {
    expect(isBareSpecifier('vue')).toBe(true)
    expect(isBareSpecifier('lodash-es')).toBe(true)
    expect(isBareSpecifier('#internal')).toBe(true)
    expect(isBareSpecifier('./a.vue')).toBe(false)
    expect(isBareSpecifier('../a.vue')).toBe(false)
    expect(isBareSpecifier('/a.vue')).toBe(false)
    expect(isBareSpecifier('https://cdn/a.vue')).toBe(false)
    expect(isBareSpecifier('data:text/javascript,1')).toBe(false)
    expect(isBareSpecifier('blob:http://x/y')).toBe(false)
  })
})
