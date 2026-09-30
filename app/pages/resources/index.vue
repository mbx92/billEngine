<script setup lang="ts">
import { LoaderCircle, RefreshCw, Search, Tags, X } from '@lucide/vue'
import type {
  ApiCoolifySyncResult,
  ApiResourceListItem,
  ApiResourceListResponse,
  ApiResourceMetricsResponse,
  ApiResourceSummary,
  ApiResourceUsageMetric,
  ResourceClassification,
} from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Resources · Billing Infra' })

const format = useFormat()
const page = ref(1)
const perPage = 25
const searchInput = ref('')
const search = ref('')
const statusFilter = ref('all')
const classificationFilter = ref('all')
const assignmentFilter = ref('all')
const syncing = ref(false)
const syncMessage = ref<string | null>(null)
const syncError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
const metricsLoading = ref(false)
const usageMetrics = ref<ApiResourceUsageMetric[]>([])
const selectedIds = ref<string[]>([])
const bulkClassification = ref<ResourceClassification>('billable')
const bulkSaving = ref(false)
const rowSavingIds = ref<string[]>([])

const resourceQuery = computed(() => ({
  page: page.value,
  perPage,
  q: search.value || undefined,
  status: statusFilter.value === 'all' ? undefined : statusFilter.value,
  classification: classificationFilter.value === 'all' ? undefined : classificationFilter.value,
  assignment: assignmentFilter.value === 'all' ? undefined : assignmentFilter.value,
}))

const { data, status, error, refresh } = await useFetch<ApiResourceListResponse>('/api/resources', {
  query: resourceQuery,
})

const resources = computed(() => data.value?.data ?? [])
const summary = computed(() => data.value?.summary)
const meta = computed(() => data.value?.meta)
const metricsByResource = computed(
  () => new Map(usageMetrics.value.map((metric) => [metric.resourceId, metric])),
)
const allPageSelected = computed(
  () =>
    resources.value.length > 0 &&
    resources.value.every((item) => selectedIds.value.includes(item.id)),
)

watch([statusFilter, classificationFilter, assignmentFilter], () => {
  page.value = 1
})

watch(resources, (current) => {
  const visibleIds = new Set(current.map((resource) => resource.id))
  selectedIds.value = selectedIds.value.filter((id) => visibleIds.has(id))
})

onMounted(() => {
  watch(resources, loadUsageMetrics, { immediate: true })
})

async function refreshResources() {
  await refresh()
  await loadUsageMetrics()
}

function applySearch() {
  search.value = searchInput.value.trim()
  page.value = 1
}

function clearFilters() {
  searchInput.value = ''
  search.value = ''
  statusFilter.value = 'all'
  classificationFilter.value = 'all'
  assignmentFilter.value = 'all'
  page.value = 1
}

function togglePageSelection() {
  if (allPageSelected.value) {
    const pageIds = new Set(resources.value.map((resource) => resource.id))
    selectedIds.value = selectedIds.value.filter((id) => !pageIds.has(id))
    return
  }

  selectedIds.value = [
    ...new Set([...selectedIds.value, ...resources.value.map((item) => item.id)]),
  ]
}

function toggleResource(resourceId: string) {
  selectedIds.value = selectedIds.value.includes(resourceId)
    ? selectedIds.value.filter((id) => id !== resourceId)
    : [...selectedIds.value, resourceId]
}

function isRowSaving(resourceId: string) {
  return rowSavingIds.value.includes(resourceId)
}

function applyClassificationLocally(
  resourceIds: string[],
  classification: ResourceClassification,
  updatedSummary: ApiResourceSummary,
) {
  if (!data.value) return

  const ids = new Set(resourceIds)
  const rows = data.value.data
  let removedCount = 0

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const resource = rows[index]!
    if (!ids.has(resource.id)) continue

    const hiddenByClassification =
      classificationFilter.value !== 'all' && classificationFilter.value !== classification
    const hiddenByNotBilled =
      assignmentFilter.value === 'not_billed' && classification !== 'billable'

    if (hiddenByClassification || hiddenByNotBilled) {
      rows.splice(index, 1)
      removedCount += 1
    } else {
      resource.classification = classification
    }
  }

  data.value.summary = updatedSummary
  if (removedCount > 0) {
    const total = Math.max(0, data.value.meta.total - removedCount)
    data.value.meta = {
      ...data.value.meta,
      total,
      totalPages: Math.ceil(total / data.value.meta.perPage),
    }
  }
}

