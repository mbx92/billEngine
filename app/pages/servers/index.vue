<script setup lang="ts">
import { Copy, Plus, Server as ServerIcon, ShieldX, X } from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'
import { copyText } from '~/lib/clipboard'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Ubuntu Nodes · Billing Infra' })

interface InfrastructureNode {
  id: string
  name: string
  environment: string
  status: 'enrolling' | 'online' | 'degraded' | 'offline' | 'revoked' | 'unknown'
  isActive: boolean
  isDraining: boolean
  agentVersion: string | null
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
  labels: Record<string, string>
  lastHeartbeatAt: string | null
  resourceCount: number
}

interface EnrollmentResult {
  id: string
  nodeName: string
  environment: string
  expiresAt: string
  token: string
}

const format = useFormat()
const toast = useToast()
const runtimeConfig = useRuntimeConfig()
const requestUrl = useRequestURL()
const showEnrollmentForm = ref(false)
const saving = ref(false)
const revokingNodeId = ref<string | null>(null)
const pendingRevokeNode = ref<InfrastructureNode | null>(null)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const enrollment = ref<EnrollmentResult | null>(null)
const form = reactive({ nodeName: '', environment: 'staging', region: '' })
const minimumAgentVersion = '0.7.0'

const { data, status, error, refresh } = await useFetch<{ data: InfrastructureNode[] }>(
  '/api/infrastructure/nodes',
)
const nodes = computed(() => data.value?.data ?? [])
const controlPlaneUrl = computed(() => {
  const appUrl = String(runtimeConfig.public.appUrl || requestUrl.origin)
  const developmentUrl = String(runtimeConfig.public.agentControlPlaneUrl || '')
  const url =
    enrollment.value?.environment === 'development' && developmentUrl ? developmentUrl : appUrl
  return url.replace(/\/$/, '')
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
  if (nodeStatus === 'revoked') return 'danger' as const
  return 'neutral' as const
}

function supportsCurrentFeatures(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 7
}

function agentVersionTone(version: string | null) {
  if (!version) return 'neutral' as const
  return supportsCurrentFeatures(version) ? ('info' as const) : ('warning' as const)
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

function closeEnrollment() {
  enrollment.value = null
  showEnrollmentForm.value = false
  Object.assign(form, { nodeName: '', environment: 'staging', region: '' })
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / Ubuntu nodes
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Ubuntu Nodes</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Kelola server Ubuntu yang menjalankan OC Agent. Control plane tidak membuka akses shell
          dan tidak memberikan Docker socket kepada dashboard.
        </p>
      </div>
      <div class="flex gap-2">
        <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
        <UiButton @click="showEnrollmentForm = !showEnrollmentForm">
          <X v-if="showEnrollmentForm" :size="15" aria-hidden="true" />
          <Plus v-else :size="15" aria-hidden="true" />
          {{ showEnrollmentForm ? 'Tutup' : 'Enroll node' }}
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
      v-if="actionError"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <UiCard v-if="showEnrollmentForm" class="mb-5">
      <form v-if="!enrollment" class="grid gap-4 md:grid-cols-3" @submit.prevent="createEnrollment">
        <UiInput
          v-model="form.nodeName"
          label="Nama node"
          placeholder="staging-01"
          autocomplete="off"
          required
        />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Environment</span>
          <select
            v-model="form.environment"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="development">Development</option>
            <option value="staging">Staging</option>
          </select>
        </label>
        <UiInput
          v-model="form.region"
          label="Region (opsional)"
          placeholder="id-bali"
          autocomplete="off"
        />
        <div class="md:col-span-3 flex justify-end">
          <UiButton type="submit" :disabled="saving">
            {{ saving ? 'Membuat…' : 'Buat token 30 menit' }}
          </UiButton>
        </div>
      </form>

      <div v-else>
        <p class="text-sm font-semibold text-ink">Token untuk {{ enrollment.nodeName }}</p>
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

    <div v-if="status === 'pending'" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <UiSkeleton v-for="card in 3" :key="card" height="13rem" />
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

    <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <UiCard v-for="node in nodes" :key="node.id">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="flex items-center gap-2 truncate text-sm font-semibold text-ink">
              <ServerIcon :size="15" aria-hidden="true" />
              {{ node.name }}
            </h2>
            <p class="mt-1 font-mono text-[11px] text-muted">
              {{ node.environment }} · {{ node.architecture || 'arsitektur belum diketahui' }}
            </p>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-2">
            <UiBadge :tone="statusTone(node.status)" dot>{{ node.status }}</UiBadge>
            <UiBadge
              :tone="agentVersionTone(node.agentVersion)"
              :title="
                node.agentVersion && !supportsCurrentFeatures(node.agentVersion)
                  ? `Upgrade ke ${minimumAgentVersion}+ untuk bootstrap gateway dan route aplikasi`
                  : 'Versi OC Agent yang dilaporkan pada heartbeat terakhir'
              "
            >
              Agent {{ node.agentVersion ? `v${node.agentVersion}` : 'belum diketahui' }}
            </UiBadge>
          </div>
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
          <div>
            <dt class="text-muted">Resources</dt>
            <dd class="mt-1 font-mono text-ink">{{ format.count(node.resourceCount) }}</dd>
          </div>
          <div>
            <dt class="text-muted">CPU</dt>
            <dd class="mt-1 font-mono text-ink">
              {{ node.capacityCpuMilli ? `${node.capacityCpuMilli / 1000} core` : '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">Memory</dt>
            <dd class="mt-1 font-mono text-ink">{{ humanBytes(node.capacityMemoryBytes) }}</dd>
          </div>
          <div>
            <dt class="text-muted">Disk</dt>
            <dd class="mt-1 font-mono text-ink">{{ humanBytes(node.capacityDiskBytes) }}</dd>
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
          <div class="col-span-2">
            <dt class="text-muted">Heartbeat terakhir</dt>
            <dd class="mt-1 font-mono text-ink">{{ format.dateTime(node.lastHeartbeatAt) }}</dd>
          </div>
        </dl>

        <div v-if="node.status !== 'revoked'" class="mt-4 flex justify-end border-t pt-4">
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
      </UiCard>
    </div>

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
