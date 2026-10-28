<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Database clusters - Billing Infra' })
</script>

<template>
  <InfrastructureDatabasePanel />
</template>
