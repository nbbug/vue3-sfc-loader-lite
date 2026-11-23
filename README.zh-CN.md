# vue3-sfc-loader-lite（中文说明）

一个只面向 **Vue 3** 的轻量级单文件组件（SFC）运行时加载器，是
[`vue3-sfc-loader`](https://github.com/FranckFreiburger/vue3-sfc-loader) 的精简替代品。

它保留了原项目的 `loadModule(path, options)` API 和 `moduleCache` 机制，
但去掉了脚本转译和样式预处理链路：

- `<script>` 必须是浏览器可直接运行的 **标准 ES Module**，不再经过 Babel。
- `<style>` 必须是 **纯 CSS**，不再经过 PostCSS，也不支持 Sass/Less/Stylus。
- 只支持 Vue 3，直接使用 `@vue/compiler-sfc` 的 `parse` 和 `compileTemplate`。
- 体积：压缩后约 **175 kB gzip / 526 kB min**（原版约 488 kB gzip / 1794 kB min）。

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
| `<script>`                                                      | 可由 Babel 转译 TS/JSX/ESM/CJS | 必须是标准 ESM                                         |
| `<script setup>`                                                | 支持                           | 不支持，请改为普通 `<script>` + `setup()`              |
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
- TypeScript、JSX
- `<script setup>`
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

模板使用 Vue 模板编译器的 function 模式编译，生成的 render 函数通过
`with (_ctx)` 在运行时解析绑定，并用 `new Function` 执行。这样做是为了在
**不引入 Babel** 的前提下支持 `{{ a + b }}`、`:class="{ active: ok }"`、
`@click="count++"` 等复杂表达式。

因此页面 CSP 需要允许 `'unsafe-eval'`；模块脚本本身使用 `blob:` URL
（浏览器）或 `data:` URL（Node），CSP 也需要允许对应的脚本来源。
原版 `vue3-sfc-loader` 同样使用 `Function` 执行生成的脚本，所以 `'unsafe-eval'` 通常已经允许；
本库额外使用 `blob:` URL 加载模块，因此 `script-src` 还需要允许 `blob:`。

## 迁移步骤

1. 把脚本地址/包名从 `vue3-sfc-loader` 换成 `vue3-sfc-loader-lite`。
2. 保留原来的 `options`，删除与 Babel/PostCSS 相关的配置。
3. 把所有 `<script>` 改成标准 ESM；把 `<script setup>` 改成普通
   `<script>` + `setup()`。
4. 把所有 `<style lang="...">` 改成纯 CSS。
5. 把 pug 等模板语言改成 HTML。
6. 检查 CSP 是否允许 `'unsafe-eval'`。
7. 资源路径按页面路径书写（本库不会把模板里的 `src="./x.png"` 转成 import）。

更多细节见 [docs/migration.md](./docs/migration.md)。

## 开发与测试

```sh
npm install
npm run build       # 构建 dist/ 和类型声明
npm run test:unit   # Node 单元测试
npm run test        # 构建 + 单元测试 + Playwright 浏览器测试
npm run size        # 查看 raw/gzip/brotli 体积
```

## License

MIT
