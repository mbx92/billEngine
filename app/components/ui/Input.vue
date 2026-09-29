<script setup lang="ts">
defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ default: '' })
defineProps<{ label?: string; hint?: string; error?: string }>()
</script>

<template>
  <label class="block">
    <span v-if="label" class="mb-2 block text-xs font-semibold text-muted">{{ label }}</span>
    <input
      v-model="model"
      v-bind="$attrs"
      class="focus-ring h-10 w-full rounded-md border bg-canvas px-3 text-sm text-ink placeholder:text-muted/60"
      :class="error ? 'border-danger' : 'border-line-strong'"
    />
    <span
      v-if="error || hint"
      class="mt-1.5 block text-xs"
      :class="error ? 'text-danger' : 'text-muted'"
    >
      {{ error || hint }}
    </span>
  </label>
</template>
