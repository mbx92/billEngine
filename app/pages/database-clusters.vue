<script setup lang="ts">
import {
  CheckCircle2,
  Copy,
  Database,
  Eye,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
} from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Database Clusters · Billing Infra' })

type ClusterStatus = 'validating' | 'active' | 'degraded' | 'offline' | 'maintenance' | 'retired'

interface NativeDatabaseCluster {
  id: string
  name: string
  engine: 'postgresql'
  mode: 'standalone' | 'replicated'
  status: ClusterStatus
  isActive: boolean
  adminDatabase: string
  provisionerUsername: string
  defaultConnectionLimit: number
  lastError: string | null
  activatedAt: string | null
  primaryResourceId: string
  primaryResourceName: string
  resourceState: string
  nodeId: string
  nodeName: string
  nodeStatus: string
  agentVersion: string | null
}

interface PostgreSQLCandidate {
  id: string
  name: string
  observedState: string
  imageReference: string | null
  desiredSpec: {
    environment?: Record<string, string>
    ports?: Array<{ containerPort: number; hostPort?: number; protocol: string }>
  }
  nodeId: string
  nodeName: string
  nodeStatus: string
  agentVersion: string | null
}

interface ServiceDatabaseAllocation {
  id: string
  serviceId: string
  serviceNumber: string
  serviceName: string
  customerName: string
  databaseClusterId: string
  clusterName: string
  applicationResourceId: string
  applicationName: string
  nodeName: string
  databaseName: string
  roleName: string
  environmentKey: string
  status: 'provisioning' | 'active' | 'failed' | 'pending_deletion' | 'deleted'
  lastError: string | null
  provisioningOperationId: string | null
  redeployOperationId: string | null
  provisionedAt: string | null
  createdAt: string
  updatedAt: string
}

interface EligibleService {
  id: string
  serviceNumber: string
  name: string
  customerId: string
  customerName: string
  status: string
}

interface EligibleApplication {
  id: string
  name: string
  customerId: string | null
  nodeId: string
  nodeName: string
  observedState: string
}

interface RevealedDatabaseCredential {
  id: string
  serviceId: string
  clusterName: string
  applicationName: string
  databaseName: string
  roleName: string
  environmentKey: string
  password: string
  connectionUri: string
}

interface NativeDatabaseClusterOverview {
  clusters: NativeDatabaseCluster[]
  candidates: PostgreSQLCandidate[]
  allocations: ServiceDatabaseAllocation[]
  eligibleServices: EligibleService[]
  eligibleApplications: EligibleApplication[]
}

const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<{ data: NativeDatabaseClusterOverview }>('/api/infrastructure/database-clusters')
const overview = computed(() => response.value?.data)
const showActivation = ref(false)
const showProvisioning = ref(false)
const activating = ref(false)
const provisioning = ref(false)
const revealing = ref(false)
const pendingReveal = ref<ServiceDatabaseAllocation | null>(null)
const pendingRotation = ref<ServiceDatabaseAllocation | null>(null)
const revealedCredential = ref<RevealedDatabaseCredential | null>(null)
const busyAllocationIds = ref<string[]>([])
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
const form = reactive({ resourceId: '', name: '', defaultConnectionLimit: 20 })
const provisionForm = reactive({
  clusterId: '',
  serviceId: '',
  applicationResourceId: '',
  environmentKey: 'DATABASE_URL',
})
let refreshTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  refreshTimer = setInterval(() => {
    if (
      overview.value?.clusters.some((cluster) => cluster.status === 'validating') ||
      overview.value?.allocations.some((allocation) => allocation.status === 'provisioning')
    ) {
      void refresh()
    }
  }, 4000)
})

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

const selectedCandidate = computed(() =>
  overview.value?.candidates.find((candidate) => candidate.id === form.resourceId),
)

const selectedProvisionCluster = computed(() =>
  overview.value?.clusters.find((cluster) => cluster.id === provisionForm.clusterId),
)
const selectedProvisionService = computed(() =>
  overview.value?.eligibleServices.find((service) => service.id === provisionForm.serviceId),
)
const eligibleProvisionApplications = computed(() => {
  const cluster = selectedProvisionCluster.value
  const service = selectedProvisionService.value
  if (!cluster) return []
  return (overview.value?.eligibleApplications ?? []).filter(
    (application) =>
      application.nodeId === cluster.nodeId &&
      (!service || !application.customerId || application.customerId === service.customerId),
  )
})

