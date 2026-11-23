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
| `<script setup>` | use admin-side `precompileSFC()`, or a normal `<script>` with `setup()` |
| `lang="ts"` / `lang="jsx"` | pre-compile to JavaScript |
| `<style lang="scss">` | pre-compile to CSS |
| `<template lang="pug">` | pre-compile to HTML |

Everything else (`delimiters`, `whitespace`, `isCustomElement`, `devMode`,
`pathResolve`, `getPathname`, `getResource`, `loadModule` hook) is supported.

## 3. Precompile `<script setup>` (recommended)

The runtime does not ship Babel, so `<script setup>` must be compiled once on
the admin/server side:

```js
import { precompileSFC, serializePrecompiled } from 'vue3-sfc-loader-lite/precompile'

const artifact = await precompileSFC(vueSource, { filename: 'Hello.vue' })
await db.save('hello', serializePrecompiled(artifact))
```

On the client, `loadModule()` auto-detects artifact JSON returned by `getFile`
for `.vue`/`.json` paths, or you can call
`loadPrecompiled(artifact, options, path)`. Nested precompiled components work
the same way; store each artifact and return it from `getFile`.

Supported by the precompiler: JS `<script setup>` (all standard macros), normal
`<script>`, HTML templates, scoped/plain CSS and custom blocks. TypeScript/JSX,
preprocessors, CSS Modules, `v-bind()` CSS and `src="..."` blocks are rejected.

Precompiled artifacts are pure ESM + CSS, so they do not need `'unsafe-eval'`
on the client. The raw-`.vue` fallback path does.

## 3. Make scripts standard ESM

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
* No `<script setup>` in raw runtime `.vue` sources. Precompile it on the admin
  side with `precompileSFC()` and load the resulting artifact on the client.
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

## 4. Make styles plain CSS

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

## 5. Template expectations

Templates are plain HTML. Asset URLs are kept literal; they are not transformed
into imports:

```html
<img src="./logo.png">
```

This means the browser requests `./logo.png` relative to the current page, not
relative to the `.vue` file. Use a URL that is valid from the page, or set the
asset path yourself.

## 6. CSP

Scripts are native ES modules loaded from `blob:` URLs (browsers) or `data:`
URLs (Node). Templates are compiled in function mode and evaluated with
`new Function`, so the page needs `'unsafe-eval'`. The original loader also used
`Function` for generated scripts, so that part is familiar; the lite loader
additionally requires `blob:` in `script-src` for the generated ES modules.

## 7. Error messages

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
- [ ] `<script setup>` is precompiled with `precompileSFC()` (or converted to `setup()`).
- [ ] No TypeScript/JSX.
- [ ] Every style block is plain CSS.
- [ ] Every template is HTML.
- [ ] No static circular imports.
- [ ] CSP allows `'unsafe-eval'` and blob/data module URLs.
- [ ] `moduleCache` contains `vue` and is shared between all calls.
- [ ] `addStyle` is provided if components have styles.
- [ ] Assets use URLs that are valid from the page.
