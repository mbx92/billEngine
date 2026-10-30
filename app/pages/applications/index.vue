<script setup lang="ts">
import { ArrowRight, Plus, GitBranch, Box, Layers3 } from '@lucide/vue'
import type { WorkspaceCatalog, WorkspaceResource } from '~/types/infrastructure-workspace'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Aplikasi · Billing Infra' })
const search = ref('')
const filter = ref('all')
const showCreate = ref(false)
const [catalogRequest, resourceRequest] = await Promise.all([
  useFetch<{ data: WorkspaceCatalog }>('/api/infrastructure/applications', {
    key: 'infrastructure-catalog',
  }),
  useFetch<{ data: WorkspaceResource[] }>('/api/infrastructure/resources', {
    key: 'infrastructure-resources',
  }),
])
const catalog = computed(() => catalogRequest.data.value?.data)
const resources = computed(() =>
  (resourceRequest.data.value?.data ?? []).filter((resource) => resource.kind === 'application'),
)
const pending = computed(
  () => catalogRequest.status.value === 'pending' || resourceRequest.status.value === 'pending',
)
const error = computed(() => catalogRequest.error.value || resourceRequest.error.value)
const applications = computed(() => {
  const registeredIds = new Set((catalog.value?.applications ?? []).map((app) => app.id))
  return [
    ...(catalog.value?.applications ?? []).map((app) => ({
      id: app.id,
      name: app.name,
      source: app.repositoryUrl.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, ''),
      repository: true,
      resources: resources.value.filter((resource) => resource.applicationId === app.id),
      builds: (catalog.value?.builds ?? [])
        .filter((build) => build.applicationId === app.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      releases: (catalog.value?.releases ?? []).filter(
        (release) => release.applicationId === app.id,
      ),
    })),
    ...resources.value
      .filter((resource) => !resource.applicationId || !registeredIds.has(resource.applicationId))
      .map((resource) => ({
        id: `resource-${resource.id}`,
        name: resource.name,
        source: resource.imageReference || 'Container image',
        repository: false,
        resources: [resource],
        builds: [],
        releases: [],
      })),
  ].sort((a, b) => a.name.localeCompare(b.name))
})
type Application = (typeof applications.value)[number]
function state(app: Application) {
  if (app.resources.some((r) => ['failed', 'degraded', 'unknown'].includes(r.observedState)))
    return { key: 'attention', label: 'Perlu perhatian', tone: 'danger' as const }
  if (
    app.resources.some(
      (r) => r.desiredState !== r.observedState || r.desiredRevision !== r.observedRevision,
    )
  )
    return { key: 'attention', label: 'Sedang sinkronisasi', tone: 'warning' as const }
  if (app.resources.some((r) => r.observedState === 'running'))
    return { key: 'running', label: 'Berjalan', tone: 'success' as const }
  if (app.resources.length) return { key: 'stopped', label: 'Berhenti', tone: 'neutral' as const }
  if (app.builds.some((build) => ['queued', 'running'].includes(build.status)))
    return { key: 'setup', label: 'Build berlangsung', tone: 'info' as const }
  if (app.releases.length) return { key: 'setup', label: 'Siap deploy', tone: 'info' as const }
  if (app.builds[0]?.status === 'failed')
    return { key: 'attention', label: 'Build gagal', tone: 'danger' as const }
  return { key: 'setup', label: 'Belum build', tone: 'neutral' as const }
}
const visible = computed(() =>
  applications.value.filter((app) => {
    const query = search.value.trim().toLowerCase()
    return (
      (filter.value === 'all' || state(app).key === filter.value) &&
      (!query ||
        [app.name, app.source, ...app.resources.map((r) => r.nodeName)]
          .join(' ')
          .toLowerCase()
          .includes(query))
    )
  }),
)
async function refresh() {
  await Promise.all([catalogRequest.refresh(), resourceRequest.refresh()])
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <InfrastructurePageHeader
      title="Aplikasi"
      description="Kelola satu aplikasi dari image sampai menjadi layanan pelanggan."
    >
      <UiRefreshButton :action="refresh" :pending="pending" />
      <UiButton @click="showCreate = true"><Plus :size="15" /> Tambah aplikasi</UiButton>
    </InfrastructurePageHeader>
    <InfrastructureToolbar
      v-model="search"
      placeholder="Cari aplikasi atau server…"
      :count="visible.length"
      :total="applications.length"
      unit="aplikasi"
    >
      <UiSelect
        v-model="filter"
        aria-label="Filter kondisi aplikasi"
        size="md"
        :options="[
          { value: 'all', label: 'Semua kondisi' },
          { value: 'running', label: 'Berjalan' },
          { value: 'setup', label: 'Dalam persiapan' },
          { value: 'attention', label: 'Perlu perhatian' },
          { value: 'stopped', label: 'Berhenti' },
        ]"
      />
    </InfrastructureToolbar>
    <div v-if="pending && !catalog" class="space-y-2">
      <UiSkeleton v-for="i in 3" :key="i" height="5rem" />
    </div>
    <UiEmptyState
      v-else-if="error"
      title="Daftar aplikasi belum dapat dimuat"
      description="Coba muat ulang untuk mendapatkan kondisi terbaru."
      ><UiButton variant="secondary" @click="refresh">Coba lagi</UiButton></UiEmptyState
    >
    <UiEmptyState
      v-else-if="!applications.length"
      title="Mulai dari aplikasi pertama"
      description="Hubungkan repository untuk build, atau gunakan image yang sudah tersedia."
      ><UiButton @click="showCreate = true">Tambah aplikasi</UiButton></UiEmptyState
    >
    <UiEmptyState
      v-else-if="!visible.length"
      title="Tidak ada aplikasi yang cocok"
      description="Ubah kata kunci atau filter kondisi."
    />
    <div v-else class="overflow-hidden rounded-md border bg-surface">
      <div
        class="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1rem] gap-4 border-b bg-surface-raised px-4 py-2.5 text-xs text-muted lg:grid"
      >
        <span>Aplikasi</span><span>Kondisi deployment</span><span>Server</span><span>Billing</span
        ><span />
      </div>
      <NuxtLink
        v-for="app in visible"
        :key="app.id"
        :to="`/applications/${app.id}`"
        class="focus-ring grid gap-3 border-b px-4 py-4 last:border-0 hover:bg-surface-raised/50 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1rem] lg:items-center"
      >
        <div class="min-w-0">
          <p class="font-medium text-ink">{{ app.name }}</p>
          <p class="mt-1 truncate text-xs text-muted">{{ app.source }}</p>
          <p
            v-if="
              app.builds[0]?.status === 'failed' &&
              app.resources.some((r) => r.observedState === 'running')
            "
            class="mt-1 text-xs text-warning"
          >
            Build terakhir gagal; deployment aktif tetap berjalan.
          </p>
        </div>
        <div>
          <UiBadge :tone="state(app).tone" dot>{{ state(app).label }}</UiBadge>
          <p class="mt-1 text-xs text-muted">{{ app.resources.length }} deployment</p>
        </div>
        <p class="text-xs text-muted">
          {{ [...new Set(app.resources.map((r) => r.nodeName))].join(', ') || 'Belum dipilih' }}
        </p>
        <p class="text-xs text-muted">
          {{
            app.resources.some((r) => r.serviceId)
              ? `${app.resources.filter((r) => r.serviceId).length} terhubung ke service`
              : 'Belum dihubungkan'
          }}
        </p>
        <ArrowRight :size="15" class="hidden text-muted lg:block" aria-hidden="true" />
      </NuxtLink>
    </div>
    <p class="mt-3 text-xs leading-5 text-muted">
      Kondisi di daftar ini mengikuti deployment aktual. Riwayat build dan release tersedia di dalam
      setiap aplikasi.
    </p>
    <UiDialog
      v-if="showCreate"
      title="Tambah aplikasi"
      description="Pilih sumber aplikasi yang akan Anda kelola."
      @close="showCreate = false"
    >
      <div class="divide-y rounded-md border">
        <NuxtLink
          to="/applications/catalog?create=1"
          class="focus-ring flex items-start gap-3 p-4 hover:bg-surface-raised"
          ><GitBranch :size="18" class="mt-0.5 text-muted" />
          <div>
            <p class="text-sm font-medium">Dari repository</p>
            <p class="mt-1 text-xs text-muted">
              Hubungkan GitHub, build image, lalu deploy release.
            </p>
          </div></NuxtLink
        >
        <NuxtLink
          to="/resources?create=1"
          class="focus-ring flex items-start gap-3 p-4 hover:bg-surface-raised"
          ><Box :size="18" class="mt-0.5 text-muted" />
          <div>
            <p class="text-sm font-medium">Dari container image</p>
            <p class="mt-1 text-xs text-muted">
              Gunakan image lokal atau registry yang sudah tersedia.
            </p>
          </div></NuxtLink
        >
        <NuxtLink
          to="/templates"
          class="focus-ring flex items-start gap-3 p-4 hover:bg-surface-raised"
          ><Layers3 :size="18" class="mt-0.5 text-muted" />
          <div>
            <p class="text-sm font-medium">Dari template</p>
            <p class="mt-1 text-xs text-muted">
              Gunakan konfigurasi aplikasi atau database yang tersimpan.
            </p>
          </div></NuxtLink
        >
      </div>
    </UiDialog>
  </div>
</template>
