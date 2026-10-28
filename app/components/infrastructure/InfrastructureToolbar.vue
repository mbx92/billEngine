<script setup lang="ts">
import { Search } from '@lucide/vue'

const search = defineModel<string>({ default: '' })
defineProps<{ placeholder: string; count: number; total: number; unit: string }>()
</script>

<template>
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <label class="relative min-w-48 flex-1 sm:max-w-sm">
      <span class="sr-only">{{ placeholder }}</span>
      <Search
        :size="15"
        class="pointer-events-none absolute top-2.5 left-3 text-muted"
        aria-hidden="true"
      />
      <input
        v-model="search"
        type="search"
        :placeholder="placeholder"
        class="focus-ring h-9 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted"
      />
    </label>
    <slot />
    <p class="ml-auto text-xs text-muted" role="status" aria-live="polite">
      {{ count === total ? total : `${count} dari ${total}` }} {{ unit }}
    </p>
  </div>
</template>
