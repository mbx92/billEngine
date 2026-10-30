<script setup lang="ts">
const appSettings = useAppSettings()
const appVersion = useAppVersion()
</script>

<template>
  <footer
    class="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 lg:px-8"
    aria-label="Informasi aplikasi"
  >
    <div
      class="mx-auto flex w-full max-w-7xl flex-col gap-2 border-t pt-4 text-xs leading-5 text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <span class="min-w-0 break-words">{{ appSettings.billingTimezone }}</span>
      <span class="min-w-0 break-words sm:text-right">{{ appVersion.label }}</span>
    </div>
  </footer>
</template>
