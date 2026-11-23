#!/usr/bin/env node
/**
 * Build script for vue3-sfc-loader-lite.
 *
 * Why the CommonJS compiler-sfc build?
 * ------------------------------------
 * `@vue/compiler-sfc`'s browser ESM entry is a single pre-bundled file that
 * initializes Babel, PostCSS, a Buffer polyfill and source-map support at load
 * time. Its CommonJS build keeps those dependencies behind separate `require`
 * calls, which lets this build:
 *
 *   1. point compiler-core/compiler-dom/shared at their CommonJS builds,
 *   2. replace the unused Babel/PostCSS/SSR/source-map dependencies with tiny
 *      stubs,
 *   3. strip the inlined `consolidate` template-engine table, and
 *   4. patch compiler-core's expression classifiers to the browser versions
 *      (templates are compiled in function mode, so no Babel expression parser
 *      is needed).
 *
 * `parse()` and `compileTemplate()` remain the real implementations. Everything
 * the lite loader does not call (compileScript, compileStyle, preprocessors,
 * SSR) is dead code after tree-shaking.
 */
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rollup } from 'rollup'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import alias from '@rollup/plugin-alias'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import esbuild from 'rollup-plugin-esbuild'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'))
const sfcPkg = JSON.parse(
  await readFile(
    path.join(rootDir, 'node_modules/@vue/compiler-sfc/package.json'),
    'utf8',
  ),
)

const nm = (...parts) => path.join(rootDir, 'node_modules', ...parts)

// Remove stale artifacts (including outputs from older filenames).
await rm(path.join(rootDir, 'dist'), { recursive: true, force: true })

const banner = `/*! ${pkg.name} v${pkg.version} | MIT | ${pkg.description} */`

const globalAliasFooter = `
try {
  var __liteGlobal = typeof globalThis !== 'undefined' ? globalThis
    : typeof self !== 'undefined' ? self
    : typeof window !== 'undefined' ? window
    : this;
  __liteGlobal['vue3-sfc-loader-lite'] = Vue3SfcLoaderLite;
  // Drop-in alias for code that used the original vue3-sfc-loader global.
  __liteGlobal['vue3-sfc-loader'] = __liteGlobal['vue3-sfc-loader'] || Vue3SfcLoaderLite;
} catch (__liteAliasError) {
  // ignore (e.g. frozen global object)
}
`

// ---------------------------------------------------------------------------
// Stubs for compiler-sfc dependencies that the lite loader never calls.
// ---------------------------------------------------------------------------
const STUB_PREFIX = '\0vue3-sfc-loader-lite-stub:'

