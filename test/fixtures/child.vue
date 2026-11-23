<template>
  <span class="child">child-{{ value }}</span>
</template>

<script>
export default {
  props: {
    value: { type: String, required: true },
  },
}
</script>

<style scoped>
.child {
  text-decoration: underline;
}
</style>
