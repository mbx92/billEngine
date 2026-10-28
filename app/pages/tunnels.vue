<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Tunnels - Billing Infra' })
</script>

<template>
  <InfrastructureTunnelsPanel />
</template>
