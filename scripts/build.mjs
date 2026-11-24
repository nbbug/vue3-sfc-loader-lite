#!/usr/bin/env node
/**
 * Build script for vue3-sfc-loader-lite.
 *
 * The runtime now compiles `<script setup>` too, so it needs Vue's
 * `compileScript` and the expression parser it depends on. The browser ESM
 * bundle of `@vue/compiler-sfc` contains the browser-compatible compiler and
 * Babel parser; using it directly keeps the build simple and gives the
 * smallest full runtime (~227 kB gzip). Templates use module mode, so no
 * `new Function` is needed.
 *
 */
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rollup } from 'rollup'
import { nodeResolve } from '@rollup/plugin-node-resolve'
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

const plugins = [
  replace({
    preventAssignment: true,
    values: {
      __SFC_LITE_VERSION__: JSON.stringify(pkg.version),
      __VUE_VERSION__: JSON.stringify(sfcPkg.version),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  }),
  alias({
    entries: [
      {
        find: '@vue/compiler-sfc',
        replacement: nm('@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'),
      },
    ],
  }),
  esbuild({
    target: 'es2020',
    sourceMap: false,
    minify: false,
  }),
  nodeResolve({
    browser: true,
    preferBuiltins: false,
    extensions: ['.mjs', '.js', '.json'],
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
