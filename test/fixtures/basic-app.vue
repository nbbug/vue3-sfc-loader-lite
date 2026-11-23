<template>
  <div class="app">
    <span class="msg">{{ msg }}</span> <child-view :value="msg" />
  </div>
</template>

<script>
import ChildView from './child.vue'
import { upper } from './util.js'

export default {
  components: { ChildView },
  data() {
    return {
      msg: upper('hello'),
    }
  },
}
</script>

<style scoped>
.app {
  color: rgb(255, 0, 0);
}

.app .msg:hover {
  color: rgb(0, 0, 255);
}
</style>

<style>
.app {
  font-weight: 700;
}
</style>
