<script setup lang="ts">
import {
  AlertTriangle,
  Copy,
  ChevronDown,
  Download,
  Network,
  Package,
  Plus,
  RotateCcw,
  Server as ServerIcon,
  Settings2,
  ShieldX,
  Trash2,
  X,
} from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'
import { copyText } from '~/lib/clipboard'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Servers · Billing Infra' })

interface NodeImage {
  id: string
  references: string[]
  sizeBytes: string
  createdAt: string
  used: boolean
  containerCount: number
}

interface NodeNetwork {
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
  attachable: boolean
  managed: boolean
  containerCount: number
}

interface InfrastructureNode {
  id: string
  name: string
  environment: string
  role: 'deployment' | 'builder' | 'hybrid'
  status: 'enrolling' | 'online' | 'degraded' | 'offline' | 'revoked' | 'unknown'
  isActive: boolean
  isDraining: boolean
  agentVersion: string | null
  previousAgentVersion: string | null
  targetAgentVersion: string | null
  agentUpdateStatus: 'idle' | 'queued' | 'staging' | 'succeeded' | 'failed'
  agentLastUpdateAt: string | null
  agentLastUpdateError: string | null
  availableAgentVersion: string
  agentArtifactReady: boolean
  remoteUpdateSupported: boolean
  upgradeAvailable: boolean
  protocolVersion: string | null
  osRelease: string | null
  architecture: string | null
  dockerVersion: string | null
  composeVersion: string | null
  gatewayStatus: 'pending' | 'installing' | 'healthy' | 'failed' | 'unknown'
  gatewayVersion: string | null
  gatewayContainerId: string | null
  gatewayLastObservedAt: string | null
  gatewayLastError: string | null
  capacityCpuMilli: number | null
  capacityMemoryBytes: string | null
  capacityDiskBytes: string | null
  cpuUsageBasisPoints: number | null
  memoryUsedBytes: string | null
  diskUsedBytes: string | null
  diskUsageBasisPoints: number | null
  utilizationObservedAt: string | null
  diskWatermark: 'normal' | 'warning' | 'critical' | 'unknown'
  stuckOperationCount: number
  oldestStuckOperationAt: string | null
  labels: Record<string, string>
  capabilities: string[]
  lastHeartbeatAt: string | null
  resourceCount: number
  imageCount: number
  usedImageCount: number
  images: NodeImage[]
  networkCount: number
  networks: NodeNetwork[]
}

interface EnrollmentResult {
  id: string
  nodeName: string
  environment: string
  role: 'deployment' | 'builder' | 'hybrid'
  expiresAt: string
  token: string
}

const nodeRoleOptions: Array<{
  value: InfrastructureNode['role']
  label: string
  description: string
}> = [
  {
    value: 'deployment',
    label: 'Deployment',
    description: 'Menerima workload dan menjalankan gateway.',
  },
  {
    value: 'builder',
    label: 'Image builder',
    description: 'Hanya dipilih untuk pekerjaan build.',
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
    description: 'Menerima workload sekaligus pekerjaan build.',
  },
]

const format = useFormat()
const toast = useToast()
const runtimeConfig = useRuntimeConfig()
const requestUrl = useRequestURL()
const showEnrollmentForm = ref(false)
const saving = ref(false)
const revokingNodeId = ref<string | null>(null)
const updatingNodeId = ref<string | null>(null)
const editingRoleNode = ref<InfrastructureNode | null>(null)
const selectedRole = ref<InfrastructureNode['role']>('deployment')
const savingRole = ref(false)
const pendingRevokeNode = ref<InfrastructureNode | null>(null)
const pendingAgentAction = ref<{
  node: InfrastructureNode
  action: 'upgrade' | 'rollback'
} | null>(null)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const enrollment = ref<EnrollmentResult | null>(null)
const imageDialogNodeId = ref<string | null>(null)
const pendingImageDelete = ref<{ node: InfrastructureNode; image: NodeImage } | null>(null)
const deletingImageId = ref<string | null>(null)
const form = reactive({ nodeName: '', environment: 'staging', role: 'deployment', region: '' })
const minimumAgentVersion = '0.8.0'

const { data, status, error, refresh } = await useFetch<{ data: InfrastructureNode[] }>(
  '/api/infrastructure/nodes',
)
const nodes = computed(() => data.value?.data ?? [])
const search = ref('')
const nodeFilter = ref('all')
function resetFilters() {
  search.value = ''
  nodeFilter.value = 'all'
}
const onlineCount = computed(() => nodes.value.filter((node) => node.status === 'online').length)
function needsAttention(node: InfrastructureNode) {
  return (
    ['offline', 'degraded', 'unknown'].includes(node.status) ||
    node.gatewayStatus === 'failed' ||
    node.agentUpdateStatus === 'failed' ||
    node.stuckOperationCount > 0 ||
    ['warning', 'critical'].includes(node.diskWatermark)
  )
}
const attentionCount = computed(() => nodes.value.filter(needsAttention).length)
const visibleNodes = computed(() => {
  const query = search.value.trim().toLowerCase()
  return nodes.value.filter(
    (node) =>
      (!query ||
        [node.name, node.environment, node.role, node.agentVersion ?? '']
          .join(' ')
          .toLowerCase()
          .includes(query)) &&
      (nodeFilter.value === 'all' ||
        (nodeFilter.value === 'attention'
          ? needsAttention(node)
          : node.status === nodeFilter.value)),
  )
})

