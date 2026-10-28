<script setup lang="ts">
import { ArrowLeft, ArrowRight, ExternalLink, GitBranch, SquareTerminal } from '@lucide/vue'
import type { WorkspaceCatalog, WorkspaceResource } from '~/types/infrastructure-workspace'

definePageMeta({ middleware: 'auth', key: (route) => String(route.params.id) })
const route = useRoute()
const router = useRouter()
const format = useFormat()
const id = String(route.params.id)
const directResourceId = id.startsWith('resource-') ? id.slice('resource-'.length) : null
const tabs = [
  { id: 'overview', label: 'Ringkasan' },
  { id: 'build', label: 'Image & build' },
  { id: 'deployment', label: 'Deployment & konfigurasi' },
  { id: 'database', label: 'Database' },
  { id: 'domain', label: 'Domain' },
  { id: 'billing', label: 'Billing' },
  { id: 'activity', label: 'Aktivitas' },
] as const
type Tab = (typeof tabs)[number]['id']
const activeTab = computed<Tab>(
  () => tabs.find((tab) => tab.id === route.query.tab)?.id ?? 'overview',
)
const [catalogRequest, resourceRequest] = await Promise.all([
  useFetch<{ data: WorkspaceCatalog }>('/api/infrastructure/applications', {
    key: 'infrastructure-catalog',
  }),
  useFetch<{ data: WorkspaceResource[] }>('/api/infrastructure/resources', {
    key: 'infrastructure-resources',
  }),
])
const catalog = computed(() => catalogRequest.data.value?.data)
const allResources = computed(() => resourceRequest.data.value?.data ?? [])
const directResource = computed(() =>
  allResources.value.find(
    (resource) => resource.id === directResourceId && resource.kind === 'application',
  ),
)
const application = computed(() =>
  catalog.value?.applications.find(
    (app) => app.id === (directResourceId ? directResource.value?.applicationId : id),
  ),
)
const resources = computed(() =>
  allResources.value.filter(
    (resource) =>
      resource.kind === 'application' &&
      (application.value
        ? resource.applicationId === application.value.id
        : resource.id === directResourceId),
  ),
)
const selectedResource = computed(
  () =>
    resources.value.find((resource) => resource.id === route.query.deployment) ??
    resources.value.find((resource) => resource.id === directResourceId) ??
    resources.value[0],
)
const name = computed(() => application.value?.name ?? directResource.value?.name ?? 'Aplikasi')
const found = computed(() => Boolean(application.value || directResource.value))
const error = computed(() => catalogRequest.error.value || resourceRequest.error.value)
const pending = computed(
  () => catalogRequest.status.value === 'pending' || resourceRequest.status.value === 'pending',
)
const releases = computed(() =>
  (catalog.value?.releases ?? [])
    .filter((release) => release.applicationId === application.value?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
)
const builds = computed(() =>
  (catalog.value?.builds ?? [])
    .filter((build) => build.applicationId === application.value?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
)
const activeRelease = computed(() =>
  releases.value.find((release) => release.id === selectedResource.value?.releaseId),
)
const latestBuild = computed(() => builds.value[0])
const accessUrl = computed(() => {
  const resource = selectedResource.value
  if (!resource) return null
  if (resource.routeHostname && resource.routeStatus === 'active')
    return `https://${resource.routeHostname}`
  return catalog.value?.resources.find((item) => item.id === resource.id)?.accessUrl ?? null
})
const shellAvailable = computed(
  () =>
    catalog.value?.resources.find((item) => item.id === selectedResource.value?.id)
      ?.shellAvailable ?? false,
)
const shellResource = ref<{ id: string; name: string } | null>(null)
const templateRevision = ref(0)
const synced = computed(() =>
  Boolean(
    selectedResource.value &&
    selectedResource.value.desiredState === selectedResource.value.observedState &&
    selectedResource.value.desiredRevision === selectedResource.value.observedRevision,
  ),
)
const runtimeTone = computed(() =>
  selectedResource.value?.observedState === 'running' && synced.value
    ? ('success' as const)
    : ['failed', 'degraded'].includes(selectedResource.value?.observedState ?? '')
      ? ('danger' as const)
      : ('warning' as const),
)
const steps = computed(() => [
  {
    tab: 'build' as const,
    label: 'Image',
    value:
      selectedResource.value?.imageReference || releases.value.length
        ? 'Tersedia'
        : 'Belum tersedia',
  },
  {
    tab: 'deployment' as const,
    label: 'Deployment',
    value: selectedResource.value
      ? synced.value
        ? selectedResource.value.observedState
        : 'Menunggu agent'
      : 'Belum dibuat',
  },
  { tab: 'database' as const, label: 'Database', value: 'Periksa kebutuhan' },
  {
    tab: 'domain' as const,
    label: 'Domain',
    value: selectedResource.value?.routeHostname
      ? selectedResource.value.routeStatus === 'active'
        ? 'Route terpasang'
        : 'Menunggu route'
      : 'Belum tercatat',
  },
  {
    tab: 'billing' as const,
    label: 'Billing',
    value: selectedResource.value?.serviceId ? 'Service terhubung' : 'Belum terhubung',
  },
])
useHead(() => ({ title: `${name.value} · Aplikasi · Billing Infra` }))
function selectTab(tab: Tab) {
  return router.replace({ query: { ...route.query, tab } })
}
function selectDeployment(event: Event) {
  const deployment = (event.target as HTMLSelectElement).value
  return router.replace({ query: { ...route.query, deployment } })
}
async function onDeployed(resourceId?: string) {
  await refresh()
  await router.replace({
    query: { ...route.query, tab: 'activity', ...(resourceId ? { deployment: resourceId } : {}) },
  })
}
let refreshing = false
async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
    await Promise.all([catalogRequest.refresh(), resourceRequest.refresh()])
  } finally {
    refreshing = false
  }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, 10_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <NuxtLink
      to="/applications"
      class="focus-ring mb-4 inline-flex items-center gap-2 rounded text-xs text-muted hover:text-ink"
      ><ArrowLeft :size="14" /> Semua aplikasi</NuxtLink
    >
    <InfrastructurePageHeader
      :title="name"
      :description="application ? application.repositoryUrl : 'Aplikasi dari container image'"
    >
      <UiRefreshButton :action="refresh" :pending="pending" />
      <UiButton
        v-if="selectedResource && shellAvailable"
        variant="secondary"
        @click="shellResource = { id: selectedResource.id, name: selectedResource.name }"
        ><SquareTerminal :size="15" /> Terminal</UiButton
      >
      <a
        v-if="accessUrl"
        :href="accessUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="focus-ring inline-flex h-10 items-center gap-2 rounded-md border bg-surface px-4 text-sm font-medium hover:bg-surface-raised"
        ><ExternalLink :size="15" /> Buka aplikasi</a
      >
    </InfrastructurePageHeader>
    <UiEmptyState
      v-if="error"
      title="Aplikasi belum dapat dimuat"
      description="Coba muat ulang untuk mendapatkan kondisi terbaru."
      ><UiButton variant="secondary" @click="refresh">Coba lagi</UiButton></UiEmptyState
    >
    <UiEmptyState
      v-else-if="!found"
      title="Aplikasi tidak ditemukan"
      description="Aplikasi mungkin sudah dihapus atau belum terdaftar."
      ><NuxtLink to="/applications" class="text-sm text-brand hover:underline"
        >Kembali ke daftar aplikasi</NuxtLink
      ></UiEmptyState
    >
    <template v-else>
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <label v-if="resources.length" class="flex min-w-0 items-center gap-2 text-xs text-muted"
          >Deployment<select
            :value="selectedResource?.id"
            class="focus-ring h-9 max-w-72 rounded-md border bg-surface px-3 text-sm text-ink"
            @change="selectDeployment"
          >
            <option v-for="resource in resources" :key="resource.id" :value="resource.id">
              {{ resource.name }} · {{ resource.nodeName }}
            </option>
          </select></label
        >
        <UiBadge v-if="selectedResource" :tone="runtimeTone" dot>{{
          synced ? selectedResource.observedState : 'Menunggu sinkronisasi'
        }}</UiBadge>
        <span v-if="selectedResource" class="text-xs text-muted"
          >Terakhir dilaporkan {{ format.dateTime(selectedResource.lastObservedAt) }}</span
        >
        <UiButton
          v-if="application"
          variant="ghost"
          size="sm"
          class="ml-auto"
          @click="selectTab('build')"
          >{{ resources.length ? 'Tambah deployment' : 'Siapkan deployment' }}
          <ArrowRight :size="13"
        /></UiButton>
      </div>
      <nav
        aria-label="Tahapan aplikasi"
        class="mb-5 grid grid-cols-2 overflow-hidden rounded-md border bg-surface sm:grid-cols-5"
      >
        <button
          v-for="(step, index) in steps"
          :key="step.tab"
          type="button"
          class="focus-ring border-r px-3 py-3 text-left last:border-r-0 hover:bg-surface-raised"
          @click="selectTab(step.tab)"
        >
          <span class="text-xs text-muted">{{ index + 1 }}. {{ step.label }}</span
          ><span class="mt-1 block text-xs font-medium text-ink">{{ step.value }}</span>
        </button>
      </nav>
      <nav aria-label="Bagian aplikasi" class="mb-5 flex gap-1 overflow-x-auto border-b">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.id"
          :to="{ query: { ...route.query, tab: tab.id } }"
          :aria-current="activeTab === tab.id ? 'page' : undefined"
          class="focus-ring shrink-0 border-b-2 px-3 py-3 text-sm"
          :class="
            activeTab === tab.id
              ? 'border-brand font-medium text-ink'
              : 'border-transparent text-muted hover:text-ink'
          "
          >{{ tab.label }}</NuxtLink
        >
      </nav>
      <section v-if="activeTab === 'overview'" class="space-y-4">
        <div class="grid gap-4 lg:grid-cols-2">
          <UiCard
            ><h2 class="text-sm font-semibold">Deployment yang dipilih</h2>
            <template v-if="selectedResource"
              ><dl class="mt-4 space-y-3 text-sm">
                <div class="flex justify-between gap-3">
                  <dt class="text-muted">Deployment</dt>
                  <dd>{{ selectedResource.name }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted">Server</dt>
                  <dd>{{ selectedResource.nodeName }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted">{{ synced ? 'Release aktif' : 'Release target' }}</dt>
                  <dd class="text-right">{{ activeRelease?.version || 'Image langsung' }}</dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted">Commit</dt>
                  <dd class="font-mono text-xs">
                    {{ activeRelease?.commitSha.slice(0, 12) || 'Tidak tersedia' }}
                  </dd>
                </div>
                <div class="flex justify-between gap-3">
                  <dt class="text-muted">Revisi aktual / target</dt>
                  <dd class="font-mono">
                    {{ selectedResource.observedRevision }} / {{ selectedResource.desiredRevision }}
                  </dd>
                </div>
              </dl>
              <p class="mt-4 break-all border-t pt-3 font-mono text-xs text-muted">
                {{ selectedResource.imageReference }}
              </p>
              <UiButton variant="secondary" size="sm" class="mt-4" @click="selectTab('deployment')"
                >Kelola deployment</UiButton
              ></template
            ><template v-else
              ><p class="mt-3 text-sm leading-6 text-muted">
                Belum ada deployment. Siapkan release, pilih konfigurasi aplikasi dan kebutuhan
                database, lalu deploy ke server.
              </p>
              <UiButton size="sm" class="mt-4" @click="selectTab('build')"
                >Mulai dari image</UiButton
              ></template
            ></UiCard
          >
          <UiCard
            ><h2 class="text-sm font-semibold">Build terakhir</h2>
            <template v-if="latestBuild"
              ><div class="mt-4 flex items-center justify-between gap-3">
                <p class="break-all font-mono text-sm">{{ latestBuild.version }}</p>
                <UiBadge
                  :tone="
                    latestBuild.status === 'succeeded'
                      ? 'success'
                      : latestBuild.status === 'failed'
                        ? 'danger'
                        : 'warning'
                  "
                  >{{ latestBuild.status }}</UiBadge
                >
              </div>
              <p class="mt-2 text-xs text-muted">{{ format.dateTime(latestBuild.createdAt) }}</p>
              <p v-if="latestBuild.status === 'failed'" class="mt-3 text-sm text-warning">
                Build ini gagal. Deployment aktif tetap mengikuti release yang tercantum di sebelah
                kiri.
              </p>
              <p
                v-else-if="
                  latestBuild.releaseId && latestBuild.releaseId !== selectedResource?.releaseId
                "
                class="mt-3 text-sm text-muted"
              >
                Image tersedia dan belum digunakan oleh deployment yang dipilih.
              </p></template
            >
            <p v-else class="mt-4 text-sm text-muted">
              {{
                application
                  ? 'Belum ada riwayat build.'
                  : 'Aplikasi ini menggunakan image yang sudah tersedia.'
              }}
            </p>
            <UiButton
              v-if="application"
              variant="secondary"
              size="sm"
              class="mt-4"
              @click="selectTab('build')"
              ><GitBranch :size="13" /> Build &amp; release</UiButton
            ></UiCard
          >
        </div>
        <UiCard
          ><h2 class="text-sm font-semibold">Sebelum menjadi layanan pelanggan</h2>
          <div class="mt-3 grid gap-4 text-sm md:grid-cols-3">
            <div>
              <p class="font-medium">1. Konfigurasi &amp; database</p>
              <p class="mt-1 leading-6 text-muted">
                Pastikan environment, storage, dan koneksi database sesuai kebutuhan aplikasi.
              </p>
            </div>
            <div>
              <p class="font-medium">2. Akses aplikasi</p>
              <p class="mt-1 leading-6 text-muted">
                Periksa healthcheck dan akses domain. Container running atau route aktif belum
                membuktikan login/API aplikasi berfungsi.
              </p>
            </div>
            <div>
              <p class="font-medium">3. Hubungan billing</p>
              <p class="mt-1 leading-6 text-muted">
                Periksa customer, paket, serta tanggal aktivasi layanan di bagian Billing.
              </p>
            </div>
          </div></UiCard
        >
      </section>
      <Suspense v-else :key="`${activeTab}:${selectedResource?.id ?? id}`">
        <div>
          <template v-if="activeTab === 'build'">
            <template v-if="application"
              ><InfrastructureSourcePanel
                :application-id="application.id"
                embedded
                @template-created="templateRevision++" />
              <div class="mt-6 border-t pt-6">
                <InfrastructureTemplatesPanel
                  :key="templateRevision"
                  :application-id="application.id"
                  embedded
                  @deployed="onDeployed"
                /></div
            ></template>
            <UiEmptyState
              v-else
              title="Deployment dari image langsung"
              description="Image aplikasi ini dikelola melalui konfigurasi deployment."
              ><UiButton variant="secondary" @click="selectTab('deployment')"
                >Buka konfigurasi</UiButton
              ></UiEmptyState
            >
          </template>
          <template v-else-if="activeTab === 'deployment'"
            ><InfrastructureResourcesPanel
              v-if="selectedResource"
              :resource-id="selectedResource.id"
              embedded
            /><UiEmptyState
              v-else
              title="Belum ada deployment"
              description="Buat template dari release, lalu pilih server dan konfigurasi aplikasi."
              ><UiButton @click="selectTab('build')">Siapkan deployment</UiButton></UiEmptyState
            ></template
          >
          <template v-else-if="activeTab === 'database'"
            ><template v-if="selectedResource"
              ><p class="mb-4 text-sm leading-6 text-muted">
                Database terkelola yang terhubung ke {{ selectedResource.name }}. Database eksternal
                tetap dikonfigurasi melalui environment aplikasi.
              </p>
              <InfrastructureDatabasePanel
                :resource-id="selectedResource.id"
                :node-id="selectedResource.nodeId"
                embedded
              /><NuxtLink
                to="/backups"
                class="focus-ring mt-4 inline-block rounded text-sm text-brand hover:underline"
                >Kelola jadwal backup →</NuxtLink
              ></template
            ><UiEmptyState
              v-else
              title="Database dapat disiapkan saat deploy"
              description="Pilih kebutuhan database pada form deployment. Setelah resource dibuat, koneksi database dan backup dapat dikelola di sini."
              ><UiButton @click="selectTab('build')"
                >Buka persiapan deployment</UiButton
              ></UiEmptyState
            ></template
          >
          <template v-else-if="activeTab === 'domain'"
            ><UiCard class="mb-5"
              ><h2 class="text-sm font-semibold">Akses deployment ini</h2>
              <p class="mt-2 text-sm">
                {{
                  selectedResource?.routeHostname || 'Belum ada domain yang tercatat pada resource.'
                }}
              </p>
              <p class="mt-2 text-xs leading-5 text-muted">
                {{
                  selectedResource?.routeHostname
                    ? `Status route: ${selectedResource.routeStatus}. Akses publik perlu diperiksa melalui domain.`
                    : 'Jika domain dipasang langsung melalui tunnel ke host port, hubungan tersebut belum tercatat sebagai route resource di BillEngine.'
                }}
              </p>
              <p
                v-if="selectedResource?.desiredSpec.ports?.length"
                class="mt-3 font-mono text-xs text-muted"
              >
                {{
                  selectedResource.desiredSpec.ports
                    .map(
                      (port) =>
                        `${port.hostPort ? `Host ${port.hostPort} → ` : ''}container ${port.containerPort}/${port.protocol}`,
                    )
                    .join(', ')
                }}
              </p></UiCard
            >
            <p class="mb-4 text-xs text-muted">
              Tunnel merupakan koneksi bersama. Pilih tunnel dan pastikan hostname serta origin
              mengarah ke deployment ini.
            </p>
            <InfrastructureTunnelsPanel
              embedded
              :hostname="selectedResource?.routeHostname ?? undefined"
          /></template>
          <template v-else-if="activeTab === 'billing'"
            ><InfrastructureBillingPanel
              v-if="selectedResource"
              :resource-id="selectedResource.id" /><UiEmptyState
              v-else
              title="Belum ada deployment untuk dihubungkan"
              description="Siapkan deployment dan akses aplikasi sebelum menghubungkannya ke layanan pelanggan."
          /></template>
          <template v-else-if="activeTab === 'activity'"
            ><InfrastructureOperationsPanel
              v-if="selectedResource"
              :resource-id="selectedResource.id"
              embedded /><UiEmptyState
              v-else
              title="Belum ada operasi deployment"
              description="Riwayat build tersedia di bagian Image & build."
          /></template>
        </div>
        <template #fallback
          ><div class="space-y-3"><UiSkeleton height="3rem" /><UiSkeleton height="12rem" /></div
        ></template>
      </Suspense>
    </template>
    <DockerShellDialog
      v-if="shellResource"
      :resource="shellResource"
      @close="shellResource = null"
    />
  </div>
</template>
