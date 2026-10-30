<script setup lang="ts">
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CreditCard,
  Database,
  ExternalLink,
  GitBranch,
  Globe,
  LayoutDashboard,
  KeyRound,
  Package,
  Rocket,
  Server,
  Settings2,
  SquareTerminal,
} from '@lucide/vue'
import type { WorkspaceCatalog, WorkspaceResource } from '~/types/infrastructure-workspace'

definePageMeta({ middleware: 'auth', key: (route) => String(route.params.id) })
const route = useRoute()
const router = useRouter()
const format = useFormat()
const id = String(route.params.id)
const directResourceId = id.startsWith('resource-') ? id.slice('resource-'.length) : null
const tabs = [
  { id: 'overview', label: 'Ringkasan', icon: LayoutDashboard },
  { id: 'build', label: 'Image & build', icon: Package },
  { id: 'deployment', label: 'Deployment', icon: Rocket },
  { id: 'configuration', label: 'Konfigurasi', icon: Settings2 },
  { id: 'environment', label: 'Environment', icon: KeyRound },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'domain', label: 'Domain', icon: Globe },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'activity', label: 'Aktivitas', icon: Activity },
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
    icon: Package,
    value:
      selectedResource.value?.imageReference || releases.value.length
        ? 'Tersedia'
        : 'Belum tersedia',
  },
  {
    tab: 'deployment' as const,
    label: 'Deployment',
    icon: Rocket,
    value: selectedResource.value
      ? synced.value
        ? selectedResource.value.observedState
        : 'Menunggu agent'
      : 'Belum dibuat',
  },
  { tab: 'database' as const, label: 'Database', icon: Database, value: 'Periksa kebutuhan' },
  {
    tab: 'domain' as const,
    label: 'Domain',
    icon: Globe,
    value: selectedResource.value?.routeHostname
      ? selectedResource.value.routeStatus === 'active'
        ? 'Route terpasang'
        : 'Menunggu route'
      : 'Belum tercatat',
  },
  {
    tab: 'billing' as const,
    label: 'Billing',
    icon: CreditCard,
    value: selectedResource.value?.serviceId ? 'Service terhubung' : 'Belum terhubung',
  },
])
useHead(() => ({ title: `${name.value} · Aplikasi · Billing Infra` }))
function selectTab(tab: Tab) {
  return router.replace({ query: { ...route.query, tab } })
}
function selectDeployment(deployment: string) {
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
    <p
      v-if="error && found"
      role="alert"
      class="mb-4 rounded-md border border-warning/25 bg-warning/5 p-3 text-sm text-warning"
    >
      Status terbaru belum dapat dimuat. Data terakhir dan perubahan di editor tetap dipertahankan.
    </p>
    <UiEmptyState
      v-if="error && !found"
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
          >Deployment<UiSelect
            :model-value="selectedResource?.id"
            class="max-w-72"
            size="md"
            :options="
              (resources ?? []).map((resource) => ({
                value: resource.id,
                label: resource.name + ' · ' + resource.nodeName,
              }))
            "
            @change="selectDeployment"
        /></label>
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
      <nav aria-label="Tahapan aplikasi" class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <button
          v-for="(step, index) in steps"
          :key="step.tab"
          type="button"
          class="focus-ring flex min-w-0 items-start gap-3 rounded-md border bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-raised"
          @click="selectTab(step.tab)"
        >
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand"
          >
            <component :is="step.icon" :size="18" :stroke-width="1.7" aria-hidden="true" />
          </span>
          <span class="min-w-0">
            <span class="text-xs text-muted">{{ index + 1 }}. {{ step.label }}</span>
            <span class="mt-1 block break-words text-xs font-medium leading-5 text-ink">{{
              step.value
            }}</span>
          </span>
        </button>
      </nav>
      <div class="grid min-w-0 gap-5 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-6">
        <nav
          aria-label="Bagian aplikasi"
          class="flex min-w-0 gap-1 overflow-x-auto rounded-md border bg-surface p-1.5 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:flex-col lg:self-start lg:overflow-y-auto"
        >
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.id"
            :to="{ query: { ...route.query, tab: tab.id } }"
            :aria-current="activeTab === tab.id ? 'page' : undefined"
            class="focus-ring flex shrink-0 items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm whitespace-nowrap transition-colors lg:whitespace-normal"
            :class="
              activeTab === tab.id
                ? 'border-brand/20 bg-brand/10 font-medium text-brand'
                : 'border-transparent text-muted hover:bg-surface-raised hover:text-ink'
            "
          >
            <component
              :is="tab.icon"
              :size="16"
              :stroke-width="1.7"
              class="shrink-0"
              aria-hidden="true"
            />
            <span>{{ tab.label }}</span>
          </NuxtLink>
        </nav>
        <div class="min-w-0">
          <section v-if="activeTab === 'overview'" class="space-y-4">
            <div class="grid gap-4 xl:grid-cols-2">
              <UiCard
                ><h2 class="flex items-center gap-2 text-sm font-semibold">
                  <Server :size="17" class="shrink-0 text-brand" aria-hidden="true" />
                  Deployment yang dipilih
                </h2>
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
                        {{ selectedResource.observedRevision }} /
                        {{ selectedResource.desiredRevision }}
                      </dd>
                    </div>
                  </dl>
                  <p class="mt-4 break-all border-t pt-3 font-mono text-xs text-muted">
                    {{ selectedResource.imageReference }}
                  </p>
                  <UiButton
                    variant="secondary"
                    size="sm"
                    class="mt-4"
                    @click="selectTab('deployment')"
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
                ><h2 class="flex items-center gap-2 text-sm font-semibold">
                  <GitBranch :size="17" class="shrink-0 text-brand" aria-hidden="true" />
                  Build terakhir
                </h2>
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
                  <p class="mt-2 text-xs text-muted">
                    {{ format.dateTime(latestBuild.createdAt) }}
                  </p>
                  <p v-if="latestBuild.status === 'failed'" class="mt-3 text-sm text-warning">
                    Build ini gagal. Deployment aktif tetap mengikuti release yang tercantum di
                    sebelah kiri.
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
                  ><UiButton variant="secondary" @click="selectTab('configuration')"
                    >Buka konfigurasi</UiButton
                  ></UiEmptyState
                >
              </template>
              <template v-else-if="activeTab === 'deployment' || activeTab === 'configuration'"
                ><InfrastructureResourcesPanel
                  v-if="selectedResource"
                  :resource-id="selectedResource.id"
                  :view="activeTab === 'configuration' ? 'configuration' : 'deployment'"
                  embedded
                  @navigate="selectTab"
                /><UiEmptyState
                  v-else
                  title="Belum ada deployment"
                  description="Buat template dari release, lalu pilih server dan konfigurasi aplikasi."
                  ><UiButton @click="selectTab('build')">Siapkan deployment</UiButton></UiEmptyState
                ></template
              >
              <template v-else-if="activeTab === 'environment'">
                <InfrastructureEnvironmentPanel
                  v-if="selectedResource"
                  :key="selectedResource.id"
                  :resource-id="selectedResource.id"
                  :revision="selectedResource.desiredRevision"
                  :observed-revision="selectedResource.observedRevision"
                  @saved="refresh"
                  @activity="selectTab('activity')"
                />
                <UiEmptyState
                  v-else
                  title="Belum ada deployment"
                  description="Buat deployment terlebih dahulu untuk mengatur environment runtime aplikasi."
                >
                  <UiButton @click="selectTab('build')">Siapkan deployment</UiButton>
                </UiEmptyState>
              </template>
              <template v-else-if="activeTab === 'database'">
                <InfrastructureDatabasePanel
                  v-if="selectedResource"
                  :resource-id="selectedResource.id"
                  :node-id="selectedResource.nodeId"
                  embedded
                />
                <UiEmptyState
                  v-else
                  title="Database dapat disiapkan saat deploy"
                  description="Pilih kebutuhan database pada form deployment. Setelah resource dibuat, koneksi database dan backup dapat dikelola di sini."
                >
                  <UiButton @click="selectTab('build')">Buka persiapan deployment</UiButton>
                </UiEmptyState>
              </template>
              <template v-else-if="activeTab === 'domain'">
                <InfrastructureApplicationDomainsPanel
                  v-if="selectedResource"
                  :key="selectedResource.id"
                  :resource-id="selectedResource.id"
                  @saved="refresh"
                  @activity="selectTab('activity')"
                />
                <UiEmptyState
                  v-else
                  title="Belum ada deployment"
                  description="Siapkan deployment terlebih dahulu untuk menghubungkan domain ke tunnel."
                  ><UiButton @click="selectTab('build')">Siapkan deployment</UiButton></UiEmptyState
                >
              </template>
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
        </div>
      </div>
    </template>
    <DockerShellDialog
      v-if="shellResource"
      :resource="shellResource"
      @close="shellResource = null"
    />
  </div>
</template>
