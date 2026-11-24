# vue3-sfc-loader-lite（中文说明）

一个只面向 **Vue 3** 的轻量级单文件组件（SFC）运行时加载器，是
[`vue3-sfc-loader`](https://github.com/FranckFreiburger/vue3-sfc-loader) 的精简替代品。

它保留了原项目的 `loadModule(path, options)` API 和 `moduleCache` 机制，运行时内置 JS 版 `<script setup>` 支持，去掉了 TypeScript/JSX 转译和样式预处理链路：

- 普通 `<script>` 必须是浏览器可直接运行的 **标准 ES Module**；JS 版
  `<script setup>` 在运行时由 Vue 的 `compileScript` 编译，不转译 TS/JSX。
- `<style>` 必须是 **纯 CSS**，不再经过 PostCSS，也不支持 Sass/Less/Stylus。
- 只支持 Vue 3，直接使用 `@vue/compiler-sfc` 的 `parse`、`compileScript` 和 `compileTemplate`。
- 体积：压缩后约 **227 kB gzip / 732 kB min**（原版约 488 kB gzip / 1794 kB min）。

构建产物内置 `@vue/compiler-sfc` 3.5.46，请使用兼容的 Vue 3.5.x 运行时；
`vueVersion` 会返回内置编译器版本。

完整英文文档见 [README.md](./README.md)，迁移清单见
[docs/migration.md](./docs/migration.md)。

## 安装与 CDN

```sh
npm install vue3-sfc-loader-lite
```

```html
<!-- UMD：全局变量 window['vue3-sfc-loader-lite'] -->
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
<script src="https://cdn.jsdelivr.net/npm/vue3-sfc-loader-lite/dist/vue3-sfc-loader-lite.js"></script>
```

```js
// ESM / npm
import { loadModule } from 'vue3-sfc-loader-lite';
```

UMD 版本同时把 `window['vue3-sfc-loader']` 指向本库（如果该全局变量尚未定义），
方便直接从原版切换。

## 快速使用

```html
<div id="app"></div>
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
<script src="./dist/vue3-sfc-loader-lite.js"></script>
<script>
  const options = {
    moduleCache: { vue: Vue },

    async getFile(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText + ' ' + url);
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
  };

  const { loadModule } = window['vue3-sfc-loader-lite'];

  Vue.createApp({
    components: {
      'my-component': Vue.defineAsyncComponent(() =>
        loadModule('./myComponent.vue', options),
      ),
    },
    template: '<my-component></my-component>',
  }).mount('#app');
</script>
```

`loadModule()` 对 `.vue` 文件返回组件对象（即 SFC 的 default export），
所以通常配合 `Vue.defineAsyncComponent()` 使用。

## 与原版的主要差异

| 能力                                                            | 原版 `vue3-sfc-loader`         | 本库                                                   |
| --------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ |
| `<script>`                                                      | 可由 Babel 转译 TS/JSX/ESM/CJS | 标准 ESM；JS `<script setup>` 运行时编译               |
| `<script setup>`                                                | 支持                           | 支持（仅 JS；运行时编译）                             |
| `<style lang="scss">`                                           | 支持（PostCSS）                | 不支持，必须是纯 CSS                                   |
| `<style scoped>`                                                | 支持                           | 支持（内置轻量 CSS scoper）                            |
| `<template lang="pug">`                                         | 支持                           | 不支持，必须是 HTML                                    |
| Vue 2                                                           | 支持                           | 不支持                                                 |
| `moduleCache`                                                   | 支持                           | 支持，语义一致                                         |
| `compiledCache` / 自定义块 / `handleModule` / `loadModule` hook | 支持                           | 支持                                                   |
| 裸模块名（如 `vue`）                                            | 从 `moduleCache` 取            | 优先从 `moduleCache` 取；未命中时交给浏览器 import map |

### 脚本要求

```html
<!-- 支持 -->
<script>
  import { ref } from 'vue';

  export default {
    setup() {
      return { count: ref(0) };
    },
  };
</script>
```

不支持：

- `require()`、`module.exports`
- TypeScript、JSX、`<script setup lang="ts">`
- 静态循环依赖（会抛出明确错误；递归组件请用 `defineAsyncComponent` 配合动态 `import()`，本库会延迟解析动态导入）

### 样式要求

支持：

```html
<style scoped>
  .a {
    color: red;
  }
  .a :deep(.child) {
    color: blue;
  }
  @keyframes fade {
    to {
      opacity: 0;
    }
  }
</style>
```

不支持：Sass/Less/Stylus、CSS Modules、CSS 中的 `v-bind()`、
完整的 CSS 语法校验（无效 CSS 会被原样注入）。

### 模板与 CSP

模板使用 Vue 模板编译器的 **module 模式**编译，`compileScript` 和
`compileTemplate` 生成的脚本/render 都是原生 ES Module，不再使用
`new Function` 执行，因此正常路径不需要 `'unsafe-eval'`。

编译后的模块使用 `blob:` URL（浏览器）或 `data:` URL（Node）加载，
CSP 需要允许对应的脚本来源。

## 迁移步骤

1. 把脚本地址/包名从 `vue3-sfc-loader` 换成 `vue3-sfc-loader-lite`。
2. 保留原来的 `options`，删除与 Babel/PostCSS 相关的配置。
3. 把所有 `<script>` 改成标准 ESM；JS 版 `<script setup>` 可以直接使用。
4. 把所有 `<style lang="...">` 改成纯 CSS。
5. 把 pug 等模板语言改成 HTML。
6. 检查 CSP 是否允许 `blob:` 模块脚本；正常路径不需要 `'unsafe-eval'`。
7. 资源路径按页面路径书写（本库不会把模板里的 `src="./x.png"` 转成 import）。

更多细节见 [docs/migration.md](./docs/migration.md)。

## 开发与测试

```sh
npm install
npm run build       # 构建 dist/（运行时 + 预编译入口）和类型声明
npm run test:unit   # Node 单元测试
npm run test        # 构建 + 单元测试 + Playwright 浏览器测试
npm run size        # 查看 raw/gzip/brotli 体积
```

## License

MIT
