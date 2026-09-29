<script setup lang="ts">
withDefaults(defineProps<{ height?: string }>(), { height: '1rem' })
</script>

<template>
  <div class="animate-pulse rounded bg-line" :style="{ height }" />
</template>