const imageDialogNode = computed(
  () => nodes.value.find((node) => node.id === imageDialogNodeId.value) ?? null,
)
const isInitialLoading = computed(() => status.value === 'pending' && data.value == null)
const roleSelectionInvalid = computed(() => {
  const node = editingRoleNode.value
  if (!node || selectedRole.value === node.role) return true
  if (
    ['builder', 'hybrid'].includes(selectedRole.value) &&
    !node.capabilities.includes('image-build')
  ) {
    return true
  }
  return selectedRole.value === 'builder' && node.resourceCount > 0
})
const controlPlaneUrl = computed(() => {
  return controlPlaneUrlForEnvironment(enrollment.value?.environment)
})
const usesInsecureRemoteHttp = computed(() => {
  try {
    const url = new URL(controlPlaneUrl.value)
    return (
      url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
    )
  } catch {
    return false
  }
})
const installerCommand = computed(() => {
  const url = controlPlaneUrl.value.replace(/'/g, "'\\''")
  const insecureFlag = usesInsecureRemoteHttp.value ? ' --allow-insecure-http' : ''
  return `curl -fsSL '${url}/install/oc-agent.sh' | sudo bash -s -- --url '${url}'${insecureFlag}`
})

function humanBytes(value: string | null) {
  if (!value) return '—'
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return value
  const gibibytes = bytes / 1024 ** 3
  return `${gibibytes.toLocaleString('id-ID', { maximumFractionDigits: 1 })} GiB`
}

function statusTone(nodeStatus: InfrastructureNode['status']) {
  if (nodeStatus === 'online') return 'success' as const
  if (nodeStatus === 'degraded' || nodeStatus === 'enrolling') return 'warning' as const
  if (nodeStatus === 'revoked' || nodeStatus === 'offline') return 'danger' as const
  return 'neutral' as const
}

function usagePercent(basisPoints: number | null) {
  return basisPoints === null
    ? '—'
    : `${(basisPoints / 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
}

function memoryUsagePercent(node: InfrastructureNode) {
  if (!node.memoryUsedBytes || !node.capacityMemoryBytes) return '—'
  return `${((Number(node.memoryUsedBytes) / Number(node.capacityMemoryBytes)) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
}

function imageDisplayName(image: NodeImage) {
  return image.references[0] ?? `${image.id.slice(0, 19)}…`
}

function diskWatermarkTone(watermark: InfrastructureNode['diskWatermark']) {
  if (watermark === 'critical') return 'danger' as const
  if (watermark === 'warning') return 'warning' as const
  if (watermark === 'normal') return 'success' as const
  return 'neutral' as const
}

function supportsCurrentFeatures(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return major > 0 || minor > 8 || (minor === 8 && patch >= 0)
}

function agentVersionTone(version: string | null) {
  if (!version) return 'neutral' as const
  return supportsCurrentFeatures(version) ? ('info' as const) : ('warning' as const)
}

function supportsRoleSync(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return major > 0 || minor > 11 || (minor === 11 && patch >= 1)
}

function supportsImageInventory(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return major > 0 || minor > 12 || (minor === 12 && patch >= 4)
}

function supportsImageDelete(node: InfrastructureNode) {
  return node.capabilities.includes('image-delete')
}

function roleOptionDisabled(role: InfrastructureNode['role'], node: InfrastructureNode) {
  return role !== 'deployment' && !node.capabilities.includes('image-build')
}

function gatewayStatusTone(gatewayStatus: InfrastructureNode['gatewayStatus']) {
  if (gatewayStatus === 'healthy') return 'success' as const
  if (gatewayStatus === 'failed') return 'danger' as const
  if (gatewayStatus === 'installing' || gatewayStatus === 'pending') return 'warning' as const
  return 'neutral' as const
}

async function createEnrollment() {
  saving.value = true
  actionError.value = null
  actionMessage.value = null
  enrollment.value = null

  try {
    const response = await $fetch<{ data: EnrollmentResult }>(
      '/api/infrastructure/nodes/enrollments',
      {
        method: 'POST',
        body: {
          nodeName: form.nodeName,
          environment: form.environment,
          role: form.role,
          expiresInMinutes: 30,
          labels: form.region ? { region: form.region } : {},
        },
      },
    )
    enrollment.value = response.data
    actionMessage.value = 'Enrollment token dibuat. Token hanya ditampilkan satu kali.'
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal membuat enrollment token.')
  } finally {
    saving.value = false
  }
}

async function copyEnrollmentToken() {
  if (!enrollment.value) return
  try {
    await copyText(enrollment.value.token)
    toast.success('Enrollment token berhasil disalin.')
  } catch {
    toast.error('Browser tidak dapat menyalin token. Salin token secara manual.')
  }
}

async function copyInstallerCommand() {
  try {
    await copyText(installerCommand.value)
    toast.success('Perintah installer berhasil disalin.')
  } catch {
    toast.error('Browser tidak dapat menyalin perintah. Salin secara manual.')
  }
}

function controlPlaneUrlForEnvironment(environment?: string) {
  const appUrl = String(runtimeConfig.public.appUrl || requestUrl.origin)
  const developmentUrl = String(runtimeConfig.public.agentControlPlaneUrl || '')
  const url = environment === 'development' && developmentUrl ? developmentUrl : appUrl
  return url.replace(/\/$/, '')
}

function installerCommandForNode(node: InfrastructureNode) {
  const url = controlPlaneUrlForEnvironment(node.environment).replace(/'/g, "'\\''")
  let insecureFlag = ''
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)
    ) {
      insecureFlag = ' --allow-insecure-http'
    }
  } catch {
    // The server will still reject an invalid URL when the command is run.
  }
  return `curl -fsSL '${url}/install/oc-agent.sh' | sudo bash -s -- --url '${url}'${insecureFlag}`
}

async function copyBootstrapCommand(node: InfrastructureNode) {
  try {
    await copyText(installerCommandForNode(node))
    toast.success('Command bootstrap updater berhasil disalin.')
  } catch {
    toast.error('Browser tidak dapat menyalin command bootstrap.')
  }
}

async function runAgentAction(node: InfrastructureNode, action: 'upgrade' | 'rollback') {
  updatingNodeId.value = node.id
  actionError.value = null
  actionMessage.value = null
  try {
    await $fetch(`/api/infrastructure/nodes/${node.id}/${action}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `agent-${action}:${node.id}:${crypto.randomUUID()}` },
    })
    actionMessage.value =
      action === 'upgrade'
        ? `Upgrade ${node.name} ke v${node.availableAgentVersion} masuk antrean.`
        : `Rollback ${node.name} ke v${node.previousAgentVersion} masuk antrean.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(
      caught,
      action === 'upgrade'
        ? 'Gagal mengantrekan upgrade agent.'
        : 'Gagal mengantrekan rollback agent.',
    )
  } finally {
    updatingNodeId.value = null
    pendingAgentAction.value = null
  }
}

let refreshTimer: number | undefined
onMounted(() => {
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && status.value !== 'pending') void refresh()
  }, 15_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})

