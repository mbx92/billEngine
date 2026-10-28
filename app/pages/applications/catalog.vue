<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Repository & registry - Billing Infra' })
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <NuxtLink
      to="/applications"
      class="focus-ring mb-4 inline-block rounded text-xs text-muted hover:text-ink"
      >Kembali ke aplikasi</NuxtLink
    >
    <InfrastructureSourcePanel />
  </div>
</template>
