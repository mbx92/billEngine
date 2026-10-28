<script setup lang="ts">
defineProps<{
  label: string
  value: string
  detail?: string
  tone?: 'neutral' | 'success' | 'warning'
}>()
</script>

<template>
  <div class="min-w-0 px-4 py-3">
    <p class="text-xs text-muted">{{ label }}</p>
    <p
      class="mt-1 text-lg font-medium tabular-nums"
      :class="tone === 'warning' ? 'text-warning' : 'text-ink'"
    >
      {{ value }}
    </p>
    <p v-if="detail" class="mt-0.5 text-xs text-muted">{{ detail }}</p>
  </div>
</template>