watch([selectedProvisionCluster, selectedProvisionService], () => {
  if (
    !eligibleProvisionApplications.value.some(
      (item) => item.id === provisionForm.applicationResourceId,
    )
  ) {
    provisionForm.applicationResourceId = eligibleProvisionApplications.value[0]?.id ?? ''
  }
})

watch(
  () => form.resourceId,
  () => {
    if (
      !form.name ||
      overview.value?.candidates.some((candidate) => `${candidate.name}-cluster` === form.name)
    ) {
      form.name = selectedCandidate.value ? `${selectedCandidate.value.name}-cluster` : ''
    }
  },
)

function openActivation(candidate?: PostgreSQLCandidate) {
  actionError.value = null
  form.resourceId = candidate?.id ?? overview.value?.candidates[0]?.id ?? ''
  form.name = candidate ? `${candidate.name}-cluster` : ''
  form.defaultConnectionLimit = 20
  showActivation.value = true
}

async function activateCluster() {
  activating.value = true
  actionMessage.value = null
  actionError.value = null
  try {
    await $fetch('/api/infrastructure/database-clusters', {
      method: 'POST',
      headers: { 'Idempotency-Key': `database-cluster:${crypto.randomUUID()}` },
      body: {
        resourceId: form.resourceId,
        name: form.name,
        defaultConnectionLimit: Number(form.defaultConnectionLimit),
      },
    })
    showActivation.value = false
    actionMessage.value = `Preflight cluster ${form.name} sedang dijalankan oleh agent.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Database cluster gagal diaktifkan.')
  } finally {
    activating.value = false
  }
}

function openProvisioning(cluster: NativeDatabaseCluster) {
  actionError.value = null
  Object.assign(provisionForm, {
    clusterId: cluster.id,
    serviceId: overview.value?.eligibleServices[0]?.id ?? '',
    applicationResourceId: '',
    environmentKey: 'DATABASE_URL',
  })
  showProvisioning.value = true
}

async function provisionDatabase() {
  provisioning.value = true
  actionMessage.value = null
  actionError.value = null
  try {
    await $fetch(`/api/infrastructure/database-clusters/${provisionForm.clusterId}/databases`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `service-database:${crypto.randomUUID()}` },
      body: {
        serviceId: provisionForm.serviceId,
        applicationResourceId: provisionForm.applicationResourceId,
        environmentKey: provisionForm.environmentKey,
      },
    })
    showProvisioning.value = false
    actionMessage.value =
      'Database dan role sedang disiapkan oleh agent. Aplikasi akan diredeploy otomatis.'
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Provisioning database gagal dijadwalkan.')
  } finally {
    provisioning.value = false
  }
}

async function revealCredential() {
  if (!pendingReveal.value) return
  revealing.value = true
  actionError.value = null
  try {
    const response = await $fetch<{ data: RevealedDatabaseCredential }>(
      `/api/infrastructure/database-clusters/databases/${pendingReveal.value.id}/reveal`,
      { method: 'POST' },
    )
    revealedCredential.value = response.data
    pendingReveal.value = null
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Credential database gagal ditampilkan.')
    pendingReveal.value = null
  } finally {
    revealing.value = false
  }
}

async function runAllocationAction(
  allocation: ServiceDatabaseAllocation,
  action: 'retry' | 'rotate',
) {
  busyAllocationIds.value.push(allocation.id)
  actionError.value = null
  actionMessage.value = null
  try {
    await $fetch(`/api/infrastructure/database-clusters/databases/${allocation.id}/${action}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `service-database-${action}:${crypto.randomUUID()}` },
    })
    pendingRotation.value = null
    actionMessage.value =
      action === 'rotate'
        ? 'Rotasi credential dijadwalkan. Aplikasi akan diredeploy otomatis.'
        : 'Retry provisioning database dijadwalkan.'
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, `Operasi ${action} database gagal dijadwalkan.`)
    pendingRotation.value = null
  } finally {
    busyAllocationIds.value = busyAllocationIds.value.filter((id) => id !== allocation.id)
  }
}

async function copyValue(value: string) {
  await navigator.clipboard.writeText(value)
  actionMessage.value = 'Nilai disalin ke clipboard.'
}

function supportsActivation(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 4
}

function supportsProvisioning(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 5
}

