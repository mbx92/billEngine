<script setup lang="ts">
import type { InvoiceStatus, PaymentStatus } from '#shared/constants/domain'
import {
  invoiceStatusLabel,
  invoiceStatusTone,
  paymentStatusLabel,
  paymentStatusTone,
} from '~/lib/billing-status'

const props = defineProps<
  { kind: 'invoice'; status: InvoiceStatus } | { kind: 'payment'; status: PaymentStatus }
>()

const label = computed(() =>
  props.kind === 'invoice' ? invoiceStatusLabel(props.status) : paymentStatusLabel(props.status),
)

const tone = computed(() =>
  props.kind === 'invoice' ? invoiceStatusTone(props.status) : paymentStatusTone(props.status),
)
</script>

<template>
  <UiBadge :tone="tone" dot>{{ label }}</UiBadge>
</template>
