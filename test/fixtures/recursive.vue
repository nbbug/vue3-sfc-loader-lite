<template>
  <div class="node">
    <span>{{ n }}</span>
    <recursive-child v-if="n > 0" :n="n - 1" />
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue'

export default {
  name: 'RecursiveNode',
  props: {
    n: { type: Number, required: true },
  },
  components: {
    RecursiveChild: defineAsyncComponent(() => import('./recursive.vue')),
  },
}
</script>

<style scoped>
.node {
  margin-left: 4px;
}
</style>
