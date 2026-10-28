<script setup lang="ts">
withDefaults(defineProps<{ title: string; description: string; level?: 1 | 2 }>(), { level: 1 })
</script>

<template>
  <header
    class="mb-5 flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center"
  >
    <div class="min-w-0">
      <component
        :is="level === 1 ? 'h1' : 'h2'"
        class="text-xl font-semibold tracking-tight text-ink"
        >{{ title }}</component
      >
      <p class="mt-1 text-sm leading-6 text-muted">{{ description }}</p>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <slot />
    </div>
  </header>
</template>
