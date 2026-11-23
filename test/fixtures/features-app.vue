<template>
  <div>
    <p id="expr">{{ a + b }}</p>
    <p id="class" :class="{ active: enabled }">class</p>
    <ul>
      <li v-for="(item, index) in items" :key="index" class="item">
        {{ index }}:{{ item }}
      </li>
    </ul>
    <p id="cond" v-if="enabled">visible</p>
    <p id="else" v-else>hidden</p>
    <input id="input" v-model="text" />
    <p id="text">{{ text }}</p>
    <p id="count">{{ count }}</p>
    <p id="setup">{{ setupValue }}</p>
    <p id="computed-dynamic">{{ computedDynamic }}</p>
    <child-view><em id="slot" class="b">slotted</em></child-view>
    <button id="toggle" @click="toggle">toggle</button>
    <button id="inline" @click="count++">inline</button>
    <button id="computed" @click="loadComputed">computed import</button>
  </div>
</template>

<script>
import { ref } from 'vue'
import ChildView from './slot-child.vue'

export default {
  components: { ChildView },
  setup() {
    return { setupValue: ref(9) }
  },
  data() {
    return {
      a: 1,
      b: 2,
      enabled: true,
      items: ['x', 'y'],
      text: 'abc',
      count: 0,
      computedDynamic: 'not-loaded',
    }
  },
  methods: {
    toggle() {
      this.enabled = !this.enabled
    },
    async loadComputed() {
      const name = 'computed'
      try {
        const module = await import(`./lazy-${name}.vue`)
        this.computedDynamic = module.default && module.default.__file ? 'computed-loaded' : 'bad-module'
      } catch (error) {
        this.computedDynamic = 'error:' + String(error && (error.message || error))
      }
    },
  },
}
</script>

<style scoped>
.active {
  color: rgb(255, 0, 0);
}

@keyframes fade {
  to {
    opacity: 0;
  }
}

.item {
  animation: fade 1s;
}
</style>
