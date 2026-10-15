<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    action: () => Promise<unknown> | unknown
    pending?: boolean
    label?: string
    size?: 'sm' | 'md'
    variant?: 'secondary' | 'ghost'
  }>(),
  { pending: false, label: 'Refresh', size: 'md', variant: 'secondary' },
)

const pageLoading = usePageLoading()
const refreshing = ref(false)
const busy = computed(() => refreshing.value || props.pending)

async function execute() {
  if (busy.value) return
  refreshing.value = true
  try {
    await pageLoading.run(props.action)
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <UiButton :variant="variant" :size="size" :disabled="busy" @click="execute">
    <RefreshCw :size="15" :class="{ 'animate-spin': busy }" aria-hidden="true" />
    {{ label }}
  </UiButton>
</template>
