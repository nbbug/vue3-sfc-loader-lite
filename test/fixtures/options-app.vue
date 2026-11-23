<template>
  <div id="options-root">
    <span id="util">{{ formatted }}</span>
    <span id="json">{{ jsonValue }}</span>
    <span id="i18n">{{ i18n }}</span>
    <span id="message">{{ message }}</span>
    <Hooked />
    <button id="load" @click="loadLazy">load lazy</button>
    <component :is="lazy" v-if="lazy" />
  </div>
</template>

<script>
import { format } from 'my-utils'
import data from './data.json'
import message from './message.txt'
import Hooked from './hooked.vue'

export default {
  components: { Hooked },
  data() {
    return {
      formatted: format('x'),
      jsonValue: data.value,
      i18n: this.$options.i18n,
      message,
      lazy: null,
    }
  },
  methods: {
    async loadLazy() {
      window.__loadLazyCalls = (window.__loadLazyCalls || 0) + 1
      try {
        const module = await import('./lazy.vue')
        window.__lazyModule = module
        this.lazy = module.default
      } catch (error) {
        window.__lazyError = String((error && (error.stack || error.message)) || error)
      }
    },
  },
}
</script>

<i18n>translated</i18n>
