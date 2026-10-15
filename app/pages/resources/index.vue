<script setup lang="ts">
import {
  Box,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Trash2,
  X,
} from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'
import { copyText } from '~/lib/clipboard'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Applications · OC Infrastructure' })

type ResourceState =
  | 'pending'
  | 'running'
  | 'stopped'
  | 'restarting'
  | 'degraded'
  | 'deleting'
  | 'deleted'
  | 'failed'
  | 'unknown'

type LifecycleAction =
  | 'application.start'
  | 'application.stop'
  | 'application.restart'
  | 'application.redeploy'
  | 'application.delete'

interface ApplicationSpec {
  source: { type: 'image'; reference: string }
  limits: { cpuMilli: number; memoryBytes: string }
  ports: Array<{ containerPort: number; hostPort?: number; protocol: 'tcp' | 'udp' }>
  environment: Record<string, string>
  secretReferences: Record<string, string>
  volumes: Array<{
    name: string
    mountTarget: string
    kind: 'ephemeral' | 'persistent'
  }>
  restartPolicy: 'no' | 'on-failure' | 'unless-stopped'
  healthcheck?: {
    path: string
    port: number
    intervalSeconds: number
    timeoutSeconds: number
  }
}

interface InfrastructureNode {
  id: string
  name: string
  environment: string
  status: 'enrolling' | 'online' | 'degraded' | 'offline' | 'revoked' | 'unknown'
  isActive: boolean
  isDraining: boolean
}

interface InfrastructureResource {
  id: string
  nodeId: string
  nodeName: string
  customerId: string | null
  applicationId: string | null
  releaseId: string | null
  releasePolicy: 'manual' | 'track_latest'
  externalId: string
  kind: 'application' | 'database' | 'volume'
  name: string
  classification: 'billable' | 'internal' | 'ignored'
  desiredState: ResourceState
  observedState: ResourceState
  desiredRevision: number
  observedRevision: number
  imageReference: string | null
  imageDigest: string | null
  routeHostname: string | null
  routeStatus: 'pending' | 'configuring' | 'active' | 'failed' | 'disabled' | null
  billingGateEnabled: boolean | null
  desiredSpec: ApplicationSpec
  lastObservedAt: string | null
  createdAt: string
  updatedAt: string
}

interface OperationResult {
  operation: { id: string; action: string; status: string }
  resource?: InfrastructureResource
  replayed: boolean
}

interface RevealedCredentials {
  resourceId: string
  name: string
  kind: InfrastructureResource['kind']
  environment: Record<string, string>
  ports: Array<{ containerPort: number; hostPort?: number; protocol: string }>
  secrets: Record<string, string>
}

const format = useFormat()
const toast = useToast()
const showCreateForm = ref(false)
const editingResource = ref<InfrastructureResource | null>(null)
const pendingDelete = ref<InfrastructureResource | null>(null)
const pendingCredentialReveal = ref<InfrastructureResource | null>(null)
const revealedCredentials = ref<RevealedCredentials | null>(null)
const visibleSecretKeys = ref<string[]>([])
const revealingCredentials = ref(false)
const credentialMessage = ref<string | null>(null)
const saving = ref(false)
const busyResourceIds = ref<string[]>([])
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)

const form = reactive({
  nodeId: '',
  name: '',
  imageReference: '',
  classification: 'billable' as InfrastructureResource['classification'],
  cpuMilli: 500,
  memoryMiB: 512,
  containerPort: 3000,
  hostPort: 8080,
  healthcheckPath: '',
  restartPolicy: 'unless-stopped' as ApplicationSpec['restartPolicy'],
  environmentText: '',
})

const { data, status, error, refresh } = await useFetch<{ data: InfrastructureResource[] }>(
  '/api/infrastructure/resources',
)
const { data: nodeData, refresh: refreshNodes } = await useFetch<{ data: InfrastructureNode[] }>(
  '/api/infrastructure/nodes',
)

const resources = computed(() => data.value?.data ?? [])
const availableNodes = computed(() =>
  (nodeData.value?.data ?? []).filter(
    (node) =>
      node.isActive && !node.isDraining && (node.status === 'online' || node.status === 'degraded'),
  ),
)
const runningCount = computed(
  () => resources.value.filter((resource) => resource.observedState === 'running').length,
)
const driftCount = computed(
  () =>
    resources.value.filter(
      (resource) =>
        resource.desiredState !== resource.observedState ||
        resource.desiredRevision !== resource.observedRevision,
    ).length,
)