const stubs = {
  '@babel/parser': `
    function unavailable() {
      throw new Error('[vue3-sfc-loader-lite] @babel/parser is not part of the lite build');
    }
    export const parse = unavailable;
    export const parseExpression = unavailable;
    export const tokTypes = {};
    export default { parse, parseExpression, tokTypes };
  `,
  postcss: `
    function unavailable() {
      throw new Error('[vue3-sfc-loader-lite] PostCSS is not part of the lite build');
    }
    unavailable.plugin = function () { return function () {}; };
    unavailable.parse = unavailable;
    export const plugin = unavailable.plugin;
    export const parse = unavailable;
    export default unavailable;
  `,
  '@vue/compiler-ssr': `
    export function compile() {
      throw new Error('[vue3-sfc-loader-lite] SSR compilation is not supported by the lite build');
    }
    export default { compile };
  `,
  'estree-walker': `
    export function walk() {}
    export default { walk };
  `,
  'magic-string': `
    export default class MagicString {
      constructor(source) { this.source = source; }
      toString() { return this.source; }
    }
  `,
  'source-map-js': `
    export class SourceMapGenerator {}
    export class SourceMapConsumer {}
    export default { SourceMapGenerator, SourceMapConsumer };
  `,
  path: `
    const normalize = (value) => value;
    const posix = {
      normalize,
      extname: (value) => {
        const base = value.slice(value.lastIndexOf('/') + 1);
        const dot = base.lastIndexOf('.');
        return dot <= 0 ? '' : base.slice(dot);
      },
      dirname: (value) => {
        const slash = value.lastIndexOf('/');
        if (slash === -1) return '.';
        return slash === 0 ? '/' : value.slice(0, slash);
      },
      join: (...parts) => parts.filter(Boolean).join('/'),
      resolve: (...parts) => parts.filter(Boolean).join('/'),
      basename: (value) => value.slice(value.lastIndexOf('/') + 1),
      sep: '/',
    };
    export const extname = posix.extname;
    export const dirname = posix.dirname;
    export const join = posix.join;
    export const resolve = posix.resolve;
    export const basename = posix.basename;
    export const sep = '/';
    export { posix };
    export default posix;
  `,
  url: `
    export function parse(input) {
      try { return new URL(input); } catch { return {}; }
    }
    export function pathToFileURL(value) {
      return { href: 'file://' + value, pathname: value };
    }
    export function fileURLToPath(value) {
      return String(value).replace(/^file:\\/\\//, '');
    }
    export default { parse, pathToFileURL, fileURLToPath };
  `,
  fs: `
    function unavailable() {
      throw new Error('[vue3-sfc-loader-lite] fs is not available in the browser build');
    }
    export const readFileSync = unavailable;
    export const readFile = unavailable;
    export const existsSync = () => false;
    export const promises = {};
    export default { readFileSync, readFile, existsSync, promises };
  `,
  util: `
    export const inspect = (value) => String(value);
    export const format = (...args) => args.join(' ');
    export const deprecate = (fn) => fn;
    export const inherits = () => {};
    export const promisify = (fn) => fn;
    export const types = {};
    export default { inspect, format, deprecate, inherits, promisify, types };
  `,
  process: `
    const process = {
      env: { NODE_ENV: 'production' },
      platform: 'browser',
      browser: true,
      cwd: () => '/',
      versions: {},
      nextTick: (fn) => Promise.resolve().then(fn),
    };
    export const env = process.env;
    export const platform = process.platform;
    export const browser = true;
    export const cwd = process.cwd;
    export const versions = process.versions;
    export const nextTick = process.nextTick;
    export default process;
  `,
}

const virtualStubPlugin = {
  name: 'vue3-sfc-loader-lite:stubs',
  resolveId(source, importer) {
    if (Object.prototype.hasOwnProperty.call(stubs, source)) {
      return STUB_PREFIX + source
    }
    // Dynamically required template engines inside compiler-sfc's inlined
    // consolidate table. They are never reached by the lite loader and the
    // table is stripped below, but keep this as a safety net for new versions.
    if (importer && /compiler-sfc\.cjs\.js$/.test(importer)) {
      if (
        source.startsWith('.') ||
        source.startsWith('/') ||
        source.startsWith('\0')
      ) {
        return null
      }
      return STUB_PREFIX + source
    }
    return null
  },
  load(id) {
    if (!id.startsWith(STUB_PREFIX)) return null
    const name = id.slice(STUB_PREFIX.length)
    return stubs[name] ?? 'export default {};'
  },
}

/**
 * compiler-sfc's CommonJS build inlines consolidate.js (including dozens of
 * `require('pug')`-style engine references). Remove that whole function; the
 * lite loader only accepts plain HTML templates.
 */
const stripConsolidatePlugin = {
  name: 'vue3-sfc-loader-lite:strip-consolidate',
  transform(code, id) {
    if (!/compiler-sfc\.cjs\.js$/.test(id)) return null
    const marker = 'function requireConsolidate$1 () {'
    if (!code.includes(marker)) {
      this.warn('consolidate function not found; template engine stubs will be used')
      return null
    }
    const transformed = code.replace(
      /function requireConsolidate\$1 \(\) \{[\s\S]*?\n\}\n\nvar consolidate\$1;/,
      'function requireConsolidate$1 () { return {}; }\n\nvar consolidate$1;',
    )
    if (transformed === code) {
      this.warn('consolidate function could not be stripped')
      return null
    }
    // The removed block is unused compiler-internal code; an empty map avoids
    // Rollup's "sourcemap is likely incorrect" warning without pretending to
    // map the removed region.
    return { code: transformed, map: { mappings: '' } }
  },
}

