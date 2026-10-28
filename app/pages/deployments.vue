<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Aktivitas infrastruktur - Billing Infra' })
</script>

<template>
  <InfrastructureOperationsPanel />
</template>
