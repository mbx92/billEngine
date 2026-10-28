<script setup lang="ts">
defineProps<{
  label: string
  value: string
  detail?: string
  tone?: 'neutral' | 'success' | 'warning'
}>()
</script>

<template>
  <UiCard class="min-w-0">
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs font-medium text-muted">{{ label }}</p>
      <span v-if="$slots.icon" class="text-muted">
        <slot name="icon" />
      </span>
    </div>
    <p
      class="mt-2 break-words text-2xl leading-tight font-medium tracking-tight tabular-nums"
      :class="tone === 'warning' ? 'text-warning' : 'text-ink'"
      :title="value"
    >
      {{ value }}
    </p>
    <p v-if="detail" class="mt-1 text-xs leading-5 text-muted">{{ detail }}</p>
  </UiCard>
</template>
