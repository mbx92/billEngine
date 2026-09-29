<script setup lang="ts">
const props = withDefaults(
  defineProps<{ value: number; max?: number; tone?: 'brand' | 'warning' | 'danger' }>(),
  {
    max: 100,
    tone: 'brand',
  },
)
const width = computed(() => `${Math.min(100, Math.max(0, (props.value / props.max) * 100))}%`)
const tones = { brand: 'bg-brand', warning: 'bg-warning', danger: 'bg-danger' }
</script>

<template>
  <div
    class="h-1.5 overflow-hidden rounded-full bg-line"
    role="progressbar"
    :aria-valuenow="value"
    :aria-valuemax="max"
  >
    <div class="h-full rounded-full transition-all" :class="tones[tone]" :style="{ width }" />
  </div>
</template>