async function updateClassification(resource: ApiResourceListItem, event: Event) {
  const select = event.target as HTMLSelectElement
  const classification = select.value as ResourceClassification
  if (classification === resource.classification) return

  rowSavingIds.value = [...rowSavingIds.value, resource.id]
  actionError.value = null
  actionMessage.value = null
  try {
    const response = await $fetch<{ data: unknown; summary: ApiResourceSummary }>(
      `/api/resources/${resource.id}`,
      {
        method: 'PATCH',
        body: { classification },
      },
    )
    actionMessage.value = `${resource.name} ditandai sebagai ${classificationLabel(classification)}.`
    applyClassificationLocally([resource.id], classification, response.summary)
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal mengubah klasifikasi resource.')
    select.value = resource.classification
  } finally {
    rowSavingIds.value = rowSavingIds.value.filter((id) => id !== resource.id)
  }
}

async function updateBulkClassification() {
  if (selectedIds.value.length === 0) return

  bulkSaving.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    const response = await $fetch<{
      data: { updatedCount: number }
      summary: ApiResourceSummary
    }>('/api/resources/classification', {
      method: 'PATCH',
      body: {
        resourceIds: selectedIds.value,
        classification: bulkClassification.value,
      },
    })
    actionMessage.value = `${format.count(response.data.updatedCount)} resource diperbarui menjadi ${classificationLabel(bulkClassification.value)}.`
    applyClassificationLocally(selectedIds.value, bulkClassification.value, response.summary)
    selectedIds.value = []
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal memperbarui klasifikasi resource.')
  } finally {
    bulkSaving.value = false
  }
}

function classificationLabel(classification: ResourceClassification) {
  return { billable: 'Billable', internal: 'Internal', ignored: 'Ignored' }[classification]
}

async function loadUsageMetrics() {
  const ids = resources.value.map((resource) => resource.id)
  if (ids.length === 0) {
    usageMetrics.value = []
    return
  }

  metricsLoading.value = true
  try {
    const response = await $fetch<ApiResourceMetricsResponse>('/api/resources/metrics', {
      query: { ids: ids.join(',') },
    })
    usageMetrics.value = response.data
  } catch {
    usageMetrics.value = []
  } finally {
    metricsLoading.value = false
  }
}

function usageText(resourceId: string, kind: 'cpu' | 'memory') {
  if (metricsLoading.value) return 'Memuat…'
  const metric = metricsByResource.value.get(resourceId)
  if (!metric) return 'Tidak tersedia'
  if (metric.status === 'disabled') return 'Metrics off'
  if (metric.status === 'unsupported') return 'Tidak didukung'
  if (metric.status === 'no_data') return 'Belum ada data'
  if (metric.status === 'unreachable') return 'Tidak terjangkau'

  if (kind === 'memory') return format.bytes(metric.memoryUsageBytes)
  if (metric.cpuPercent === null) return '—'
  return `${metric.cpuPercent.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`
}