watch(
  availableNodes,
  (nodes) => {
    if (!form.nodeId && nodes[0]) form.nodeId = nodes[0].id
  },
  { immediate: true },
)

function resetForm() {
  Object.assign(form, {
    nodeId: availableNodes.value[0]?.id ?? '',
    name: '',
    imageReference: '',
    classification: 'billable',
    cpuMilli: 500,
    memoryMiB: 512,
    containerPort: 3000,
    hostPort: 8080,
    healthcheckPath: '',
    restartPolicy: 'unless-stopped',
    environmentText: '',
  })
}

function closeCreateForm() {
  showCreateForm.value = false
  editingResource.value = null
  resetForm()
}

function openCreateForm() {
  editingResource.value = null
  resetForm()
  showCreateForm.value = true
}

function openEditForm(resource: InfrastructureResource) {
  const spec = resource.desiredSpec
  const port = spec.ports[0]
  editingResource.value = resource
  Object.assign(form, {
    nodeId: resource.nodeId,
    name: resource.name,
    imageReference: spec.source.reference,
    classification: resource.classification,
    cpuMilli: spec.limits.cpuMilli,
    memoryMiB: Math.round(Number(spec.limits.memoryBytes) / 1024 / 1024),
    containerPort: port?.containerPort ?? 3000,
    hostPort: port?.hostPort ?? 8080,
    healthcheckPath: spec.healthcheck?.path ?? '',
    restartPolicy: spec.restartPolicy,
    environmentText: Object.entries(spec.environment)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  })
  showCreateForm.value = true
}

function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`
}

async function refreshAll() {
  await Promise.all([refresh(), refreshNodes()])
}

function applicationSpec() {
  const existing = editingResource.value?.desiredSpec
  const healthcheckPath = form.healthcheckPath.trim()
  const environment: Record<string, string> = {}
  for (const [index, rawLine] of form.environmentText.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    const key = separator >= 0 ? line.slice(0, separator).trim() : ''
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Environment variable pada baris ${index + 1} tidak valid.`)
    }
    environment[key] = line.slice(separator + 1)
  }
  return {
    source: { type: 'image' as const, reference: form.imageReference.trim() },
    limits: {
      cpuMilli: Number(form.cpuMilli),
      memoryBytes: String(Math.trunc(Number(form.memoryMiB) * 1024 * 1024)),
    },
    ports: form.containerPort
      ? [
          {
            containerPort: Number(form.containerPort),
            hostPort: Number(form.hostPort),
            protocol: 'tcp' as const,
          },
        ]
      : [],
    environment,
    secretReferences: existing?.secretReferences ?? {},
    volumes: existing?.volumes ?? [],
    restartPolicy: form.restartPolicy,
    ...(healthcheckPath
      ? {
          healthcheck: {
            path: healthcheckPath,
            port: Number(form.containerPort),
            intervalSeconds: existing?.healthcheck?.intervalSeconds ?? 30,
            timeoutSeconds: existing?.healthcheck?.timeoutSeconds ?? 5,
          },
        }
      : {}),
  }
}

async function submitApplication() {
  saving.value = true
  actionMessage.value = null
  actionError.value = null

  try {
    const currentResource = editingResource.value
    const endpoint = currentResource
      ? `/api/infrastructure/resources/${currentResource.id}`
      : '/api/infrastructure/resources'
    const response = await $fetch<{ data: OperationResult }>(endpoint, {
      method: currentResource ? 'PATCH' : 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey(
          currentResource ? 'application-update' : 'application-create',
        ),
      },
      body: {
        ...(currentResource ? {} : { nodeId: form.nodeId }),
        name: form.name.trim(),
        classification: form.classification,
        spec: applicationSpec(),
      },
    })

    actionMessage.value = `${currentResource ? 'Update dan redeploy' : 'Deploy'} ${form.name} masuk antrean (${response.data.operation.id.slice(0, 8)}).`
    closeCreateForm()
    await refresh()
  } catch (caught) {
    actionError.value =
      caught instanceof Error && caught.message.startsWith('Environment variable')
        ? caught.message
        : apiErrorMessage(caught, 'Gagal menyimpan konfigurasi aplikasi.')
  } finally {
    saving.value = false
  }
}

