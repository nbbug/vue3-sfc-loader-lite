<template>
  <div class="pc">
    <span class="pc-label">{{ label }}</span>
    <span class="pc-doubled">{{ doubled }}</span>
    <button id="pc-inc" @click="inc">{{ count }}</button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

defineProps({
  label: { type: String, default: 'precompiled' },
})

const count = ref(1)
const doubled = computed(() => count.value * 2)

function inc() {
  count.value += 1
}
</script>

<style scoped>
.pc {
  color: rgb(255, 0, 0);
}

.pc-label {
  font-weight: 700;
}
</style>
