<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button', disabled: false },
)

const classes = {
  primary:
    'border-brand bg-brand text-brand-contrast hover:border-brand-strong hover:bg-brand-strong',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-surface-raised',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-raised hover:text-ink',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
    :class="[classes[variant], size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm']"
  >
    <slot />
  </button>
</template>
