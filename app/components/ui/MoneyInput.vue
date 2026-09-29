<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })
withDefaults(
  defineProps<{
    label?: string
    hint?: string
    error?: string
    currency?: string
  }>(),
  { label: undefined, hint: undefined, error: undefined, currency: 'IDR' },
)

const displayValue = computed(() => {
  if (!model.value) return ''
  return model.value.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
})

function updateValue(event: Event) {
  const input = event.target as HTMLInputElement
  model.value = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}
</script>

<template>
  <label class="block">
    <span v-if="label" class="mb-2 block text-xs font-semibold text-muted">{{ label }}</span>
    <span class="relative block">
      <input
        :value="displayValue"
        v-bind="$attrs"
        type="text"
        inputmode="numeric"
        class="focus-ring h-10 w-full rounded-md border bg-canvas px-3 pr-14 font-mono text-sm text-ink placeholder:text-muted/60"
        :class="error ? 'border-danger' : 'border-line-strong'"
        @input="updateValue"
      />
      <span
        class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-semibold text-muted"
      >
        {{ currency.toUpperCase() }}
      </span>
    </span>
    <span
      v-if="error || hint"
      class="mt-1.5 block text-xs"
      :class="error ? 'text-danger' : 'text-muted'"
    >
      {{ error || hint }}
    </span>
  </label>
</template>
