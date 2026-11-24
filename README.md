# vue3-sfc-loader-lite

A lightweight Vue 3 Single File Component loader for the browser / Node.

It is a drop-in replacement for [`vue3-sfc-loader`](https://github.com/FranckFreiburger/vue3-sfc-loader)
for the common "no build step" use case, with a much smaller full runtime
(these figures include runtime `<script setup>` support):

| bundle            | original `vue3-sfc-loader` | `vue3-sfc-loader-lite` |
| ----------------- | -------------------------: | ---------------------: |
| minified          |                   ~1794 kB |                ~732 kB |
| minified + gzip   |                    ~488 kB |                ~227 kB |
| minified + brotli |                    ~385 kB |                ~190 kB |

The runtime now embeds Vue's compiler (including its Babel expression parser) so it can support `<script setup>` out of the box. It still avoids the original loader's Babel *transformation* pipeline (no TypeScript/JSX transpilation) and PostCSS runtime pipeline, and only supports Vue 3.

## What is different from `vue3-sfc-loader`?

- **Scripts are native ES modules.** Normal `<script>` blocks are used as-is;
  only import specifiers are rewritten. `<script setup>` (plain JavaScript) is
  compiled at runtime with Vue's `compileScript`. There is no TypeScript/JSX
  transpilation, no `require()`, no `module.exports`.
- **Styles are plain CSS.** `<style>` blocks are injected verbatim. There is no
  Sass/Less/Stylus/PostCSS pipeline. `scoped` styles are supported by a small
  built-in CSS scoper.
- **Templates are plain HTML.** Custom template languages (`pug`, ...) are not
  supported.
- **Vue 3 only.** The loader uses `parse`, `compileScript` and
  `compileTemplate` from `@vue/compiler-sfc`.
- **The public API and `moduleCache` are the same.** Existing options such as
  `moduleCache`, `getFile`, `addStyle`, `log`, `compiledCache`,
  `customBlockHandler`, `handleModule`, `loadModule` (hook), `pathResolve`,
  `getPathname` and `getResource` keep working.

## Install

```sh
npm install vue3-sfc-loader-lite
```

### UMD / `<script>` tag

```html
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vue3-sfc-loader-lite/dist/vue3-sfc-loader-lite.js"></script>
```

The UMD build exposes `window['vue3-sfc-loader-lite']` and, for drop-in
migration, also `window['vue3-sfc-loader']` (only when that global is not
already defined).

### ESM

```html
<script type="module">
  import * as Vue from 'https://unpkg.com/vue@3/dist/vue.runtime.esm-browser.prod.js';
  import { loadModule } from 'https://cdn.jsdelivr.net/npm/vue3-sfc-loader-lite/dist/vue3-sfc-loader-lite.esm.js';

  const options = {
    moduleCache: { vue: Vue },
    getFile: () => `<template>Hello from an SFC</template>`,
    addStyle: () => {},
  };

  Vue.createApp(
    Vue.defineAsyncComponent(() => loadModule('file.vue', options)),
  ).mount(document.body);
</script>
```

### Node

```js
const { loadModule } = require('vue3-sfc-loader-lite');
// or: import { loadModule } from 'vue3-sfc-loader-lite'

const component = await loadModule('/app.vue', {
  moduleCache: { vue: require('vue') },
  getFile: async (url) => readFile(url, 'utf8'),
  addStyle: (css) => {
    /* collect or ignore */
  },
});
```

Node execution uses `data:` module URLs; browsers use `blob:` URLs.

The distributed bundles embed `@vue/compiler-sfc` 3.5.46. Use a compatible Vue
3.5.x runtime; `vueVersion` reports the embedded compiler version.

## Basic usage

```html
<div id="app"></div>

<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
<script src="./dist/vue3-sfc-loader-lite.js"></script>
<script>
  const options = {
    moduleCache: {
      vue: Vue,
    },

    async getFile(url) {
      const res = await fetch(url);
      if (!res.ok) {
        throw Object.assign(new Error(res.statusText + ' ' + url), { res });
      }
      return {
        getContentData: (asBinary) =>
          asBinary ? res.arrayBuffer() : res.text(),
      };
    },

    addStyle(textContent) {
      const style = Object.assign(document.createElement('style'), {
        textContent,
      });
      const ref = document.head.getElementsByTagName('style')[0] || null;
      document.head.insertBefore(style, ref);
    },

    log(type, ...args) {
      console[type](...args);
    },
  };

  const { loadModule } = window['vue3-sfc-loader-lite'];

  const app = Vue.createApp({
    components: {
      'my-component': Vue.defineAsyncComponent(() =>
        loadModule('./myComponent.vue', options),
      ),
    },
    template: '<my-component></my-component>',
  });

  app.mount('#app');
</script>
```

## API

### `loadModule(path, options): Promise<ModuleExport>`

Loads and compiles the entry module. For a `.vue` file the resolved value is the
component object (the SFC's default export), exactly like `vue3-sfc-loader`.

Use `Vue.defineAsyncComponent()` or `await` at your application boundary.

### Exports

```ts
export {
  loadModule,
  version,
  vueVersion,
  compilerVersion,
  buildTemplateProcessor,
};
export * from './types'; // Options, File, Resource, Cache, ...
```

- `version` – the lite loader version.
- `vueVersion` – the version of `@vue/compiler-sfc` embedded in the bundle.
- `compilerVersion` – alias of `vueVersion`.

### Options

| option                                              | required          | description                                                                                                                                  |
| --------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `moduleCache`                                       | yes               | Shared module registry. Must contain `vue`. All loaded modules are stored here.                                                              |
| `getFile(path)`                                     | yes\*             | Returns the file content (string / `ArrayBuffer`) or a `{ type, getContentData }` object. _Not required when `getResource` is fully custom._ |
| `addStyle(css, scopeId)`                            | when styles exist | Injects a style block.                                                                                                                       |
| `log(type, ...args)`                                | no                | Receives `error` / `warn` / `info` messages, with categories such as `SFC template`, `SFC script`, `SFC style`, `SFC module`.                |
| `compiledCache`                                     | no                | `{ get(key), set(key, value) }` cache for compiled templates and scoped CSS.                                                                 |
| `customBlockHandler(block, filename, options)`      | no                | Returns a callback invoked with the component after it is created.                                                                           |
| `handleModule(type, getContentData, path, options)` | no                | Handles extra file types (e.g. `.txt`, `.svg`). Return `undefined` to continue with built-in handling.                                       |
| `loadModule(path, options)`                         | no                | Hook for virtual modules. Return `undefined` to continue.                                                                                    |
| `pathResolve(pathContext, options)`                 | no                | Custom relative-to-absolute path resolution.                                                                                                 |
| `getPathname(path)`                                 | no                | Strips query strings for extension detection (default removes `?query`).                                                                     |
| `getResource(pathContext, options)`                 | no                | Fully custom `{ id, path, getContent }` provider.                                                                                            |
| `delimiters`                                        | no                | Template interpolation delimiters.                                                                                                           |
| `whitespace`                                        | no                | `'preserve'` or `'condense'` (Vue compiler default).                                                                                         |
| `isCustomElement`                                   | no                | Native custom element predicate.                                                                                                             |
| `devMode`                                           | no                | Keeps Vue's development warnings in the template compiler.                                                                                   |

The original Babel/PostCSS-specific options (`additionalBabelParserPlugins`,
`additionalBabelPlugins`, `processStyles`) are not part of the lite API.
`buildTemplateProcessor` is exported as a stub that throws a clear error,
because custom template languages are not supported.

### `moduleCache`

`moduleCache` is both the dependency map and the result cache:

```js
const options = {
  moduleCache: Object.assign(Object.create(null), {
    vue: Vue,
    'my-utils': { format: (v) => String(v) },
  }),
  // ...
};
```

- Keys are resolved module ids (`vue`, `./Child.vue`, `/components/Child.vue`, ...).
- Values can be components, ES module namespaces (`import * as Vue from 'vue'`), CJS-style
  `{ __esModule: true, default, ... }` objects or plain objects. Pre-populated
  values should be resolved values, not Promises.
- Plain objects are exposed to native ESM imports through generated shim
  modules that re-export their enumerable properties. This is how
  `import { ref } from 'vue'` keeps working without a CommonJS transform.
- The loader sets the cache prototype to `null` when possible (same as the
  original loader).
- The same cache must be shared by all `loadModule` calls in your application.
  Replacing the cache resets loader state (and is also how you "unload"
  modules).

### `.vue` support

Supported:

- `<template>` with HTML (including Vue directives, slots, `v-model`, ...)
- `<script>` with standard ESM (default export optional), and plain-JavaScript
  `<script setup>` with its standard macros
- `<style>` / `<style scoped>` pure CSS, multiple blocks
- `src` attributes on `<script>`, `<template>` and `<style>`
- external `.js` / `.mjs` modules, lazy `import()` (including computed
  specifiers and recursive components), `.json` modules
- custom blocks
- `:deep()`, `::v-deep`, `>>>`, `/deep/`, `:global()`, `:slotted()`,
  `@media` / `@supports` / `@layer` / `@container`, scoped `@keyframes`
  renaming and `animation` rewriting

Not supported:

- `<script setup lang="ts">` / TypeScript / JSX in scripts or templates
  (plain JavaScript `<script setup>` is supported)
- `<style lang="scss|less|...">`, CSS Modules, `v-bind()` in CSS
- `<template lang="pug|...">`
- static circular imports (a clear error is thrown; use
  `defineAsyncComponent` for recursive components)
- `import.meta.url` pointing at the original file (modules run from
  `blob:` / `data:` URLs)
- import attributes/options on dynamic imports are ignored (the module is
  loaded normally)
- asset URL transforms inside templates (`<img src="./x.png">` keeps its
  literal URL)

### Template compilation and CSP

Templates are compiled by Vue's template compiler in **module mode**. The
compiled script and render code stay native ES modules; the loader does not
evaluate templates with `new Function`. Browsers need to allow `blob:` module
scripts for normal module execution. The tested runtime path does not require
`'unsafe-eval'`.

Compiled modules are loaded from `blob:` URLs, so `script-src` must include
`blob:` (`data:` under Node).

Scripts themselves are **not** evaluated with `Function`: they are real ES
modules loaded from `blob:`/`data:` URLs.

### `compiledCache`

Compiling templates is the expensive part. Provide a cache to persist compiled
template code (and scoped CSS) across reloads:

```js
compiledCache: {
  get(key) {
    return localStorage.getItem('sfc:' + key) ?? undefined
  },
  set(key, value) {
    localStorage.setItem('sfc:' + key, value)
  },
}
```

Cache failures are logged as warnings and never break module loading.

### Import maps

If a bare specifier is not present in `moduleCache`, it is left untouched so the
browser's [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap)
can resolve it:

```html
<script type="importmap">
  { "imports": { "tiny-lib": "/vendor/tiny-lib.js" } }
</script>
```

Bare specifiers that _are_ in `moduleCache` are always resolved from the cache.
If you provide an `options.loadModule` hook, it gets a chance to handle bare
specifiers first (matching the original loader).

## Examples

See [`examples/`](./examples):

- [`examples/umd.html`](./examples/umd.html) – Vue global + UMD loader
- [`examples/esm.html`](./examples/esm.html) – Vue ESM + loader ESM

Serve the repository root with any static server, e.g.:

```sh
npx serve .
# open http://localhost:3000/examples/umd.html
```

The `examples/` pages load `../dist/...`, so run `npm run build` first.

## Browser support

The distributed bundles target modern browsers with ES modules, dynamic import,
`Blob`, `URL.createObjectURL` and `Symbol`. Vue 3 itself has similar
requirements. A `no-module` fallback is not provided.

## Development

```sh
npm install
npm run build       # dist/ + type declarations
npm run test:unit   # unit tests (Node)
npm run test        # build + unit + Playwright browser tests
npm run size        # raw / gzip / brotli bundle sizes
```

The browser tests use Playwright's Chromium. If `npx playwright install
chromium` has not been run, the tests look for an existing Chromium in the
Playwright browser cache.

### How the bundle is built

The runtime uses `@vue/compiler-sfc`'s browser ESM bundle directly. It contains
Vue's parser, `compileScript`, `compileTemplate` and the Babel expression parser
needed for module-mode template compilation. The build still tree-shakes what
is not reached and embeds the result in one file, so no additional chunks or
runtime dependencies are required.

## Migration from `vue3-sfc-loader`

1. Replace the script URL / package import:
   - `vue3-sfc-loader` → `vue3-sfc-loader-lite`
   - `window['vue3-sfc-loader']` also works (UMD alias), but prefer
     `window['vue3-sfc-loader-lite']`.
2. Keep your `options` object. Remove Babel/PostCSS/preprocessor options if
   present.
3. Make sure every `<script>` is a standard ES module:
   - `export default { ... }`
   - `import ... from './x.js'`
   - no `require`, no `module.exports`, no TypeScript/JSX
   - `<script setup>` in plain JavaScript is supported as-is.
4. Make sure every `<style>` is plain CSS. Move Sass/Less variables and mixins
   into plain CSS or pre-compile.
5. Replace `pug`/custom template languages with HTML.
6. If you relied on asset URL transforms (`<img src="./logo.png">` becoming an
   import), keep the literal URL and serve the asset from that path.
7. If you use circular static imports between SFCs, switch to asynchronous
   components.

See [`docs/migration.md`](./docs/migration.md) for a longer checklist.

## License

MIT
