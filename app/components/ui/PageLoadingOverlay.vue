<script setup lang="ts">
const pageLoading = usePageLoading()
const navigating = ref(false)
const nuxtApp = useNuxtApp()
const unhook = [
  nuxtApp.hook('page:start', () => {
    navigating.value = true
  }),
  nuxtApp.hook('page:finish', () => {
    navigating.value = false
  }),
  nuxtApp.hook('app:error', () => {
    navigating.value = false
  }),
]

onBeforeUnmount(() => {
  unhook.forEach((remove) => remove())
})

const visible = computed(() => navigating.value || pageLoading.active.value)
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
      class="pointer-events-none fixed inset-x-0 top-0 z-[90] h-0.5 overflow-hidden bg-brand/15"
      role="status"
      aria-live="polite"
      aria-label="Memuat halaman"
    >
      <div class="loading-bar h-full w-1/3 bg-brand" aria-hidden="true" />
    </div>
  </Transition>
</template>

<style scoped>
.loading-bar {
  animation: loading-progress 1.2s ease-in-out infinite;
}
@keyframes loading-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading-bar {
    animation: none;
    width: 100%;
  }
}
</style>
