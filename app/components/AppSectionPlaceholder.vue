<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow: string
    title: string
    description: string
    action?: string
    /** Why this section has no data yet — shown instead of a generic empty state. */
    note?: string
    badge?: string
  }>(),
  {
    action: undefined,
    note: 'Endpoint, service, dan repository untuk modul ini belum diimplementasikan.',
    badge: 'Not implemented',
  },
)
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          {{ eyebrow }}
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ title }}</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">{{ description }}</p>
      </div>
      <UiButton v-if="action" variant="secondary" disabled>{{ action }}</UiButton>
    </header>
    <UiCard :padded="false">
      <div class="flex h-11 items-center justify-between border-b px-4">
        <span class="text-xs font-semibold text-muted">Inventory</span>
        <UiBadge tone="neutral">{{ badge }}</UiBadge>
      </div>
      <UiEmptyState title="Belum tersedia" :description="note" />
    </UiCard>
  </div>
</template>
