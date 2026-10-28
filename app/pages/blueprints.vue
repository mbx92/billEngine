<script setup lang="ts">
definePageMeta({ middleware: 'auth', alias: ['/templates'] })
useHead({ title: 'Templates - Billing Infra' })
</script>

<template>
  <InfrastructureTemplatesPanel />
</template>