function isBusy(resourceId: string) {
  return busyResourceIds.value.includes(resourceId)
}

async function runLifecycle(resource: InfrastructureResource, action: LifecycleAction) {
  busyResourceIds.value = [...busyResourceIds.value, resource.id]
  actionMessage.value = null
  actionError.value = null

  try {
    const response = await $fetch<{ data: OperationResult }>(
      `/api/infrastructure/resources/${resource.id}/operations`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(action.replace('.', '-')) },
        body: { action },
      },
    )
    actionMessage.value = `${actionLabel(action)} ${resource.name} masuk antrean (${response.data.operation.id.slice(0, 8)}).`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, `Gagal menjalankan ${actionLabel(action)}.`)
  } finally {
    busyResourceIds.value = busyResourceIds.value.filter((id) => id !== resource.id)
  }
}

function requestLifecycle(resource: InfrastructureResource, action: LifecycleAction) {
  if (action === 'application.delete') {
    pendingDelete.value = resource
    return
  }
  void runLifecycle(resource, action)
}

async function confirmDelete() {
  const resource = pendingDelete.value
  if (!resource) return
  await runLifecycle(resource, 'application.delete')
  pendingDelete.value = null
}

function actionLabel(action: LifecycleAction) {
  return {
    'application.start': 'Start',
    'application.stop': 'Stop',
    'application.restart': 'Restart',
    'application.redeploy': 'Redeploy',
    'application.delete': 'Delete',
  }[action]
}

function stateTone(state: ResourceState) {
  if (state === 'running') return 'success' as const
  if (state === 'degraded' || state === 'pending' || state === 'restarting')
    return 'warning' as const
  if (state === 'failed' || state === 'deleting') return 'danger' as const
  return 'neutral' as const
}

async function revealResourceCredentials() {
  const resource = pendingCredentialReveal.value
  if (!resource) return
  revealingCredentials.value = true
  actionError.value = null
  credentialMessage.value = null
  try {
    const response = await $fetch<{ data: RevealedCredentials }>(
      `/api/infrastructure/resources/${resource.id}/secrets/reveal`,
      { method: 'POST' },
    )
    revealedCredentials.value = response.data
    visibleSecretKeys.value = []
    pendingCredentialReveal.value = null
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Credentials resource gagal dibuka.')
    pendingCredentialReveal.value = null
  } finally {
    revealingCredentials.value = false
  }
}

function closeCredentials() {
  if (revealedCredentials.value) {
    for (const key of Object.keys(revealedCredentials.value.secrets)) {
      revealedCredentials.value.secrets[key] = ''
    }
  }
  revealedCredentials.value = null
  visibleSecretKeys.value = []
  credentialMessage.value = null
}

function toggleSecretVisibility(key: string) {
  visibleSecretKeys.value = visibleSecretKeys.value.includes(key)
    ? visibleSecretKeys.value.filter((item) => item !== key)
    : [...visibleSecretKeys.value, key]
}

