<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Payments · Billing Infra' })
</script>

<template>
  <AppSectionPlaceholder
    eyebrow="Commercial / payments"
    title="Payments"
    description="Manual payment records and allocation against issued invoices."
    note="Pencatatan payment manual bergantung pada invoice yang sudah terbit. Endpoint payment belum diimplementasikan."
  />
</template>
