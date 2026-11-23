<template>
  <section class="slot-child"><slot /></section>
</template>

<style scoped>
.slot-child :slotted(.b) {
  color: rgb(0, 128, 0);
}
</style>
