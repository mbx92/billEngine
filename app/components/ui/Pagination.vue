<script setup lang="ts">
import { ChevronLeft, ChevronRight } from '@lucide/vue'

const props = defineProps<{
  page: number
  perPage: number
  total: number
  totalPages: number
}>()

const emit = defineEmits<{ 'update:page': [page: number] }>()

const range = computed(() => {
  if (props.total === 0) return '0'
  const start = (props.page - 1) * props.perPage + 1
  const end = Math.min(props.page * props.perPage, props.total)
  return `${start}–${end}`
})
</script>

<template>
  <div class="flex items-center justify-between gap-4 border-t px-4 py-3">
    <p class="text-[11px] text-muted">
      <span class="font-medium text-ink tabular-nums">{{ range }}</span> dari {{ total }} data
    </p>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="focus-ring flex size-8 items-center justify-center rounded-lg border bg-surface text-muted transition enabled:hover:bg-surface-raised enabled:hover:text-ink disabled:opacity-40"
        :disabled="page <= 1"
        aria-label="Halaman sebelumnya"
        @click="emit('update:page', page - 1)"
      >
        <ChevronLeft :size="16" :stroke-width="1.8" aria-hidden="true" />
      </button>
      <span class="px-1 text-[11px] text-muted tabular-nums"
        >{{ page }} / {{ Math.max(totalPages, 1) }}</span
      >
      <button
        type="button"
        class="focus-ring flex size-8 items-center justify-center rounded-lg border bg-surface text-muted transition enabled:hover:bg-surface-raised enabled:hover:text-ink disabled:opacity-40"
        :disabled="page >= totalPages"
        aria-label="Halaman berikutnya"
        @click="emit('update:page', page + 1)"
      >
        <ChevronRight :size="16" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