async function copyCredential(key: string, value: string) {
  try {
    await copyText(value)
    credentialMessage.value = `${key} disalin ke clipboard.`
    toast.success(`${key} berhasil disalin.`)
  } catch {
    credentialMessage.value =
      'Browser tidak dapat menyalin credential. Tampilkan lalu salin manual.'
    toast.error('Browser tidak dapat menyalin credential. Salin secara manual.')
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / applications
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Native Applications</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Desired state disimpan di control plane. OC Agent pada node Ubuntu mengambil operasi
          melalui HTTPS dan menjalankannya secara asynchronous di Docker.
        </p>
      </div>
      <div class="flex gap-2">
        <UiRefreshButton :action="refreshAll" :pending="status === 'pending'" />
        <UiButton :disabled="availableNodes.length === 0" @click="openCreateForm">
          <Plus :size="15" aria-hidden="true" />
          Deploy image
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

    <div class="mb-5 grid gap-4 sm:grid-cols-3">
      <UiStat label="Applications" :value="format.count(resources.length)" detail="Managed by OC" />
      <UiStat
        label="Running"
        :value="format.count(runningCount)"
        detail="Observed by agent"
        tone="success"
      />
      <UiStat
        label="Drift / pending"
        :value="format.count(driftCount)"
        detail="Desired belum sama dengan observed"
        :tone="driftCount > 0 ? 'warning' : 'neutral'"
      />
    </div>

    <UiCard v-if="status === 'pending'" :padded="false">
      <div class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="3.5rem" />
      </div>
    </UiCard>

    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Gagal memuat applications"
        description="Control plane tidak dapat membaca resource native."
      >
        <UiButton variant="secondary" size="sm" @click="refresh">Coba lagi</UiButton>
      </UiEmptyState>
    </UiCard>

    <UiCard v-else-if="resources.length === 0" :padded="false">
      <UiEmptyState
        title="Belum ada aplikasi native"
        :description="
          availableNodes.length > 0
            ? 'Deploy image container pertama ke node Ubuntu yang aktif.'
            : 'Enroll dan jalankan OC Agent pada node Ubuntu terlebih dahulu.'
        "
      >
        <UiButton v-if="availableNodes.length > 0" size="sm" @click="openCreateForm">
          Deploy image
        </UiButton>
      </UiEmptyState>
    </UiCard>

    <UiCard v-else :padded="false">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[980px] text-left text-sm">
          <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
            <tr>
              <th class="px-4 py-3 font-semibold">Resource</th>
              <th class="px-4 py-3 font-semibold">Node</th>
              <th class="px-4 py-3 font-semibold">Desired</th>
              <th class="px-4 py-3 font-semibold">Observed</th>
              <th class="px-4 py-3 font-semibold">Revision</th>
              <th class="px-4 py-3 font-semibold">Last observed</th>
              <th class="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="resource in resources"
              :key="resource.id"
              class="border-b last:border-0 hover:bg-surface-raised/60"
            >
              <td class="px-4 py-3">
                <div class="flex items-start gap-2.5">
                  <Box class="mt-0.5 shrink-0 text-muted" :size="15" aria-hidden="true" />
                  <div class="min-w-0">
                    <span class="block font-medium text-ink">{{ resource.name }}</span>
                    <span class="block max-w-72 truncate font-mono text-[11px] text-muted">
                      {{ resource.imageReference || resource.externalId }}
                    </span>
                    <span
                      v-if="resource.applicationId"
                      class="mt-1 block text-[10px] font-semibold tracking-wide text-brand uppercase"
                    >
                      Application ·
                      {{ resource.releasePolicy === 'track_latest' ? 'track latest' : 'manual' }}
                    </span>
                    <a
                      v-if="resource.routeHostname"
                      class="mt-1 block max-w-72 truncate font-mono text-[11px] text-brand hover:underline"
                      :href="`https://${resource.routeHostname}`"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {{ resource.routeHostname }} · {{ resource.routeStatus }}
                    </a>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3 text-xs text-muted">{{ resource.nodeName }}</td>
              <td class="px-4 py-3">
                <UiBadge :tone="stateTone(resource.desiredState)" dot>
                  {{ resource.desiredState }}
                </UiBadge>
              </td>
              <td class="px-4 py-3">
                <UiBadge :tone="stateTone(resource.observedState)" dot>
                  {{ resource.observedState }}
                </UiBadge>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-muted">
                {{ resource.observedRevision }} / {{ resource.desiredRevision }}
              </td>
              <td class="px-4 py-3 text-xs text-muted">
                {{ format.dateTime(resource.lastObservedAt) }}
              </td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-1">
                  <UiButton
                    v-if="Object.keys(resource.desiredSpec.secretReferences).length > 0"
                    variant="ghost"
                    size="sm"
                    :disabled="isBusy(resource.id)"
                    aria-label="Lihat credentials"
                    title="Lihat credentials"
                    @click="pendingCredentialReveal = resource"
                  >
                    <KeyRound :size="14" aria-hidden="true" />
                  </UiButton>
                  <UiButton
                    v-if="resource.kind === 'application'"
                    variant="ghost"
                    size="sm"
                    :disabled="isBusy(resource.id)"
                    aria-label="Edit resource configuration"
                    @click="openEditForm(resource)"
                  >
                    <Pencil :size="14" aria-hidden="true" />
                  </UiButton>
                  <UiButton
                    v-if="resource.desiredState === 'stopped'"
                    variant="ghost"
                    size="sm"
                    :disabled="isBusy(resource.id)"
                    aria-label="Start application"
                    @click="requestLifecycle(resource, 'application.start')"
                  >
                    <Play :size="14" aria-hidden="true" />
                  </UiButton>
                  <UiButton
                    v-else
                    variant="ghost"
                    size="sm"
                    :disabled="isBusy(resource.id)"
                    aria-label="Stop application"
                    @click="requestLifecycle(resource, 'application.stop')"
                  >
                    <Pause :size="14" aria-hidden="true" />
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="isBusy(resource.id)"
                    aria-label="Restart application"
                    @click="requestLifecycle(resource, 'application.restart')"
                  >
                    <RotateCw :size="14" aria-hidden="true" />
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    :disabled="isBusy(resource.id)"
                    aria-label="Redeploy application"
                    @click="requestLifecycle(resource, 'application.redeploy')"
                  >
                    Redeploy
                  </UiButton>
                  <UiButton
                    variant="danger"
                    size="sm"
                    :disabled="isBusy(resource.id)"
                    aria-label="Delete application"
                    @click="requestLifecycle(resource, 'application.delete')"
                  >
                    <Trash2 :size="14" aria-hidden="true" />
                  </UiButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>

    <UiDialog
      v-if="showCreateForm"
      :title="editingResource ? `Edit ${editingResource.name}` : 'Deploy container image'"
      :description="
        editingResource
          ? 'Perubahan desired state akan disimpan dan aplikasi otomatis di-redeploy oleh OC Agent.'
          : 'Operasi akan masuk antrean dan diambil oleh OC Agent pada node Ubuntu.'
      "
      size="lg"
      :close-disabled="saving"
      @close="closeCreateForm"
    >
      <form
        id="create-application-form"
        class="grid gap-4 sm:grid-cols-2"
        @submit.prevent="submitApplication"
      >
        <UiInput
          v-model="form.name"
          label="Nama aplikasi"
          placeholder="customer-portal"
          pattern="[a-z0-9][a-z0-9-]*"
          hint="Slug lowercase; contoh: customer-portal"
          required
          autofocus
        />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Node Ubuntu</span>
          <select
            v-model="form.nodeId"
            :disabled="Boolean(editingResource)"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            required
          >
            <option v-for="node in availableNodes" :key="node.id" :value="node.id">
              {{ node.name }} · {{ node.environment }} · {{ node.status }}
            </option>
          </select>
        </label>
        <UiInput
          v-model="form.imageReference"
          class="sm:col-span-2"
          label="Container image"
          placeholder="ghcr.io/acme/customer-portal:1.0.0"
          hint="Gunakan tag immutable atau digest untuk deployment yang dapat direproduksi."
          required
        />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Classification</span>
          <select
            v-model="form.classification"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="billable">Billable</option>
            <option value="internal">Internal</option>
            <option value="ignored">Ignored</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Restart policy</span>
          <select
            v-model="form.restartPolicy"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="unless-stopped">Unless stopped</option>
            <option value="on-failure">On failure</option>
            <option value="no">No restart</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Container port</span>
          <input
            v-model.number="form.containerPort"
            type="number"
            min="1"
            max="65535"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          />
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Host port (development)</span>
          <input
            v-model.number="form.hostPort"
            type="number"
            min="1"
            max="65535"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          />
          <span class="mt-1.5 block text-xs text-muted">
            Akses langsung melalui IP server. Gunakan Traefik untuk staging/production.
          </span>
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">CPU limit (millicore)</span>
          <input
            v-model.number="form.cpuMilli"
            type="number"
            min="50"
            max="128000"
            step="50"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          />
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Memory limit (MiB)</span>
          <input
            v-model.number="form.memoryMiB"
            type="number"
            min="16"
            step="16"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          />
        </label>
        <UiInput
          v-model="form.healthcheckPath"
          class="sm:col-span-2"
          label="Healthcheck path (opsional)"
          placeholder="/health"
          pattern="/[A-Za-z0-9._~/%-]*"
        />
        <label class="block sm:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">
            Environment variables non-secret
          </span>
          <textarea
            v-model="form.environmentText"
            rows="5"
            maxlength="32768"
            spellcheck="false"
            placeholder="NODE_ENV=production&#10;PUBLIC_API_URL=https://api.example.com"
            class="focus-ring w-full resize-y rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-sm text-ink"
          />
          <span class="mt-1.5 block text-xs text-muted">
            Satu KEY=value per baris. Jangan masukkan password atau token; secret references yang
            sudah ada tetap dipertahankan.
          </span>
        </label>
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="closeCreateForm">
            <X :size="14" aria-hidden="true" />
            Batal
          </UiButton>
          <UiButton type="submit" form="create-application-form" :disabled="saving">
            {{ saving ? 'Mengantrekan…' : editingResource ? 'Simpan & redeploy' : 'Deploy image' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiConfirmDialog
      v-if="pendingCredentialReveal"
      :title="`Tampilkan credentials ${pendingCredentialReveal.name}?`"
      description="Nilai secret akan didekripsi dan ditampilkan sementara pada browser ini. Tindakan dicatat di audit log tanpa menyimpan nilai plaintext."
      confirm-label="Tampilkan credentials"
      :pending="revealingCredentials"
      @confirm="revealResourceCredentials"
      @cancel="pendingCredentialReveal = null"
    />

    <UiDialog
      v-if="revealedCredentials"
      :title="`Credentials ${revealedCredentials.name}`"
      description="Secret hanya berada sementara di memori halaman. Tutup dialog setelah selesai digunakan."
      size="lg"
      @close="closeCredentials"
    >
      <div class="space-y-5">
        <p
          v-if="credentialMessage"
          class="rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
          role="status"
        >
          {{ credentialMessage }}
        </p>

        <div v-if="Object.keys(revealedCredentials.environment).length">
          <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            Database configuration
          </h3>
          <dl class="divide-y rounded-md border border-line-strong">
            <div
              v-for="(value, key) in revealedCredentials.environment"
              :key="key"
              class="grid gap-1 px-3 py-2 sm:grid-cols-[12rem_1fr]"
            >
              <dt class="font-mono text-xs text-muted">{{ key }}</dt>
              <dd class="break-all font-mono text-sm text-ink">{{ value }}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Secrets</h3>
          <div class="space-y-3">
            <label v-for="(value, key) in revealedCredentials.secrets" :key="key" class="block">
              <span class="mb-1.5 block font-mono text-xs text-muted">{{ key }}</span>
              <span class="flex items-center gap-2">
                <input
                  :type="visibleSecretKeys.includes(String(key)) ? 'text' : 'password'"
                  :value="value"
                  readonly
                  autocomplete="off"
                  class="focus-ring h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm text-ink"
                />
                <UiButton
                  variant="secondary"
                  size="sm"
                  :aria-label="
                    visibleSecretKeys.includes(String(key))
                      ? 'Sembunyikan secret'
                      : 'Tampilkan secret'
                  "
                  @click="toggleSecretVisibility(String(key))"
                >
                  <EyeOff v-if="visibleSecretKeys.includes(String(key))" :size="14" />
                  <Eye v-else :size="14" />
                </UiButton>
                <UiButton
                  variant="secondary"
                  size="sm"
                  aria-label="Salin secret"
                  @click="copyCredential(String(key), value)"
                >
                  <Copy :size="14" />
                </UiButton>
              </span>
            </label>
          </div>
        </div>

        <p class="text-xs leading-5 text-warning">
          Clipboard berada di luar kontrol aplikasi. Jangan tempelkan credential ke chat, log, atau
          repository.
        </p>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <UiButton variant="secondary" @click="closeCredentials">Tutup dan bersihkan</UiButton>
        </div>
      </template>
    </UiDialog>

    <UiConfirmDialog
      v-if="pendingDelete"
      :title="`Hapus ${pendingDelete.name}?`"
      description="Container akan dihapus dari node. Persistent volume tetap dipertahankan sesuai kebijakan resource."
      confirm-label="Hapus aplikasi"
      destructive
      :pending="isBusy(pendingDelete.id)"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>
