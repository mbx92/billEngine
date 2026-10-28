<script setup lang="ts">
withDefaults(
  defineProps<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; dot?: boolean }>(),
  { tone: 'neutral', dot: false },
)

const tones = {
  neutral: 'border-line bg-surface-raised text-muted',
  success: 'border-success/20 bg-success/5 text-success',
  warning: 'border-warning/25 bg-warning/10 text-warning',
  danger: 'border-danger/25 bg-danger/10 text-danger',
  info: 'border-info/25 bg-info/10 text-info',
}
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4"
    :class="tones[tone]"
  >
    <span v-if="dot" class="size-1.5 rounded-full bg-current" />
    <slot />
  </span>
</template>
