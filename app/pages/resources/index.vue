<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Resources - Billing Infra' })
</script>

<template>
  <InfrastructureResourcesPanel />
</template>
