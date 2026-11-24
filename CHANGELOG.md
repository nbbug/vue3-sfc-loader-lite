# Changelog

## 0.1.0

Initial release.

- Vue 3 SFC loader with the `vue3-sfc-loader` API and `moduleCache` semantics.
- Native ES module scripts; no TypeScript/JSX transpilation.
- Runtime support for plain-JavaScript `<script setup>` via `compileScript`;
  templates and render functions use module mode (no `new Function`).
- Plain CSS styles; no PostCSS/preprocessors. Scoped styles, `:deep()`,
  `:global()`, `:slotted()`, grouping at-rules and scoped keyframes are handled
  by a built-in scoped CSS transformer.
- Templates compiled with `@vue/compiler-sfc` `parse` + `compileScript` +
  `compileTemplate` in module mode.
- UMD, ESM and CJS bundles.
- Import-map support for bare specifiers that are not in `moduleCache`.
- Lazy dynamic `import()` rewriting, including computed specifiers and recursive
  `defineAsyncComponent(() => import('./Self.vue'))` components.
- `compiledCache` for compiled templates and scoped CSS.
- Node support through `data:` module URLs.
