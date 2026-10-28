<script setup lang="ts">
defineProps<{ title: string; description: string }>()
</script>

<template>
  <div class="flex min-h-36 flex-col items-center justify-center px-5 py-8 text-center">
    <h3 class="text-sm font-medium text-ink">{{ title }}</h3>
    <p class="mt-1 max-w-md text-sm leading-6 text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>
