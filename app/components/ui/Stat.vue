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
      <p class="text-xs font-semibold tracking-wide text-muted uppercase">{{ label }}</p>
      <span
        class="size-1.5 rounded-full"
        :class="
          tone === 'warning' ? 'bg-warning' : tone === 'success' ? 'bg-brand' : 'bg-line-strong'
        "
      />
    </div>
    <p class="mt-3 truncate font-mono text-2xl font-semibold tracking-tight text-ink">
      {{ value }}
    </p>
    <p v-if="detail" class="mt-1 text-xs text-muted">{{ detail }}</p>
  </UiCard>
</template>
