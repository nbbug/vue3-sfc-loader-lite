#!/usr/bin/env node
/**
 * Reports raw / gzip / brotli sizes of the distributed bundles and compares
 * them with the original vue3-sfc-loader bundle size (if declared).
 */
import { readFile, stat } from 'node:fs/promises'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

const files = [
  'dist/vue3-sfc-loader-lite.js',
  'dist/vue3-sfc-loader-lite.esm.js',
  'dist/vue3-sfc-loader-lite.cjs',
  'dist/precompile.esm.js',
  'dist/precompile.cjs',
]

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
const fmt = (bytes) => `${bytes} bytes (${kb(bytes)})`

console.log('vue3-sfc-loader-lite bundle size\n')

for (const file of files) {
  let raw
  try {
    raw = await readFile(file)
    await stat(file)
  } catch {
    console.warn(`missing ${file} (run npm run build first)`)
    continue
  }
  const gzip = gzipSync(raw, { level: 9 })
  const brotli = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  })
  console.log(`${file}`)
  console.log(`  raw    ${fmt(raw.length)}`)
  console.log(`  gzip   ${fmt(gzip.length)}`)
  console.log(`  brotli ${fmt(brotli.length)}`)
  console.log()
}
