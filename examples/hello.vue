<template>
  <div class="hello">
    <h1>{{ title }}</h1>
    <p>Loaded by vue3-sfc-loader-lite.</p>
    <button @click="count++">clicked {{ count }} time(s)</button>
  </div>
</template>

<script>
export default {
  data() {
    return {
      title: 'Hello from an SFC',
      count: 0,
    }
  },
}
</script>

<style scoped>
.hello {
  font-family: sans-serif;
}

.hello h1 {
  color: #42b883;
}
</style>
