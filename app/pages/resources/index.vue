<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import type { ApiCoolifySyncResult, ApiResourceListResponse } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Resources · Billing Infra' })

const format = useFormat()
const page = ref(1)
const perPage = 25
const syncing = ref(false)
const syncMessage = ref<string | null>(null)
const syncError = ref<string | null>(null)

const { data, status, error, refresh } = await useFetch<ApiResourceListResponse>('/api/resources', {
  query: { page, perPage },
})

const resources = computed(() => data.value?.data ?? [])
const summary = computed(() => data.value?.summary)
const meta = computed(() => data.value?.meta)

async function syncResources() {
  syncing.value = true
  syncMessage.value = null
  syncError.value = null

  try {
    const response = await $fetch<{ data: ApiCoolifySyncResult }>('/api/coolify/sync', {
      method: 'POST',
    })
    page.value = 1
    await refresh()
    syncMessage.value = `${format.count(response.data.processedCount)} aplikasi berhasil disinkronkan dari Coolify.`
  } catch (error) {
    syncError.value = getSyncErrorMessage(error)
  } finally {
    syncing.value = false
  }
}

function getSyncErrorMessage(error: unknown) {
  return apiErrorMessage(error, 'Sinkronisasi Coolify gagal. Periksa halaman Servers untuk detail.')
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / resources
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Coolify Resources</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Cached application inventory, resource allocation, billing assignment, and not-billed
          detection. CPU/RAM “Unlimited” berarti Coolify mengembalikan limit 0 (belum dibatasi).
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
          Refresh cache
        </UiButton>
        <UiButton :disabled="syncing" @click="syncResources">
          <RefreshCw
            :size="15"
            :stroke-width="1.8"
            :class="{ 'animate-spin': syncing }"
            aria-hidden="true"
          />
          {{ syncing ? 'Syncing…' : 'Sync from Coolify' }}
        </UiButton>
      </div>
    </header>

    <p
      v-if="syncMessage"
      class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
      role="status"
    >
      {{ syncMessage }}
    </p>
    <p
      v-if="syncError"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ syncError }}
    </p>

    <div v-if="summary" class="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
      <UiStat
        label="Total resources"
        :value="format.count(summary.total)"
        :detail="`${format.count(summary.billable)} billable`"
      />
      <UiStat
        label="Running"
        :value="format.count(summary.running)"
        :detail="`${format.count(summary.stopped)} stopped`"
        tone="success"
      />
      <UiStat
        label="Not billed"
        :value="format.count(summary.notBilled)"
        detail="Tanpa service aktif"
        :tone="summary.notBilled > 0 ? 'warning' : 'neutral'"
      />
      <UiStat
        label="Last synced"
        :value="summary.lastSyncedAt ? 'Tersinkron' : 'Belum'"
        :detail="format.dateTime(summary.lastSyncedAt)"
      />
    </div>

    <UiCard :padded="false">
      <div class="flex h-11 items-center justify-between border-b px-4">
        <span class="text-xs font-semibold text-muted">Inventory</span>
        <UiBadge v-if="meta">{{ format.count(meta.total) }} total</UiBadge>
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="2.25rem" />
      </div>

      <UiEmptyState
        v-else-if="error"
        title="Gagal memuat resources"
        description="Server tidak dapat membaca cache resource. Coba muat ulang halaman."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>

      <UiEmptyState
        v-else-if="resources.length === 0"
        title="Resource inventory is empty"
        description="Jalankan sinkronisasi resource dari Coolify untuk mengisi cache inventory."
      >
        <UiButton size="sm" :disabled="syncing" @click="syncResources">
          Sync from Coolify
        </UiButton>
      </UiEmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[960px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Resource</th>
                <th class="px-4 py-3 font-semibold">Status</th>
                <th class="px-4 py-3 font-semibold">Server</th>
                <th class="px-4 py-3 font-semibold">Service</th>
                <th class="px-4 py-3 text-right font-semibold">CPU</th>
                <th class="px-4 py-3 text-right font-semibold">Memory</th>
                <th class="px-4 py-3 font-semibold">Last seen</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="resource in resources"
                :key="resource.id"
                class="border-b last:border-0 hover:bg-surface-raised/60"
              >
                <td class="px-4 py-3">
                  <span class="block font-medium text-ink">{{ resource.name }}</span>
                  <span class="block font-mono text-xs text-muted">{{ resource.coolifyUuid }}</span>
                </td>
                <td class="px-4 py-3">
                  <ResourceStatusBadge :status="resource.status" />
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  <span class="block text-ink">{{
                    resource.nodeName || 'Node tidak diketahui'
                  }}</span>
                  <span class="block">{{ resource.serverName }}</span>
                </td>
                <td class="px-4 py-3">
                  <div v-if="resource.services.length" class="flex flex-wrap gap-1.5">
                    <span
                      v-for="service in resource.services"
                      :key="service.id"
                      class="inline-flex items-center gap-1.5 rounded border bg-canvas px-2 py-0.5 font-mono text-[11px] text-muted"
                    >
                      {{ service.serviceNumber }}
                    </span>
                  </div>
                  <UiBadge v-else tone="warning">Not billed</UiBadge>
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs text-muted">
                  {{ format.cpu(resource.limitsCpus) }}
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs text-muted">
                  {{ format.bytes(resource.limitsMemoryBytes) }}
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ format.dateTime(resource.lastSeenAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <UiPagination
          v-if="meta"
          :page="meta.page"
          :per-page="meta.perPage"
          :total="meta.total"
          :total-pages="meta.totalPages"
          @update:page="page = $event"
        />
      </template>
    </UiCard>
  </div>
</template>
