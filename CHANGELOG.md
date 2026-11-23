# Changelog

## 0.1.0

Initial release.

- Vue 3 SFC loader with the `vue3-sfc-loader` API and `moduleCache` semantics.
- Native ES module scripts; no Babel/TypeScript/JSX transpilation.
- Plain CSS styles; no PostCSS/preprocessors. Scoped styles, `:deep()`,
  `:global()`, `:slotted()`, grouping at-rules and scoped keyframes are handled
  by a built-in scoped CSS transformer.
- Templates compiled with `@vue/compiler-sfc` `parse` + `compileTemplate` in
  function mode (no Babel expression parser).
- UMD, ESM and CJS bundles.
- Import-map support for bare specifiers that are not in `moduleCache`.
- Lazy dynamic `import()` rewriting, including computed specifiers and recursive
  `defineAsyncComponent(() => import('./Self.vue'))` components.
- Admin-side `precompileSFC()` entry (`vue3-sfc-loader-lite/precompile`) for
  `<script setup>` and normal SFCs; artifacts are JSON, executable by the small
  client runtime via `loadPrecompiled()` or automatic `loadModule()` detection.
  Babel stays in the admin dependency, never in the client bundle.
- `compiledCache` for compiled templates and scoped CSS.
- Node support through `data:` module URLs.
