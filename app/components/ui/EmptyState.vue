<script setup lang="ts">
defineProps<{ title: string; description: string }>()
</script>

<template>
  <div class="flex min-h-48 flex-col items-center justify-center px-6 py-12 text-center">
    <div
      class="mb-4 flex size-10 items-center justify-center rounded-md border bg-canvas font-mono text-brand"
    >
      _
    </div>
    <h3 class="text-sm font-semibold text-ink">{{ title }}</h3>
    <p class="mt-1 max-w-md text-sm leading-6 text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5"><slot /></div>
  </div>
</template>
