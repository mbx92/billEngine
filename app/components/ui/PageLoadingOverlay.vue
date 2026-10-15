<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'

const pageLoading = usePageLoading()
const hydrating = ref(true)
const navigating = ref(false)
const nuxtApp = useNuxtApp()
let cancelHydrationTimer: (() => void) | undefined

nuxtApp.hook('page:start', () => {
  navigating.value = true
})
nuxtApp.hook('page:finish', () => {
  navigating.value = false
})
nuxtApp.hook('app:error', () => {
  navigating.value = false
})

onMounted(() => {
  const timerId = window.setTimeout(() => {
    hydrating.value = false
  }, 600)
  cancelHydrationTimer = () => window.clearTimeout(timerId)
})

onBeforeUnmount(() => {
  cancelHydrationTimer?.()
})

const visible = computed(() => hydrating.value || navigating.value || pageLoading.active.value)
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-150"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-150"
    leave-to-class="opacity-0"
  >
    <div
      v-if="visible"
      class="fixed inset-0 z-[90] flex items-center justify-center bg-canvas/70 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-label="Memuat halaman"
    >
      <div
        class="flex flex-col items-center gap-3 rounded-xl border bg-surface px-6 py-5 shadow-xl"
      >
        <LoaderCircle :size="30" class="animate-spin text-brand" aria-hidden="true" />
        <span class="text-xs font-semibold tracking-wide text-muted uppercase">Memuat…</span>
      </div>
    </div>
  </Transition>
</template>