function clusterReadyForProvisioning(cluster: NativeDatabaseCluster) {
  return (
    cluster.isActive &&
    cluster.status === 'active' &&
    cluster.resourceState === 'running' &&
    ['online', 'degraded'].includes(cluster.nodeStatus) &&
    supportsProvisioning(cluster.agentVersion)
  )
}

function allocationTone(allocationStatus: ServiceDatabaseAllocation['status']) {
  if (allocationStatus === 'active') return 'success' as const
  if (allocationStatus === 'provisioning') return 'warning' as const
  if (allocationStatus === 'failed') return 'danger' as const
  return 'neutral' as const
}

function candidateReady(candidate: PostgreSQLCandidate) {
  return (
    candidate.observedState === 'running' &&
    ['online', 'degraded'].includes(candidate.nodeStatus) &&
    supportsActivation(candidate.agentVersion)
  )
}

function statusTone(clusterStatus: ClusterStatus) {
  if (clusterStatus === 'active') return 'success' as const
  if (clusterStatus === 'validating' || clusterStatus === 'degraded') return 'warning' as const
  if (clusterStatus === 'offline') return 'danger' as const
  return 'neutral' as const
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / PostgreSQL
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Native Database Clusters</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Promosikan PostgreSQL yang dikelola OC Agent menjadi shared cluster. Database metadata
          Billing tidak menjadi kandidat dan tidak dikelola dari halaman ini.
        </p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" /> Refresh
        </UiButton>
        <UiButton :disabled="!overview?.candidates.some(candidateReady)" @click="openActivation()">
          <Plus :size="15" /> Activate cluster
        </UiButton>
      </div>
    </header>

    <p
      v-if="actionMessage"
      class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
      role="status"
    >
      {{ actionMessage }}
    </p>
    <p
      v-if="actionError && !showActivation"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <div v-if="status === 'pending' && !overview" class="grid gap-4 md:grid-cols-2">
      <UiSkeleton v-for="item in 2" :key="item" height="13rem" />
    </div>
    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Database cluster gagal dimuat"
        description="Pastikan migration database terbaru sudah diterapkan."
      />
    </UiCard>
    <template v-else>
      <section>
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-ink">Active clusters</h2>
            <p class="mt-1 text-xs text-muted">Mode awal adalah standalone dengan satu primary.</p>
          </div>
          <UiBadge tone="neutral">{{ overview?.clusters.length ?? 0 }} cluster</UiBadge>
        </div>

        <UiCard v-if="!overview?.clusters.length" :padded="false">
          <UiEmptyState
            title="Belum ada native database cluster"
            description="Deploy PostgreSQL dari Templates, pastikan agent terbaru, lalu aktifkan resource tersebut sebagai cluster."
          />
        </UiCard>
        <div v-else class="grid gap-4 lg:grid-cols-2">
          <UiCard v-for="cluster in overview.clusters" :key="cluster.id">
            <div class="flex items-start justify-between gap-4">
              <div class="flex min-w-0 items-start gap-3">
                <span class="rounded-md bg-brand/10 p-2 text-brand"><Database :size="18" /></span>
                <div class="min-w-0">
                  <h3 class="truncate text-sm font-semibold text-ink">{{ cluster.name }}</h3>
                  <p class="mt-1 font-mono text-xs text-muted">
                    {{ cluster.primaryResourceName }} · {{ cluster.nodeName }}
                  </p>
                </div>
              </div>
              <div class="flex flex-wrap justify-end gap-1.5">
                <UiBadge :tone="statusTone(cluster.status)" dot>{{ cluster.status }}</UiBadge>
                <UiBadge tone="info">{{ cluster.mode }}</UiBadge>
              </div>
            </div>

            <dl class="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
              <div>
                <dt class="text-muted">Admin database</dt>
                <dd class="mt-1 font-mono text-ink">{{ cluster.adminDatabase }}</dd>
              </div>
              <div>
                <dt class="text-muted">Provisioner</dt>
                <dd class="mt-1 font-mono text-ink">{{ cluster.provisionerUsername }}</dd>
              </div>
              <div>
                <dt class="text-muted">Resource / node</dt>
                <dd class="mt-1 text-ink">
                  {{ cluster.resourceState }} / {{ cluster.nodeStatus }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Connection limit</dt>
                <dd class="mt-1 font-mono text-ink">{{ cluster.defaultConnectionLimit }}</dd>
              </div>
            </dl>
            <p
              v-if="cluster.lastError"
              class="mt-4 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {{ cluster.lastError }}
            </p>
            <p
              v-if="cluster.isActive && !supportsProvisioning(cluster.agentVersion)"
              class="mt-3 text-xs text-warning"
            >
              Upgrade OC Agent ke 0.5.0 untuk provisioning database per service.
            </p>
            <UiButton
              class="mt-4 w-full"
              :disabled="
                !clusterReadyForProvisioning(cluster) ||
                !overview?.eligibleServices.length ||
                !overview?.eligibleApplications.some(
                  (application) => application.nodeId === cluster.nodeId,
                )
              "
              @click="openProvisioning(cluster)"
            >
              <KeyRound :size="15" /> Provision service database
            </UiButton>
          </UiCard>
        </div>
      </section>

      <section class="mt-8">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-ink">Service databases</h2>
            <p class="mt-1 text-xs text-muted">
              Setiap service memakai database, role, dan credential terpisah.
            </p>
          </div>
          <UiBadge tone="neutral">{{ overview?.allocations.length ?? 0 }} allocation</UiBadge>
        </div>

        <UiCard v-if="!overview?.allocations.length" :padded="false">
          <UiEmptyState
            title="Belum ada database service"
            description="Aktifkan cluster dan pilih Provision service database pada cluster yang siap."
          />
        </UiCard>
        <div v-else class="grid gap-4 lg:grid-cols-2">
          <UiCard v-for="allocation in overview.allocations" :key="allocation.id">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="font-mono text-[11px] font-semibold text-brand">
                  {{ allocation.serviceNumber }} · {{ allocation.customerName }}
                </p>
                <h3 class="mt-1 truncate text-sm font-semibold text-ink">
                  {{ allocation.serviceName }}
                </h3>
                <p class="mt-1 text-xs text-muted">
                  {{ allocation.applicationName }} · {{ allocation.clusterName }}
                </p>
              </div>
              <UiBadge :tone="allocationTone(allocation.status)" dot>
                {{ allocation.status }}
              </UiBadge>
            </div>
            <dl class="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
              <div>
                <dt class="text-muted">Database</dt>
                <dd class="mt-1 truncate font-mono text-ink">{{ allocation.databaseName }}</dd>
              </div>
              <div>
                <dt class="text-muted">Role</dt>
                <dd class="mt-1 truncate font-mono text-ink">{{ allocation.roleName }}</dd>
              </div>
              <div>
                <dt class="text-muted">Application secret</dt>
                <dd class="mt-1 font-mono text-ink">{{ allocation.environmentKey }}_FILE</dd>
              </div>
              <div>
                <dt class="text-muted">Node</dt>
                <dd class="mt-1 text-ink">{{ allocation.nodeName }}</dd>
              </div>
            </dl>
            <p
              v-if="allocation.lastError"
              class="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {{ allocation.lastError }}
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <UiButton
                v-if="allocation.status === 'failed'"
                variant="secondary"
                class="flex-1"
                :disabled="busyAllocationIds.includes(allocation.id)"
                @click="runAllocationAction(allocation, 'retry')"
              >
                <RefreshCw :size="15" /> Retry
              </UiButton>
              <template v-if="allocation.status === 'active'">
                <UiButton variant="secondary" class="flex-1" @click="pendingReveal = allocation">
                  <Eye :size="15" /> Reveal
                </UiButton>
                <UiButton variant="secondary" class="flex-1" @click="pendingRotation = allocation">
                  <RotateCw :size="15" /> Rotate
                </UiButton>
              </template>
            </div>
          </UiCard>
        </div>
      </section>

      <section class="mt-8">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-ink">Eligible PostgreSQL resources</h2>
            <p class="mt-1 text-xs text-muted">
              Hanya PostgreSQL dari Template native; database Billing tidak ditampilkan.
            </p>
          </div>
          <UiBadge tone="neutral">{{ overview?.candidates.length ?? 0 }} candidate</UiBadge>
        </div>

        <UiCard v-if="!overview?.candidates.length" :padded="false">
          <UiEmptyState
            title="Tidak ada kandidat"
            description="Semua PostgreSQL sudah menjadi cluster atau belum ada resource PostgreSQL native."
          />
        </UiCard>
        <div v-else class="grid gap-4 lg:grid-cols-2">
          <UiCard v-for="candidate in overview.candidates" :key="candidate.id">
            <div class="flex items-start justify-between gap-4">
              <div class="flex min-w-0 items-start gap-3">
                <span class="rounded-md bg-info/10 p-2 text-info"><Server :size="18" /></span>
                <div class="min-w-0">
                  <h3 class="truncate text-sm font-semibold text-ink">{{ candidate.name }}</h3>
                  <p class="mt-1 truncate font-mono text-xs text-muted">
                    {{ candidate.imageReference }}
                  </p>
                </div>
              </div>
              <UiBadge :tone="candidateReady(candidate) ? 'success' : 'warning'" dot>
                {{ candidateReady(candidate) ? 'Ready' : 'Not ready' }}
              </UiBadge>
            </div>
            <dl class="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
              <div>
                <dt class="text-muted">Node</dt>
                <dd class="mt-1 text-ink">{{ candidate.nodeName }} · {{ candidate.nodeStatus }}</dd>
              </div>
              <div>
                <dt class="text-muted">Agent</dt>
                <dd class="mt-1 font-mono text-ink">v{{ candidate.agentVersion || 'unknown' }}</dd>
              </div>
              <div>
                <dt class="text-muted">PostgreSQL</dt>
                <dd class="mt-1 text-ink">{{ candidate.observedState }}</dd>
              </div>
              <div>
                <dt class="text-muted">Database / user</dt>
                <dd class="mt-1 truncate font-mono text-ink">
                  {{ candidate.desiredSpec.environment?.POSTGRES_DB || 'postgres' }} /
                  {{ candidate.desiredSpec.environment?.POSTGRES_USER || 'postgres' }}
                </dd>
              </div>
            </dl>
            <p v-if="!supportsActivation(candidate.agentVersion)" class="mt-3 text-xs text-warning">
              Upgrade OC Agent ke 0.4.0 untuk menjalankan preflight cluster.
            </p>
            <UiButton
              class="mt-4 w-full"
              :disabled="!candidateReady(candidate)"
              @click="openActivation(candidate)"
            >
              <ShieldCheck :size="15" /> Activate as standalone cluster
            </UiButton>
          </UiCard>
        </div>
      </section>
    </template>

    <UiDialog
      v-if="showActivation"
      title="Activate PostgreSQL cluster"
      description="Agent akan memverifikasi ownership container dan kesiapan PostgreSQL sebelum cluster menerima database aplikasi."
      size="lg"
      :close-disabled="activating"
      @close="showActivation = false"
    >
      <form
        id="cluster-activation-form"
        class="grid gap-4 md:grid-cols-2"
        @submit.prevent="activateCluster"
      >
        <p
          v-if="actionError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger md:col-span-2"
        >
          {{ actionError }}
        </p>
        <label class="block md:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">PostgreSQL resource</span>
          <select
            v-model="form.resourceId"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="" disabled>Pilih resource</option>
            <option
              v-for="candidate in overview?.candidates.filter(candidateReady)"
              :key="candidate.id"
              :value="candidate.id"
            >
              {{ candidate.name }} · {{ candidate.nodeName }}
            </option>
          </select>
        </label>
        <UiInput v-model="form.name" label="Nama cluster" pattern="[a-z0-9][a-z0-9-]*" required />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted"
            >Connection limit per service</span
          >
          <input
            v-model.number="form.defaultConnectionLimit"
            type="number"
            min="1"
            max="10000"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          />
        </label>
        <div class="rounded-md border border-info/30 bg-info/10 px-4 py-3 md:col-span-2">
          <p class="flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckCircle2 :size="15" /> Control-plane database protected
          </p>
          <p class="mt-1 text-xs leading-5 text-muted">
            Kandidat berasal dari resource PostgreSQL Template. Database metadata Billing tidak
            terdaftar sebagai infrastructure resource dan tidak dapat dipilih.
          </p>
        </div>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="activating" @click="showActivation = false">
            Batal
          </UiButton>
          <UiButton type="submit" form="cluster-activation-form" :disabled="activating">
            {{ activating ? 'Menjadwalkan preflight…' : 'Activate cluster' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiDialog
      v-if="showProvisioning"
      title="Provision service database"
      description="Agent membuat database dan role terisolasi, lalu aplikasi menerima connection string sebagai secret file dan diredeploy."
      size="lg"
      :close-disabled="provisioning"
      @close="showProvisioning = false"
    >
      <form
        id="service-database-form"
        class="grid gap-4 md:grid-cols-2"
        @submit.prevent="provisionDatabase"
      >
        <p
          v-if="actionError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger md:col-span-2"
        >
          {{ actionError }}
        </p>
        <label class="block md:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">Billing service</span>
          <select
            v-model="provisionForm.serviceId"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="" disabled>Pilih service</option>
            <option
              v-for="service in overview?.eligibleServices"
              :key="service.id"
              :value="service.id"
            >
              {{ service.serviceNumber }} · {{ service.name }} · {{ service.customerName }}
            </option>
          </select>
        </label>
        <label class="block md:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">Application resource</span>
          <select
            v-model="provisionForm.applicationResourceId"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="" disabled>Pilih aplikasi pada node yang sama</option>
            <option
              v-for="application in eligibleProvisionApplications"
              :key="application.id"
              :value="application.id"
            >
              {{ application.name }} · {{ application.nodeName }} · {{ application.observedState }}
            </option>
          </select>
        </label>
        <UiInput
          v-model="provisionForm.environmentKey"
          label="Environment key"
          pattern="[A-Z_][A-Z0-9_]*"
          required
        />
        <div class="rounded-md border border-info/30 bg-info/10 px-4 py-3">
          <p class="text-xs font-semibold text-ink">Private data-plane MVP</p>
          <p class="mt-1 text-xs leading-5 text-muted">
            Aplikasi dan PostgreSQL wajib berada pada node {{ selectedProvisionCluster?.nodeName }}.
          </p>
        </div>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="provisioning" @click="showProvisioning = false">
            Batal
          </UiButton>
          <UiButton
            type="submit"
            form="service-database-form"
            :disabled="provisioning || !provisionForm.applicationResourceId"
          >
            {{ provisioning ? 'Menjadwalkan…' : 'Provision database' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiConfirmDialog
      v-if="pendingReveal"
      :title="`Tampilkan credential ${pendingReveal.databaseName}?`"
      description="Password dan connection URI akan didekripsi sementara di browser. Tindakan ini dicatat di audit log tanpa menyimpan plaintext."
      confirm-label="Tampilkan credential"
      :pending="revealing"
      @confirm="revealCredential"
      @cancel="pendingReveal = null"
    />

    <UiConfirmDialog
      v-if="pendingRotation"
      :title="`Rotasi credential ${pendingRotation.databaseName}?`"
      description="Password role PostgreSQL akan diganti, secret aplikasi diperbarui, lalu aplikasi dijadwalkan redeploy. Connection string lama tidak dapat digunakan lagi."
      confirm-label="Rotasi credential"
      :pending="busyAllocationIds.includes(pendingRotation.id)"
      @confirm="runAllocationAction(pendingRotation, 'rotate')"
      @cancel="pendingRotation = null"
    />

    <UiDialog
      v-if="revealedCredential"
      title="Database credential"
      description="Salin nilai yang diperlukan lalu tutup dialog. Response API tidak disimpan di cache."
      size="lg"
      @close="revealedCredential = null"
    >
      <dl class="grid gap-4 text-sm md:grid-cols-2">
        <div>
          <dt class="text-xs font-semibold text-muted">Database</dt>
          <dd class="mt-1 font-mono text-ink">{{ revealedCredential.databaseName }}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-muted">Role</dt>
          <dd class="mt-1 font-mono text-ink">{{ revealedCredential.roleName }}</dd>
        </div>
        <div class="md:col-span-2">
          <dt class="text-xs font-semibold text-muted">Password</dt>
          <dd
            class="mt-1 flex items-center gap-2 rounded border bg-canvas px-3 py-2 font-mono text-xs text-ink"
          >
            <span class="min-w-0 flex-1 break-all">{{ revealedCredential.password }}</span>
            <UiButton variant="ghost" size="sm" @click="copyValue(revealedCredential.password)">
              <Copy :size="14" />
            </UiButton>
          </dd>
        </div>
        <div class="md:col-span-2">
          <dt class="text-xs font-semibold text-muted">{{ revealedCredential.environmentKey }}</dt>
          <dd
            class="mt-1 flex items-center gap-2 rounded border bg-canvas px-3 py-2 font-mono text-xs text-ink"
          >
            <span class="min-w-0 flex-1 break-all">{{ revealedCredential.connectionUri }}</span>
            <UiButton
              variant="ghost"
              size="sm"
              @click="copyValue(revealedCredential.connectionUri)"
            >
              <Copy :size="14" />
            </UiButton>
          </dd>
        </div>
      </dl>
      <template #footer>
        <UiButton @click="revealedCredential = null">Tutup</UiButton>
      </template>
    </UiDialog>
  </div>
</template>
