<script setup lang="ts">
import type { ResourceStatus, ServiceStatus } from '#shared/constants/domain'

const props = defineProps<{
  status: ResourceStatus | ServiceStatus | 'active' | 'inactive'
}>()

const tone = computed(
  () =>
    (
      ({
        running: 'success',
        active: 'success',
        stopped: 'neutral',
        inactive: 'neutral',
        restarting: 'info',
        suspended: 'warning',
        degraded: 'warning',
        cancelled: 'danger',
        unknown: 'neutral',
      }) as const
    )[props.status],
)
</script>

<template>
  <UiBadge :tone="tone" dot>{{ status }}</UiBadge>
</template>