async function revokeNode(node: InfrastructureNode) {
  revokingNodeId.value = node.id
  actionError.value = null
  actionMessage.value = null
  try {
    await $fetch(`/api/infrastructure/nodes/${node.id}/revoke`, { method: 'POST' })
    actionMessage.value = `Identity ${node.name} telah dicabut.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal mencabut identity node.')
  } finally {
    revokingNodeId.value = null
    pendingRevokeNode.value = null
  }
}

async function deleteNodeImage() {
  const pending = pendingImageDelete.value
  if (!pending || pending.image.used) return

  deletingImageId.value = pending.image.id
  actionError.value = null
  actionMessage.value = null
  try {
    await $fetch(
      `/api/infrastructure/nodes/${pending.node.id}/images/${encodeURIComponent(pending.image.id)}`,
      {
        method: 'DELETE',
        headers: {
          'Idempotency-Key': `image-delete:${pending.node.id}:${pending.image.id}:${crypto.randomUUID()}`,
        },
      },
    )
    actionMessage.value = `Penghapusan image ${imageDisplayName(pending.image)} masuk antrean pada ${pending.node.name}.`
    pendingImageDelete.value = null
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal mengantrekan penghapusan image.')
  } finally {
    deletingImageId.value = null
  }
}

function openRoleDialog(node: InfrastructureNode) {
  editingRoleNode.value = node
  selectedRole.value = node.role
}

function closeRoleDialog() {
  if (!savingRole.value) editingRoleNode.value = null
}

async function updateNodeRole() {
  const node = editingRoleNode.value
  if (!node || roleSelectionInvalid.value) return

  savingRole.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    await $fetch(`/api/infrastructure/nodes/${node.id}/role`, {
      method: 'PATCH',
      body: { role: selectedRole.value },
    })
    actionMessage.value = supportsRoleSync(node.agentVersion)
      ? `Mode ${node.name} diubah menjadi ${selectedRole.value}. Agent akan menyinkronkan mode pada heartbeat berikutnya.`
      : `Mode scheduler ${node.name} diubah menjadi ${selectedRole.value}. Update agent ke v0.11.1+ agar perilaku lokal ikut tersinkron.`
    editingRoleNode.value = null
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal mengubah mode node.')
  } finally {
    savingRole.value = false
  }
}

function closeEnrollment() {
  enrollment.value = null
  showEnrollmentForm.value = false
  Object.assign(form, { nodeName: '', environment: 'staging', role: 'deployment', region: '' })
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <InfrastructurePageHeader
      title="Servers"
      description="Status server, kapasitas, dan versi agent."
    >
      <div class="flex gap-2">
        <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
        <UiButton @click="showEnrollmentForm = !showEnrollmentForm">
          <X v-if="showEnrollmentForm" :size="15" aria-hidden="true" />
          <Plus v-else :size="15" aria-hidden="true" />
          {{ showEnrollmentForm ? 'Tutup' : 'Tambah server' }}
        </UiButton>
      </div>
    </InfrastructurePageHeader>

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

    <UiCard v-if="showEnrollmentForm" class="mb-5">
      <form v-if="!enrollment" class="grid gap-4 md:grid-cols-4" @submit.prevent="createEnrollment">
        <UiInput
          v-model="form.nodeName"
          label="Nama node"
          placeholder="staging-01"
          autocomplete="off"
          required
        />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Environment</span>
          <UiSelect
            v-model="form.environment"
            class="w-full"
            :options="[
              { value: 'development', label: 'Development' },
              { value: 'staging', label: 'Staging' },
            ]"
          />
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Role node</span>
          <UiSelect
            v-model="form.role"
            class="w-full"
            :options="[
              { value: 'deployment', label: 'Deployment' },
              { value: 'builder', label: 'Image builder' },
              { value: 'hybrid', label: 'Hybrid' },
            ]"
          />
          <span class="mt-1.5 block text-xs text-muted">
            Builder sebaiknya memakai server terpisah; hybrid juga menerima workload deployment.
          </span>
        </label>
        <UiInput
          v-model="form.region"
          label="Region (opsional)"
          placeholder="id-bali"
          autocomplete="off"
        />
        <div class="md:col-span-4 flex justify-end">
          <UiButton type="submit" :disabled="saving">
            {{ saving ? 'Membuat…' : 'Buat token 30 menit' }}
          </UiButton>
        </div>
      </form>

      <div v-else>
        <p class="text-sm font-semibold text-ink">
          Token untuk {{ enrollment.nodeName }} · {{ enrollment.role }}
        </p>
        <p class="mt-1 text-xs text-muted">
          Simpan sementara pada <code>/etc/oc-agent/agent.env</code>. Hapus setelah enrollment
          berhasil. Kedaluwarsa {{ format.dateTime(enrollment.expiresAt) }}.
        </p>
        <div class="mt-4 flex items-center gap-2 rounded-md border bg-canvas p-3">
          <code
            class="min-w-0 flex-1 cursor-pointer break-all text-xs text-ink"
            title="Klik untuk menyalin token"
            tabindex="0"
            role="button"
            @click="copyEnrollmentToken"
            @keydown.enter="copyEnrollmentToken"
            @keydown.space.prevent="copyEnrollmentToken"
            >{{ enrollment.token }}</code
          >
          <UiButton variant="secondary" size="sm" @click="copyEnrollmentToken">
            <Copy :size="14" aria-hidden="true" />
            Salin
          </UiButton>
        </div>
        <div class="mt-4">
          <p class="text-xs font-semibold text-ink">Install pada Ubuntu Server</p>
          <p class="mt-1 text-xs leading-5 text-muted">
            Jalankan perintah berikut melalui SSH. Installer akan meminta token di atas secara
            interaktif sehingga token tidak masuk ke URL atau access log.
          </p>
          <p
            v-if="usesInsecureRemoteHttp"
            class="mt-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            HTTP tanpa enkripsi diaktifkan untuk development LAN. Jangan gunakan command ini untuk
            staging atau production.
          </p>
          <div class="mt-2 flex items-start gap-2 rounded-md border bg-canvas p-3">
            <code class="min-w-0 flex-1 break-all text-xs leading-5 text-ink">{{
              installerCommand
            }}</code>
            <UiButton variant="secondary" size="sm" @click="copyInstallerCommand">
              <Copy :size="14" aria-hidden="true" />
              Salin command
            </UiButton>
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <UiButton variant="secondary" @click="closeEnrollment">Selesai</UiButton>
        </div>
      </div>
    </UiCard>

    <div
      v-if="!isInitialLoading && !error"
      class="mb-5 grid grid-cols-3 divide-x divide-line rounded-md border bg-surface"
    >
      <InfrastructureMetric label="Server terdaftar" :value="format.count(nodes.length)" />
      <InfrastructureMetric label="Online" :value="format.count(onlineCount)" />
      <InfrastructureMetric
        label="Perlu perhatian"
        :value="format.count(attentionCount)"
        :tone="attentionCount ? 'warning' : 'neutral'"
      />
    </div>
    <InfrastructureToolbar
      v-if="nodes.length"
      v-model="search"
      placeholder="Cari server, environment, atau agent…"
      :count="visibleNodes.length"
      :total="nodes.length"
      unit="server"
    >
      <UiSelect
        v-model="nodeFilter"
        aria-label="Filter status server"
        size="md"
        :options="[
          { value: 'all', label: 'Semua status' },
          { value: 'online', label: 'Online' },
          { value: 'attention', label: 'Perlu perhatian' },
          { value: 'revoked', label: 'Akses dicabut' },
        ]"
      />
    </InfrastructureToolbar>

    <div v-if="isInitialLoading" class="space-y-2">
      <UiSkeleton v-for="card in 3" :key="card" height="5rem" />
    </div>

    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Gagal memuat node"
        description="Control plane tidak dapat membaca daftar node Ubuntu. Pastikan migration terbaru sudah dijalankan."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>
    </UiCard>

    <UiCard v-else-if="nodes.length === 0" :padded="false">
      <UiEmptyState
        title="Belum ada node Ubuntu"
        description="Buat enrollment token, install OC Agent pada Ubuntu Server, lalu jalankan servicenya."
      />
    </UiCard>

    <UiEmptyState
      v-else-if="!visibleNodes.length"
      title="Server tidak ditemukan"
      description="Coba nama atau status lain."
    >
      <UiButton variant="secondary" size="sm" @click="resetFilters">Reset filter</UiButton>
    </UiEmptyState>
    <div v-else class="divide-y overflow-hidden rounded-md border bg-surface">
      <details v-for="node in visibleNodes" :key="node.id" class="group">
        <summary
          class="focus-ring flex cursor-pointer list-none items-center gap-4 px-4 py-4 hover:bg-surface-raised/60 [&::-webkit-details-marker]:hidden"
        >
          <div
            class="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr] xl:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr]"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <ServerIcon :size="15" class="text-muted" aria-hidden="true" />
                <h2 class="truncate text-sm font-semibold text-ink">{{ node.name }}</h2>
                <UiBadge :tone="statusTone(node.status)" dot>{{ node.status }}</UiBadge>
                <UiBadge v-if="needsAttention(node)" tone="warning">Perlu perhatian</UiBadge>
              </div>
              <p class="mt-1 text-xs text-muted">
                {{ node.environment }} · {{ node.role }} · {{ node.resourceCount }} resource<span
                  v-if="node.isDraining"
                >
                  · Draining</span
                >
              </p>
            </div>
            <div class="text-xs">
              <p class="text-muted">CPU / Memory</p>
              <p class="mt-1 font-mono text-ink">
                {{ usagePercent(node.cpuUsageBasisPoints) }} / {{ memoryUsagePercent(node) }}
              </p>
            </div>
            <div class="text-xs">
              <p class="text-muted">Disk</p>
              <p
                class="mt-1 font-mono"
                :class="
                  ['warning', 'critical'].includes(node.diskWatermark) ? 'text-warning' : 'text-ink'
                "
              >
                {{ usagePercent(node.diskUsageBasisPoints) }}
                <span class="text-muted">/ {{ humanBytes(node.capacityDiskBytes) }}</span>
              </p>
            </div>
            <div class="hidden text-xs xl:block">
              <p class="text-muted">Agent</p>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <UiBadge :tone="agentVersionTone(node.agentVersion)">{{
                  node.agentVersion ? `v${node.agentVersion}` : 'Belum terhubung'
                }}</UiBadge>
                <span
                  v-if="['queued', 'staging'].includes(node.agentUpdateStatus)"
                  class="text-warning"
                  >{{ node.agentUpdateStatus }}</span
                >
              </div>
            </div>
          </div>
          <ChevronDown
            :size="16"
            class="shrink-0 text-muted transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div class="border-t bg-surface-raised/30 px-4 pb-4">
          <dl class="grid grid-cols-2 gap-x-8 gap-y-4 pt-4 text-xs lg:grid-cols-4">
            <div>
              <dt class="text-muted">Resources</dt>
              <dd class="mt-1 font-mono text-ink">{{ format.count(node.resourceCount) }}</dd>
            </div>
            <div>
              <dt class="text-muted">Docker images</dt>
              <dd class="mt-1 flex flex-wrap items-center gap-2 font-mono text-ink">
                <span>{{ format.count(node.imageCount) }}</span>
                <UiBadge v-if="node.usedImageCount" tone="success">
                  {{ node.usedImageCount }} used
                </UiBadge>
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="flex items-center gap-2 text-muted">
                <Network :size="13" /> Docker networks
              </dt>
              <dd v-if="node.networks.length" class="mt-2 flex flex-wrap gap-2">
                <UiBadge
                  v-for="network in node.networks"
                  :key="network.id"
                  :tone="network.managed ? 'info' : 'neutral'"
                  :title="`${network.driver}/${network.scope} · ${network.containerCount} container${network.internal ? ' · internal' : ''}`"
                >
                  {{ network.name }} · {{ network.containerCount }}
                </UiBadge>
              </dd>
              <dd v-else class="mt-1 text-xs text-muted">
                Menunggu network inventory dari agent v0.12.9+.
              </dd>
            </div>
            <div>
              <dt class="text-muted">CPU usage</dt>
              <dd class="mt-1 font-mono text-ink">
                {{ usagePercent(node.cpuUsageBasisPoints) }}
                <span class="text-muted">
                  / {{ node.capacityCpuMilli ? `${node.capacityCpuMilli / 1000} core` : '—' }}
                </span>
              </dd>
            </div>
            <div>
              <dt class="text-muted">Memory usage</dt>
              <dd class="mt-1 font-mono text-ink">
                {{ memoryUsagePercent(node) }}
                <span class="text-muted">
                  · {{ humanBytes(node.memoryUsedBytes) }} /
                  {{ humanBytes(node.capacityMemoryBytes) }}
                </span>
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="text-muted">Root disk</dt>
              <dd class="mt-1 flex flex-wrap items-center gap-2 font-mono text-ink">
                <UiBadge :tone="diskWatermarkTone(node.diskWatermark)" dot>
                  {{ usagePercent(node.diskUsageBasisPoints) }} · {{ node.diskWatermark }}
                </UiBadge>
                <span
                  >{{ humanBytes(node.diskUsedBytes) }} /
                  {{ humanBytes(node.capacityDiskBytes) }}</span
                >
              </dd>
            </div>
            <div
              v-if="node.stuckOperationCount > 0"
              class="col-span-2 rounded border border-warning/30 bg-warning/10 px-3 py-2"
            >
              <dt class="flex items-center gap-2 font-semibold text-warning">
                <AlertTriangle :size="14" /> {{ node.stuckOperationCount }} operation stuck
              </dt>
              <dd class="mt-1 text-warning">
                Sejak {{ format.dateTime(node.oldestStuckOperationAt) }} ·
                <NuxtLink to="/deployments" class="underline">buka Deployments</NuxtLink>
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="text-muted">Host</dt>
              <dd class="mt-1 truncate font-mono text-ink">{{ node.osRelease || '—' }}</dd>
            </div>
            <div class="col-span-2">
              <dt class="text-muted">Docker / Compose</dt>
              <dd class="mt-1 truncate font-mono text-ink">
                {{ node.dockerVersion || '—' }} / {{ node.composeVersion || '—' }}
              </dd>
            </div>
            <div class="col-span-2">
              <div class="flex items-center justify-between gap-3">
                <dt class="text-muted">Image inventory</dt>
                <UiButton
                  v-if="node.images.length"
                  variant="secondary"
                  size="sm"
                  type="button"
                  @click="imageDialogNodeId = node.id"
                >
                  <Package :size="13" aria-hidden="true" />
                  Kelola images
                </UiButton>
              </div>
              <dd v-if="!node.images.length" class="mt-1 text-xs text-muted">
                {{
                  supportsImageInventory(node.agentVersion)
                    ? 'Tidak ada image Docker pada server.'
                    : 'Menunggu inventory dari agent v0.12.4+.'
                }}
              </dd>
            </div>
            <div v-if="node.role !== 'builder'" class="col-span-2">
              <dt class="text-muted">Traefik gateway</dt>
              <dd class="mt-1 flex items-center gap-2">
                <UiBadge :tone="gatewayStatusTone(node.gatewayStatus)" dot>
                  {{ node.gatewayStatus }}
                </UiBadge>
                <span class="truncate font-mono text-ink">{{ node.gatewayVersion || '—' }}</span>
              </dd>
              <p v-if="node.gatewayLastError" class="mt-2 text-xs leading-5 text-danger">
                {{ node.gatewayLastError }}
              </p>
              <p v-if="node.gatewayLastObservedAt" class="mt-1 text-[11px] text-muted">
                Observed {{ format.dateTime(node.gatewayLastObservedAt) }}
              </p>
            </div>
            <div v-if="node.role !== 'deployment'" class="col-span-2">
              <dt class="text-muted">Builder capability</dt>
              <dd class="mt-1">
                <UiBadge
                  :tone="node.capabilities.includes('image-build') ? 'success' : 'danger'"
                  dot
                >
                  {{
                    node.capabilities.includes('image-build') ? 'ready' : 'git/buildx unavailable'
                  }}
                </UiBadge>
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="text-muted">Heartbeat terakhir</dt>
              <dd class="mt-1 font-mono text-ink">{{ format.dateTime(node.lastHeartbeatAt) }}</dd>
            </div>
            <div class="col-span-2">
              <dt class="text-muted">Agent</dt>
              <dd class="mt-1 text-ink">
                <span :title="`Remote update membutuhkan agent ${minimumAgentVersion}+`">
                  Terpasang {{ node.agentVersion ? `v${node.agentVersion}` : '—' }} ·
                </span>
                Tersedia v{{ node.availableAgentVersion }}
                <span v-if="node.previousAgentVersion" class="text-muted">
                  · rollback v{{ node.previousAgentVersion }}
                </span>
              </dd>
              <p v-if="node.agentLastUpdateError" class="mt-2 text-xs leading-5 text-danger">
                {{ node.agentLastUpdateError }}
              </p>
              <p v-else-if="node.agentLastUpdateAt" class="mt-1 text-[11px] text-muted">
                Update terakhir {{ format.dateTime(node.agentLastUpdateAt) }}
              </p>
              <p
                v-if="node.upgradeAvailable && !node.agentArtifactReady"
                class="mt-2 text-xs leading-5 text-warning"
              >
                Artifact {{ node.architecture }} belum tersedia di control plane. Jalankan
                <code>npm run agent:build:linux:all</code>.
              </p>
            </div>
          </dl>

          <div
            v-if="node.status !== 'revoked'"
            class="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4"
          >
            <UiButton variant="secondary" size="sm" @click="openRoleDialog(node)">
              <Settings2 :size="14" aria-hidden="true" />
              Ubah mode
            </UiButton>
            <UiButton
              v-if="node.upgradeAvailable && !node.remoteUpdateSupported"
              variant="secondary"
              size="sm"
              :disabled="!node.agentArtifactReady"
              @click="copyBootstrapCommand(node)"
            >
              <Copy :size="14" aria-hidden="true" />
              Bootstrap updater
            </UiButton>
            <UiButton
              v-else-if="node.upgradeAvailable"
              size="sm"
              :disabled="
                updatingNodeId === node.id ||
                !node.agentArtifactReady ||
                !['online', 'degraded'].includes(node.status) ||
                ['queued', 'staging'].includes(node.agentUpdateStatus)
              "
              @click="pendingAgentAction = { node, action: 'upgrade' }"
            >
              <Download :size="14" aria-hidden="true" />
              Update ke v{{ node.availableAgentVersion }}
            </UiButton>
            <UiButton
              v-if="node.previousAgentVersion && node.remoteUpdateSupported"
              variant="secondary"
              size="sm"
              :disabled="
                updatingNodeId === node.id ||
                !['online', 'degraded'].includes(node.status) ||
                ['queued', 'staging'].includes(node.agentUpdateStatus)
              "
              @click="pendingAgentAction = { node, action: 'rollback' }"
            >
              <RotateCcw :size="14" aria-hidden="true" />
              Rollback v{{ node.previousAgentVersion }}
            </UiButton>
            <UiButton
              variant="danger"
              size="sm"
              :disabled="revokingNodeId === node.id"
              @click="pendingRevokeNode = node"
            >
              <ShieldX :size="14" aria-hidden="true" />
              {{ revokingNodeId === node.id ? 'Mencabut…' : 'Cabut identity' }}
            </UiButton>
          </div>
        </div>
      </details>
    </div>

    <UiDialog
      v-if="imageDialogNode"
      :title="`Docker images · ${imageDialogNode.name}`"
      description="Image Used dilindungi karena masih direferensikan container. Hanya image Unused yang dapat dihapus."
      size="lg"
      :close-disabled="Boolean(deletingImageId)"
      @close="imageDialogNodeId = null"
    >
      <div class="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
        <div
          v-for="image in imageDialogNode.images"
          :key="image.id"
          class="rounded-md border border-line-strong bg-canvas p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-mono text-sm text-ink" :title="imageDisplayName(image)">
                {{ imageDisplayName(image) }}
              </p>
              <p class="mt-1 truncate font-mono text-[10px] text-muted" :title="image.id">
                {{ image.id }}
              </p>
              <p class="mt-1.5 text-xs text-muted">
                {{ humanBytes(image.sizeBytes) }} · {{ format.dateTime(image.createdAt) }}
                <span v-if="image.used"> · {{ image.containerCount }} container</span>
                <span v-if="image.references.length > 1">
                  · {{ image.references.length }} references
                </span>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <UiBadge :tone="image.used ? 'success' : 'neutral'" dot>
                {{ image.used ? 'Used' : 'Unused' }}
              </UiBadge>
              <UiButton
                variant="danger"
                size="sm"
                :disabled="
                  image.used ||
                  deletingImageId === image.id ||
                  !supportsImageDelete(imageDialogNode) ||
                  !['online', 'degraded'].includes(imageDialogNode.status)
                "
                :title="
                  image.used
                    ? 'Image masih digunakan oleh container'
                    : !supportsImageDelete(imageDialogNode)
                      ? 'Hapus image membutuhkan agent v0.12.5+'
                      : 'Hapus image dari server'
                "
                @click="pendingImageDelete = { node: imageDialogNode, image }"
              >
                <Trash2 :size="14" aria-hidden="true" />
                Hapus
              </UiButton>
            </div>
          </div>
        </div>
        <p v-if="!imageDialogNode.images.length" class="py-8 text-center text-sm text-muted">
          Tidak ada image Docker pada server ini.
        </p>
      </div>

      <p
        v-if="!supportsImageDelete(imageDialogNode)"
        class="mt-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
      >
        Perbarui agent ke v0.12.5+ untuk menghapus image dari dashboard.
      </p>

      <template #footer>
        <div class="flex justify-end">
          <UiButton
            variant="secondary"
            :disabled="Boolean(deletingImageId)"
            @click="imageDialogNodeId = null"
          >
            Tutup
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiDialog
      v-if="editingRoleNode"
      :title="`Ubah mode ${editingRoleNode.name}`"
      description="Mode menentukan apakah node menerima deployment workload, pekerjaan build, atau keduanya."
      size="md"
      :close-disabled="savingRole"
      @close="closeRoleDialog"
    >
      <fieldset :disabled="savingRole">
        <legend class="mb-2 text-xs font-semibold text-muted">Mode node</legend>
        <div class="grid gap-2 sm:grid-cols-3">
          <label
            v-for="option in nodeRoleOptions"
            :key="option.value"
            class="relative rounded-md border p-3 transition"
            :class="[
              selectedRole === option.value
                ? 'border-brand bg-brand/10'
                : 'border-line-strong bg-canvas hover:border-muted hover:bg-surface-raised',
              roleOptionDisabled(option.value, editingRoleNode)
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer',
            ]"
          >
            <input
              v-model="selectedRole"
              type="radio"
              name="node-role"
              :value="option.value"
              :disabled="roleOptionDisabled(option.value, editingRoleNode)"
              :autofocus="option.value === editingRoleNode.role"
              class="peer sr-only"
            />
            <span
              class="pointer-events-none absolute inset-0 rounded-md peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface"
            />
            <span class="flex items-center justify-between gap-2 text-sm font-semibold text-ink">
              {{ option.label }}
              <span
                class="size-3.5 rounded-full border-2"
                :class="
                  selectedRole === option.value
                    ? 'border-brand bg-brand shadow-[inset_0_0_0_3px_var(--color-surface)]'
                    : 'border-line-strong bg-surface'
                "
                aria-hidden="true"
              />
            </span>
            <span class="mt-1.5 block text-xs leading-5 text-muted">
              {{ option.description }}
            </span>
          </label>
        </div>
      </fieldset>

      <p
        v-if="!editingRoleNode.capabilities.includes('image-build')"
        class="mt-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning"
      >
        Git atau Docker Buildx belum tersedia. Install keduanya lalu restart OC Agent agar mode
        builder dan hybrid dapat dipilih.
      </p>
      <p
        v-else-if="selectedRole === 'builder' && editingRoleNode.resourceCount > 0"
        class="mt-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning"
      >
        Node masih memiliki {{ format.count(editingRoleNode.resourceCount) }} resource. Pilih hybrid
        atau pindahkan resource sebelum menggunakan mode builder murni.
      </p>
      <p
        v-else-if="!supportsRoleSync(editingRoleNode.agentVersion)"
        class="mt-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning"
      >
        Scheduler langsung memakai mode baru, tetapi agent
        {{ editingRoleNode.agentVersion || 'lama' }}
        perlu diperbarui ke v0.11.1+ agar perilaku lokal ikut tersinkron melalui heartbeat.
      </p>
      <p v-else class="mt-4 text-xs leading-5 text-muted">
        Perubahan scheduler berlaku langsung dan agent menerapkan perilaku mode baru pada heartbeat
        berikutnya.
      </p>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="savingRole" @click="closeRoleDialog">
            Batal
          </UiButton>
          <UiButton :disabled="savingRole || roleSelectionInvalid" @click="updateNodeRole">
            {{ savingRole ? 'Menyimpan…' : 'Simpan mode' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiConfirmDialog
      v-if="pendingImageDelete"
      :title="`Hapus image ${imageDisplayName(pendingImageDelete.image)}?`"
      :description="`Semua tag lokal untuk image ini akan dihapus dari ${pendingImageDelete.node.name}. Image tidak dapat dipulihkan tanpa build atau pull ulang.`"
      confirm-label="Hapus image"
      destructive
      :pending="deletingImageId === pendingImageDelete.image.id"
      @confirm="deleteNodeImage"
      @cancel="pendingImageDelete = null"
    />

    <UiConfirmDialog
      v-if="pendingAgentAction"
      :title="
        pendingAgentAction.action === 'upgrade'
          ? `Update agent ${pendingAgentAction.node.name}?`
          : `Rollback agent ${pendingAgentAction.node.name}?`
      "
      :description="
        pendingAgentAction.action === 'upgrade'
          ? `Binary akan diverifikasi lalu diganti secara atomik ke v${pendingAgentAction.node.availableAgentVersion}. Jika heartbeat baru gagal, updater mengembalikan binary sebelumnya.`
          : `Agent akan kembali ke v${pendingAgentAction.node.previousAgentVersion}. Binary saat ini tetap disimpan agar dapat dipulihkan kembali.`
      "
      :confirm-label="pendingAgentAction.action === 'upgrade' ? 'Update agent' : 'Rollback agent'"
      :pending="updatingNodeId === pendingAgentAction.node.id"
      @confirm="runAgentAction(pendingAgentAction.node, pendingAgentAction.action)"
      @cancel="pendingAgentAction = null"
    />

    <UiConfirmDialog
      v-if="pendingRevokeNode"
      :title="`Cabut identity ${pendingRevokeNode.name}?`"
      description="Agent akan langsung kehilangan akses ke control plane dan harus di-enroll ulang agar dapat terhubung kembali."
      confirm-label="Cabut identity"
      destructive
      :pending="revokingNodeId === pendingRevokeNode.id"
      @confirm="revokeNode(pendingRevokeNode)"
      @cancel="pendingRevokeNode = null"
    />
  </div>
</template>