/**
 * compiler-core's CommonJS build selects `isMemberExpressionNode` /
 * `isFnExpressionNode`, which call `@babel/parser`. The browser build selects
 * the dependency-free browser implementations. We compile templates in
 * function mode (no identifier prefixing), so the browser classifiers are
 * both correct and Babel-free.
 */
const browserExpressionClassifiersPlugin = {
  name: 'vue3-sfc-loader-lite:browser-expression-classifiers',
  transform(code, id) {
    if (!/compiler-core\.cjs\.js$/.test(id)) return null
    const transformed = code
      .replace(
        'const isMemberExpression = isMemberExpressionNode;',
        'const isMemberExpression = isMemberExpressionBrowser;',
      )
      .replace(
        'const isFnExpression = isFnExpressionNode;',
        'const isFnExpression = isFnExpressionBrowser;',
      )
    if (transformed === code || !transformed.includes('isMemberExpressionBrowser;')) {
      this.error(
        'compiler-core expression classifier patch did not apply. ' +
        'Update browserExpressionClassifiersPlugin for this @vue/compiler-core version.',
      )
    }
    return { code: transformed, map: { mappings: '' } }
  },
}

const plugins = [
  replace({
    preventAssignment: true,
    values: {
      __SFC_LITE_VERSION__: JSON.stringify(pkg.version),
      __VUE_VERSION__: JSON.stringify(sfcPkg.version),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  }),
  stripConsolidatePlugin,
  browserExpressionClassifiersPlugin,
  alias({
    entries: [
      {
        find: '@vue/compiler-sfc',
        replacement: nm('@vue/compiler-sfc/dist/compiler-sfc.cjs.js'),
      },
      {
        find: '@vue/compiler-core',
        replacement: nm('@vue/compiler-core/dist/compiler-core.cjs.js'),
      },
      {
        find: '@vue/compiler-dom',
        replacement: nm('@vue/compiler-dom/dist/compiler-dom.cjs.js'),
      },
      {
        find: '@vue/shared',
        replacement: nm('@vue/shared/dist/shared.cjs.js'),
      },
    ],
  }),
  virtualStubPlugin,
  esbuild({
    target: 'es2020',
    sourceMap: false,
    minify: false,
  }),
  nodeResolve({
    browser: false,
    preferBuiltins: false,
    mainFields: ['main'],
    extensions: ['.mjs', '.js', '.json'],
  }),
  commonjs({
    include: /node_modules/,
    transformMixedEsModules: true,
    ignoreDynamicRequires: false,
  }),
  terser({
    compress: { passes: 2, drop_debugger: true },
    mangle: true,
    format: { comments: /^!/ },
  }),
]

const onwarn = (warning, warn) => {
  if (
    warning.code === 'CIRCULAR_DEPENDENCY' ||
    warning.code === 'THIS_IS_UNDEFINED' ||
    warning.code === 'EVAL' ||
    warning.code === 'COMMONJS_VARIABLE_IN_ESM' ||
    warning.code === 'UNRESOLVED_IMPORT'
  ) {
    return
  }
  warn(warning)
}

const bundle = await rollup({
  input: path.join(rootDir, 'src/index.ts'),
  plugins,
  treeshake: { moduleSideEffects: false },
  onwarn,
})

const outputs = [
  {
    file: path.join(rootDir, 'dist/vue3-sfc-loader-lite.esm.js'),
    format: 'es',
    banner,
    sourcemap: true,
  },
  {
    file: path.join(rootDir, 'dist/vue3-sfc-loader-lite.cjs'),
    format: 'cjs',
    exports: 'named',
    banner,
    sourcemap: true,
  },
  {
    file: path.join(rootDir, 'dist/vue3-sfc-loader-lite.js'),
    format: 'iife',
    name: 'Vue3SfcLoaderLite',
    banner,
    footer: globalAliasFooter,
    sourcemap: true,
  },
]

for (const output of outputs) {
  await bundle.write(output)
}

await bundle.close()

console.log(`Built ${pkg.name} v${pkg.version} (Vue compiler ${sfcPkg.version})`)
