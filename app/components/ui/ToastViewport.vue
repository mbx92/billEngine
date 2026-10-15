<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from '@lucide/vue'

const toast = useToast()

const icons = {
  success: CheckCircle2,
  danger: AlertCircle,
  info: Info,
}

const tones = {
  success: 'border-success/30 text-success',
  danger: 'border-danger/30 text-danger',
  info: 'border-info/30 text-info',
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      aria-live="polite"
      aria-atomic="false"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-2 opacity-0 sm:translate-x-3 sm:translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="translate-y-2 opacity-0 sm:translate-x-3 sm:translate-y-0"
      >
        <div
          v-for="item in toast.toasts.value"
          :key="item.id"
          role="status"
          class="pointer-events-auto flex w-full items-start gap-3 rounded-lg border bg-surface-raised p-3 text-sm shadow-xl shadow-black/15"
          :class="tones[item.tone]"
        >
          <component :is="icons[item.tone]" :size="17" class="mt-0.5 shrink-0" />
          <span class="min-w-0 flex-1 leading-5 text-ink">{{ item.message }}</span>
          <button
            type="button"
            class="focus-ring -m-1 flex size-7 shrink-0 items-center justify-center rounded text-muted hover:bg-surface hover:text-ink"
            aria-label="Tutup notifikasi"
            @click="toast.dismiss(item.id)"
          >
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
