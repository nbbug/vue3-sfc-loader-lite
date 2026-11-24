import { existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'
import { startTestServer, type TestServer } from './server'

let server: TestServer
let browser: Browser

const findChromium = (): string => {
  const expected = chromium.executablePath()
  if (existsSync(expected)) return expected

  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
  ].filter((value): value is string => !!value)

  for (const cache of caches) {
    if (!existsSync(cache)) continue
    const revisions = readdirSync(cache)
      .filter((entry) => entry.startsWith('chromium-'))
      .sort()
      .reverse()
    for (const revision of revisions) {
      const candidates = [
        path.join(
          cache,
          revision,
          'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        ),
        path.join(
          cache,
          revision,
          'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        ),
        path.join(cache, revision, 'chrome-linux/chrome'),
        path.join(cache, revision, 'chrome-win/chrome.exe'),
      ]
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate
      }
    }
  }

  throw new Error(
    'No Chromium binary found. Install one with `npx playwright install chromium` or set PLAYWRIGHT_BROWSERS_PATH.',
  )
}

type SceneResult = {
  error: string | null
  result: any
  console: string[]
}

const runScene = async (scene: string): Promise<SceneResult> => {
  const page: Page = await browser.newPage()
  const consoleMessages: string[] = []
  page.on('console', (message) => {
    consoleMessages.push(`${message.type()}: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    consoleMessages.push(`pageerror: ${error.message}`)
  })

  try {
    await page.goto(`${server.url}/${scene}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => (window as any).__done === true, undefined, {
      timeout: 20_000,
    })
    const output = await page.evaluate(() => ({
      error: (window as any).__error ?? null,
      result: (window as any).__result ?? null,
    }))
    return { ...output, console: consoleMessages }
  } finally {
    await page.close()
  }
}

beforeAll(async () => {
  server = await startTestServer()
  browser = await chromium.launch({
    executablePath: findChromium(),
    headless: true,
  })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('browser integration', () => {
  it('loads and mounts an SFC through the UMD build', async () => {
    const { error, result, console: logs } = await runScene('fixtures/basic.html')
    expect(error, logs.join('\n')).toBeNull()
    expect(result.text).toBe('HELLO child-HELLO')
    expect(result.hasScopedAttribute).toBe(true)
    expect(result.color).toBe('rgb(255, 0, 0)')
    expect(result.hasAlias).toBe(true)
    expect(result.exportsAlias).toEqual([
      'buildTemplateProcessor',
      'compilerVersion',
      'loadModule',
      'version',
      'vueVersion',
    ])
    expect(result.version).toBe('0.1.0')
    expect(result.vueVersion).toBe('3.5.46')
    expect(result.cacheKeys).toEqual([
      '/fixtures/basic-app.vue',
      '/fixtures/child.vue',
      '/fixtures/util.js',
      'vue',
    ])
  })

  it('works with the ESM build and an ES module namespace in moduleCache', async () => {
    const { error, result, console: logs } = await runScene('fixtures/esm.html')
    expect(error, logs.join('\n')).toBeNull()
    expect(result.text).toBe('HELLO child-HELLO')
    expect(result.hasScopedAttribute).toBe(true)
    expect(result.version).toBe('0.1.0')
    expect(result.vueVersion).toBe('3.5.46')
    expect(result.compilerVersion).toBe('3.5.46')
    expect(result.cacheKeys).toEqual([
      '/fixtures/basic-app.vue',
      '/fixtures/child.vue',
      '/fixtures/util.js',
      'vue',
    ])
  })

  it('supports moduleCache objects, custom blocks, hooks, JSON, txt, compiledCache and dynamic imports', async () => {
    const { error, result, console: logs } = await runScene('fixtures/options.html')
    expect(error, logs.join('\n')).toBeNull()

    expect(result.util).toBe('F:x')
    expect(result.json).toBe('7')
    expect(result.i18n).toBe('translated')
    expect(result.message.trim()).toBe('handled-text')
    expect(result.hooked).toBe('hooked')
    expect(result.lazy).toBe('lazy-loaded')

    expect(result.cacheSets).toBeGreaterThan(0)
    expect(result.cacheGets).toBeGreaterThan(0)
    expect(result.hookCalls).toContain('/fixtures/hooked.vue')
    expect(result.blockCalls).toEqual([{ type: 'i18n', content: 'translated' }])
    expect(result.handleCalls).toContain('.txt')
    expect(result.cacheKeys).toEqual(
      expect.arrayContaining([
        'vue',
        'my-utils',
        '/fixtures/options-app.vue',
        '/fixtures/lazy.vue',
        '/fixtures/data.json',
        '/fixtures/message.txt',
        '/fixtures/hooked.vue',
      ]),
    )
  })

  it('reports template, <script setup> and missing file errors', async () => {
    const { error, result, console: logs } = await runScene('fixtures/errors.html')
    expect(error, logs.join('\n')).toBeNull()

    expect(result.templateRejected).toBe(true)
    expect(result.templateError).toContain('failed to compile the template')
    expect(
      result.logs.some(
        (entry: any[]) => entry[0] === 'error' && entry[1] === 'SFC template',
      ),
    ).toBe(true)

    expect(result.tsRejected).toBe(true)
    expect(result.tsError).toContain('Only plain JavaScript')

    expect(result.missingRejected).toBe(true)
    expect(result.missingError).toContain('404')
  })

  it('supports complex template expressions, directives, v-model, slots and inline handlers', async () => {
    const { error, result, console: logs } = await runScene('fixtures/features.html')
    expect(error, logs.join('\n')).toBeNull()

    expect(result.expr).toBe('3')
    expect(result.classColor).toBe('rgb(255, 0, 0)')
    expect(result.items).toEqual(['0:x', '1:y'])
    expect(result.visible).toBe('visible')
    expect(result.hidden).toBeUndefined()
    expect(result.input).toBe('abc')
    expect(result.text).toBe('abc')
    expect(result.count).toBe('0')
    expect(result.setup).toBe('9')
    expect(result.computedDynamic).toBe('not-loaded')
    expect(result.slot).toBe('slotted')
    expect(result.slotColor).toBe('rgb(0, 128, 0)')
    expect(result.styles).toContain('@keyframes fade-')
    expect(result.afterToggle).toEqual({
      visible: null,
      hidden: 'hidden',
      classActive: false,
      count: '1',
      setup: '9',
      computedDynamic: 'computed-loaded',
    })
  })




  it('compiles and runs raw <script setup> SFCs at runtime', async () => {
    const { error, result, console: logs } = await runScene('fixtures/runtime-setup.html')
    expect(error, logs.join('\n')).toBeNull()

    expect(result.text.replace(/\s+/g, '')).toBe('runtime-setup21')
    expect(result.color).toBe('rgb(255, 0, 0)')
    expect(result.scopeId).toMatch(/^data-v-/)
    expect(result.afterClick).toBe('4')
    expect(result.cacheKeys).toEqual([
      '/fixtures/runtime-setup.vue',
      'vue',
    ])
  })

  it('supports recursive lazy dynamic imports', async () => {
    const { error, result, console: logs } = await runScene('fixtures/recursive.html')
    expect(error, logs.join('\n')).toBeNull()
    expect(result.text.replace(/\s+/g, '')).toBe('3210')
    expect(result.nodes).toBe(4)
    expect(result.cacheKeys).toEqual(
      expect.arrayContaining(['/fixtures/recursive.vue', 'vue']),
    )
  })

  it('leaves uncached bare specifiers to the browser import map', async () => {
    const { error, result, console: logs } = await runScene('fixtures/importmap.html')
    expect(error, logs.join('\n')).toBeNull()
    expect(result.text).toBe('42')
    expect(result.cacheKeys).toEqual([
      '/fixtures/importmap-app.vue',
      'vue',
    ])
  })
})
