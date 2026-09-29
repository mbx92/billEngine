<script setup lang="ts">
import { formatMoney } from '~/lib/format'

const props = withDefaults(defineProps<{ amount: bigint | number | string; currency?: string }>(), {
  currency: 'IDR',
})

/**
 * The API serializes money as a decimal string (BigInt cannot be JSON encoded),
 * so accept all three shapes and normalize for display only.
 */
const formatted = computed(() => formatMoney(props.amount, props.currency))
</script>

<template>
  <span class="tabular-nums">{{ formatted }}</span>
</template>