function usageTitle(resourceId: string) {
  const metric = metricsByResource.value.get(resourceId)
  return metric?.sampledAt ? `Sampel ${format.dateTime(metric.sampledAt)}` : undefined
}

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
    await loadUsageMetrics()
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
          detection. Limit berasal dari konfigurasi aplikasi; usage live berasal dari Coolify
          Sentinel saat metrics aktif.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refreshResources()">
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
    <p
      v-if="actionMessage"
      class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
      role="status"
    >
      {{ actionMessage }}
    </p>
    <p
      v-if="actionError"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <div v-if="summary" class="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
      <UiStat
        label="Total resources"
        :value="format.count(summary.total)"
        :detail="`${format.count(summary.billable)} billable · ${format.count(summary.internal)} internal · ${format.count(summary.ignored)} ignored`"
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

    <UiCard class="mb-5">
      <form
        class="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_180px_180px_auto]"
        @submit.prevent="applySearch"
      >
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Cari resource</span>
          <div class="relative">
            <Search
              class="absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              :size="15"
              aria-hidden="true"
            />
            <input
              v-model="searchInput"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas pr-3 pl-9 text-sm text-ink placeholder:text-muted/60"
              placeholder="Nama, UUID, project, domain…"
            />
          </div>
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Status</span>
          <select
            v-model="statusFilter"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="all">Semua status</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
            <option value="restarting">Restarting</option>
            <option value="degraded">Degraded</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Classification</span>
          <select
            v-model="classificationFilter"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="all">Semua classification</option>
            <option value="billable">Billable</option>
            <option value="internal">Internal</option>
            <option value="ignored">Ignored</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Assignment</span>
          <select
            v-model="assignmentFilter"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="all">Semua assignment</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
            <option value="not_billed">Not billed</option>
          </select>
        </label>
        <div class="flex items-end gap-2">
          <UiButton type="submit">Terapkan</UiButton>
          <UiButton variant="ghost" aria-label="Reset filter" @click="clearFilters">
            <X :size="15" aria-hidden="true" />
          </UiButton>
        </div>
      </form>
    </UiCard>

    <UiCard :padded="false">
      <div class="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-muted">Inventory</span>
          <UiBadge v-if="meta">{{ format.count(meta.total) }} hasil</UiBadge>
        </div>
        <div v-if="selectedIds.length" class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-muted">{{ selectedIds.length }} dipilih</span>
          <select
            v-model="bulkClassification"
            class="focus-ring h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs text-ink"
          >
            <option value="billable">Billable</option>
            <option value="internal">Internal</option>
            <option value="ignored">Ignored</option>
          </select>
          <UiButton size="sm" :disabled="bulkSaving" @click="updateBulkClassification">
            <Tags :size="14" aria-hidden="true" />
            {{ bulkSaving ? 'Menyimpan…' : 'Ubah classification' }}
          </UiButton>
        </div>
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
          <table class="w-full min-w-[1240px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="w-10 px-4 py-3 font-semibold">
                  <input
                    type="checkbox"
                    class="focus-ring size-4 rounded border-line-strong bg-canvas accent-brand"
                    :checked="allPageSelected"
                    aria-label="Pilih semua resource pada halaman ini"
                    @change="togglePageSelection"
                  />
                </th>
                <th class="px-4 py-3 font-semibold">Resource</th>
                <th class="px-4 py-3 font-semibold">Status</th>
                <th class="px-4 py-3 font-semibold">Classification</th>
                <th class="px-4 py-3 font-semibold">Server</th>
                <th class="px-4 py-3 font-semibold">Service</th>
                <th class="px-4 py-3 text-right font-semibold">CPU limit / usage</th>
                <th class="px-4 py-3 text-right font-semibold">RAM limit / usage</th>
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
                  <input
                    type="checkbox"
                    class="focus-ring size-4 rounded border-line-strong bg-canvas accent-brand"
                    :checked="selectedIds.includes(resource.id)"
                    :aria-label="`Pilih ${resource.name}`"
                    @change="toggleResource(resource.id)"
                  />
                </td>
                <td class="px-4 py-3">
                  <span class="block font-medium text-ink">{{ resource.name }}</span>
                  <span class="block font-mono text-xs text-muted">{{ resource.coolifyUuid }}</span>
                  <span
                    v-if="resource.projectName || resource.environmentName"
                    class="mt-1 block text-[11px] text-muted"
                  >
                    {{
                      [resource.projectName, resource.environmentName].filter(Boolean).join(' / ')
                    }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <ResourceStatusBadge :status="resource.status" />
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2">
                    <select
                      :value="resource.classification"
                      class="focus-ring h-8 rounded-md border border-line-strong bg-canvas px-2 text-xs font-semibold text-ink disabled:opacity-50"
                      :disabled="isRowSaving(resource.id)"
                      :aria-label="`Classification ${resource.name}`"
                      @change="updateClassification(resource, $event)"
                    >
                      <option value="billable">Billable</option>
                      <option value="internal">Internal</option>
                      <option value="ignored">Ignored</option>
                    </select>
                    <span
                      v-if="isRowSaving(resource.id)"
                      class="inline-flex items-center gap-1 text-[11px] text-muted"
                      role="status"
                    >
                      <LoaderCircle class="animate-spin" :size="13" aria-hidden="true" />
                      Menyimpan…
                    </span>
                  </div>
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
                      :title="`${service.customerName} · ${service.planName || 'Legacy'}`"
                      class="inline-flex items-center gap-1.5 rounded border bg-canvas px-2 py-0.5 text-[11px] text-muted"
                    >
                      {{ service.name }} · {{ service.customerName }}
                    </span>
                  </div>
                  <UiBadge v-else-if="resource.classification === 'billable'" tone="warning">
                    Not billed
                  </UiBadge>
                  <UiBadge v-else>Not assigned</UiBadge>
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs" :title="usageTitle(resource.id)">
                  <span class="block text-ink">{{ format.cpu(resource.limitsCpus) }}</span>
                  <span class="mt-1 block text-muted">{{ usageText(resource.id, 'cpu') }}</span>
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs" :title="usageTitle(resource.id)">
                  <span class="block text-ink">{{ format.bytes(resource.limitsMemoryBytes) }}</span>
                  <span class="mt-1 block text-muted">{{ usageText(resource.id, 'memory') }}</span>
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
