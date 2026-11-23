# vue3-sfc-loader-lite

A lightweight Vue 3 Single File Component loader for the browser / Node.

It is a drop-in replacement for [`vue3-sfc-loader`](https://github.com/FranckFreiburger/vue3-sfc-loader)
for the common "no build step" use case, with a much smaller bundle:

| bundle            | original `vue3-sfc-loader` | `vue3-sfc-loader-lite` |
| ----------------- | -------------------------: | ---------------------: |
| minified          |                   ~1794 kB |                ~530 kB |
| minified + gzip   |                    ~488 kB |                ~175 kB |
| minified + brotli |                    ~385 kB |                ~146 kB |

The client bundle size improvement comes from removing the runtime
JavaScript/TypeScript transpiler (Babel) and the style preprocessor pipeline
(PostCSS), and from only supporting Vue 3. Babel is still used by the optional
admin-side precompiler, but never by the client runtime.

## What is different from `vue3-sfc-loader`?

- **Scripts are native ES modules.** The `<script>` block is expected to be
  standard, browser-ready ESM. It is used as-is; only import specifiers are
  rewritten so the browser can resolve them. There is no TypeScript/JSX
  transpilation, no `require()`, no `module.exports`.
- **Styles are plain CSS.** `<style>` blocks are injected verbatim. There is no
  Sass/Less/Stylus/PostCSS pipeline. `scoped` styles are supported by a small
  built-in CSS scoper.
- **Templates are plain HTML.** Custom template languages (`pug`, ...) are not
  supported.
- **Vue 3 only.** The loader uses `parse` and `compileTemplate` from
  `@vue/compiler-sfc`.
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

## Admin-side precompile (recommended for `<script setup>`)

The runtime deliberately does not ship Babel, so it cannot compile
`<script setup>` on the client. Compile it once on the admin/server side and
store the resulting JSON artifact in your database:

```js
// admin / Node service
import {
  precompileSFC,
  serializePrecompiled,
} from 'vue3-sfc-loader-lite/precompile'

const artifact = await precompileSFC(vueSource, {
  filename: 'components/Hello.vue', // stable id, drives the scoped-style id
})

await db.save('components/hello', serializePrecompiled(artifact))
```

On the client, either point `getFile` at the artifact JSON or pass it directly:

```js
import { loadModule, loadPrecompiled } from 'vue3-sfc-loader-lite'

// A) loadModule auto-detects an artifact returned for a .vue or .json path
const options = {
  moduleCache: { vue: Vue },
  async getFile(url) {
    // returns the JSON string stored by the admin
    return await fetch('/api/component' + url).then((res) => res.text())
  },
  addStyle(css) {
    const style = Object.assign(document.createElement('style'), { textContent: css })
    document.head.appendChild(style)
  },
}

const componentA = await loadModule('/components/Hello.vue', options)

// B) or pass the parsed artifact explicitly
const artifact = await fetch('/api/components/hello').then((res) => res.json())
const componentB = await loadPrecompiled(artifact, options, '/components/Hello.vue')
```

Nested components work the same way: precompile each SFC, store each artifact,
and return the matching artifact JSON from `getFile`. Relative imports are
resolved by the normal module loader.

`precompileSFC(source, options)` supports:

* `<script setup>` in plain JavaScript, including `defineProps`,
  `defineEmits`, `defineExpose`, `defineOptions`, `defineSlots`, `defineModel`,
  `withDefaults`, top-level `await`, and normal `import` statements
* a normal `<script>` / Options API component
* templates, slots, directives, `v-model`, ...
* scoped and ordinary CSS (scoped CSS is compiled on the admin side)
* custom blocks (stored in the artifact and passed to `customBlockHandler` on
  the client)

It rejects TypeScript/JSX, style/template preprocessors, CSS Modules,
`v-bind()` in CSS, and `src="..."` blocks; inline those blocks first.

### Artifact format

`precompileSFC()` returns a JSON-serializable `PrecompiledSFC`:

```ts
type PrecompiledSFC = {
  __vsf_lite_precompiled__: 1
  version: 1
  filename: string
  scopeId: string
  hasScoped: boolean
  script: string | null   // compiled ES module source
  render: string | null   // compiled render ES module source
  styles: string[]        // final CSS (scoped CSS already transformed)
  customBlocks: CustomBlock[]
  compilerVersion?: string
}
```

The client validates the marker/version, rewrites imports in `script`/`render`,
composes the component, injects `styles`, and runs custom-block callbacks. No
SFC parser, Babel or PostCSS is involved on the client for precompiled
artifacts. If you use only precompiled components, the client does not need
`'unsafe-eval'` for them (the raw-SFC fallback still uses function-mode
templates and does).

The precompile entry is separate (`vue3-sfc-loader-lite/precompile`,
~3.5 kB gzip) and keeps `@vue/compiler-sfc` as an external Node dependency, so
Babel is never bundled into the client runtime.

## API

### `loadModule(path, options): Promise<ModuleExport>`

Loads and compiles the entry module. For a `.vue` file the resolved value is the
component object (the SFC's default export), exactly like `vue3-sfc-loader`.

Use `Vue.defineAsyncComponent()` or `await` at your application boundary.

### `loadPrecompiled(artifact, options, path?)`

Executes a JSON artifact produced by `precompileSFC()` without parsing or
compiling the original SFC. `artifact` may be the object or its JSON string;
`path` is the logical path used for relative imports and the module-cache id
(defaults to `artifact.filename`).

`loadModule()` already auto-detects artifacts returned by `getFile` for `.vue`
and `.json` paths. `loadPrecompiled()` is useful when the artifact is delivered
as JSON directly (for example, from a database API) rather than through
`getFile`.

### Exports

```ts
export {
  loadModule,
  loadPrecompiled,
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
- `<script>` with standard ESM (default export optional)
- `<style>` / `<style scoped>` pure CSS, multiple blocks
- `src` attributes on `<script>`, `<template>` and `<style>`
- external `.js` / `.mjs` modules, lazy `import()` (including computed
  specifiers and recursive components), `.json` modules
- custom blocks
- `:deep()`, `::v-deep`, `>>>`, `/deep/`, `:global()`, `:slotted()`,
  `@media` / `@supports` / `@layer` / `@container`, scoped `@keyframes`
  renaming and `animation` rewriting

Not supported:

- `<script setup>` in a raw runtime `.vue` source (it is not plain ESM). Use
  admin-side `precompileSFC()`; the client executes the resulting artifact.
- TypeScript / JSX in scripts or templates
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

Raw `.vue` sources are compiled by Vue's template compiler in **function mode**
(`compileTemplate` with a function-mode compiler), so the generated render
function resolves bindings through `with (_ctx)`. The render function is
evaluated with `new Function`. This is what makes complex template expressions
work without Babel, but it means the page's Content-Security-Policy must allow
`'unsafe-eval'`. Browsers also need to allow `blob:` module scripts for normal
module execution.

The original `vue3-sfc-loader` also executes generated code with `Function`, so
`'unsafe-eval'` is usually already allowed. The lite loader additionally loads
compiled modules from `blob:` URLs, so `script-src` must include `blob:`
(`data:` under Node).

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
npm run build       # dist/ (runtime + precompile) + type declarations
npm run test:unit   # unit tests (Node)
npm run test        # build + unit + Playwright browser tests
npm run size        # raw / gzip / brotli bundle sizes
```

The browser tests use Playwright's Chromium. If `npx playwright install
chromium` has not been run, the tests look for an existing Chromium in the
Playwright browser cache.

### How the bundle is built

`@vue/compiler-sfc`'s browser ESM bundle eagerly initializes Babel, PostCSS, a
Buffer polyfill and source-map support. The build instead starts from the
CommonJS build, points the compiler packages at their CommonJS builds, stubs
the dependencies the lite loader never calls and strips the inlined
`consolidate` template-engine table. `parse()` and `compileTemplate()` remain
the real Vue implementations; everything else is dead-code eliminated.

The build patches compiler-core's `isMemberExpression` / `isFnExpression`
classifiers to their browser implementations so template compilation does not
need `@babel/parser`.

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
   - for `<script setup>`, either use admin-side `precompileSFC()` (recommended)
     or convert it to a normal `<script>` with `setup()`.
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
