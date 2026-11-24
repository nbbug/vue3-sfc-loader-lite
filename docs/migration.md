# Migration from vue3-sfc-loader

`vue3-sfc-loader-lite` intentionally keeps the original loader's public API and
`moduleCache` behavior. Most applications only need to change the script URL or
package import.

## 1. Replace the library

### UMD

```diff
-<script src="https://cdn.jsdelivr.net/npm/vue3-sfc-loader/dist/vue3-sfc-loader.js"></script>
+<script src="https://cdn.jsdelivr.net/npm/vue3-sfc-loader-lite/dist/vue3-sfc-loader-lite.js"></script>
```

The UMD bundle registers `window['vue3-sfc-loader-lite']`. It also aliases
`window['vue3-sfc-loader']` when that global is not already defined, so existing
code can keep using it during the transition.

### ESM / npm

```diff
-import { loadModule } from 'vue3-sfc-loader'
+import { loadModule } from 'vue3-sfc-loader-lite'
```

## 2. Keep your options

The standard options are unchanged:

```js
const options = {
  moduleCache: { vue: Vue },
  async getFile(url) { /* ... */ },
  addStyle(css) { /* ... */ },
  log(type, ...args) { /* ... */ },
  compiledCache: { get() {}, set() {} },
  customBlockHandler(block) {},
  handleModule(type, getContentData, path, options) {},
}
```

Remove options that only existed to configure Babel or PostCSS:

| removed option | replacement |
| --- | --- |
| `additionalBabelParserPlugins` | none – scripts must already be standard ESM |
| `additionalBabelPlugins` | none |
| `processStyles` | none – styles must already be plain CSS |
| `buildTemplateProcessor` | none – templates must already be plain HTML |
| `createCJSModule` | none – scripts are native ES modules |
| `<script setup>` | supported at runtime (plain JavaScript) |
| `lang="ts"` / `lang="jsx"` | pre-compile to JavaScript |
| `<style lang="scss">` | pre-compile to CSS |
| `<template lang="pug">` | pre-compile to HTML |

Everything else (`delimiters`, `whitespace`, `isCustomElement`, `devMode`,
`pathResolve`, `getPathname`, `getResource`, `loadModule` hook) is supported.

## 3. `<script setup>` works at runtime

Plain-JavaScript `<script setup>` is compiled on the client by
`compileScript`. TypeScript/JSX are not transpiled, so
`<script setup lang="ts">` is still rejected.

## 4. Make scripts standard ESM

Before (Babel/CJS-style, not supported):

```html
<script>
  const { ref } = require('vue')
  module.exports = { /* ... */ }
</script>
```

After:

```html
<script>
  import { ref } from 'vue'

  export default {
    setup() {
      return { count: ref(0) }
    },
  }
</script>
```

Rules:

* `import` / `export` only (no `require`, no `module.exports`).
* No TypeScript or JSX syntax.
* Static import cycles are not supported. Use
  `Vue.defineAsyncComponent(() => import('./Child.vue'))` for recursive
  components.

Static import specifiers are rewritten to runtime module URLs. Dynamic imports
are rewritten to a lazy loader helper, so `import('./Lazy.vue')`, computed
specifiers (``import(`./lazy/${name}.vue`)``) and recursive components
(`defineAsyncComponent(() => import('./Self.vue'))`) all work. Import
attributes/options on dynamic imports are ignored.

`import.meta.url` points at the generated `blob:`/`data:` URL, not at the
original `.vue` file. Use `getFile()` paths or absolute URLs for assets.

## 5. Make styles plain CSS

```html
<!-- not supported -->
<style lang="scss">
  $color: red;
  .a { color: $color; }
</style>

<!-- supported -->
<style>
  .a { color: red; }
</style>
```

Scoped CSS is supported:

```html
<style scoped>
  .a { color: red; }
  .a :deep(.child) { color: blue; }
  @keyframes fade { to { opacity: 0; } }
</style>
```

Not supported in styles:

* preprocessors (`scss`, `less`, `stylus`, ...)
* CSS Modules (`<style module>`)
* `v-bind()` in CSS
* full CSS validation (invalid CSS is injected as-is; use your browser's
  devtools instead of expecting PostCSS-style errors)

## 6. Template expectations

Templates are plain HTML. Asset URLs are kept literal; they are not transformed
into imports:

```html
<img src="./logo.png">
```

This means the browser requests `./logo.png` relative to the current page, not
relative to the `.vue` file. Use a URL that is valid from the page, or set the
asset path yourself.

## 7. CSP

Compiled modules are loaded from `blob:` URLs (browsers) or `data:` URLs (Node),
so `script-src` must include `blob:` (and `data:` under Node). The runtime does
not use `new Function` to evaluate templates; the tested normal path does not
require `'unsafe-eval'`.


## 8. Error messages

Error categories passed to `log` remain similar:

* `SFC template`
* `SFC script`
* `SFC style`
* `SFC module`
* `module script`
* `module resolution`
* `module json`

Template and script errors include a code frame when the compiler/lexer
provides a source location. SFC parse errors are logged and compilation
continues when possible (for example, to report a more precise template error).

## Compatibility checklist

- [ ] Every runtime `.vue` script is standard ESM.
- [ ] Plain-JavaScript `<script setup>` is acceptable (TypeScript/JSX are not).
- [ ] No TypeScript/JSX.
- [ ] Every style block is plain CSS.
- [ ] Every template is HTML.
- [ ] No static circular imports.
- [ ] CSP allows blob/data module URLs (`'unsafe-eval'` is not required for the normal path).
- [ ] `moduleCache` contains `vue` and is shared between all calls.
- [ ] `addStyle` is provided if components have styles.
- [ ] Assets use URLs that are valid from the page.
