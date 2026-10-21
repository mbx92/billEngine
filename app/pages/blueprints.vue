<script setup lang="ts">
import { Box, Database, KeyRound, Pencil, Rocket, Server } from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth', alias: ['/templates'] })
useHead({ title: 'Templates · Billing Infra' })
const runtimeConfig = useRuntimeConfig()
const format = useFormat()

interface TemplateParameter {
  key: string
  label: string
  environmentKey: string
  type: 'string' | 'secret'
  required: boolean
  generated: boolean
  defaultValue?: string
  help?: string
}

interface InfrastructureTemplate {
  id: string
  slug: string
  name: string
  description: string | null
  category: 'application' | 'database' | 'cache'
  version: number
  applicationId: string | null
  releasePolicy: 'manual' | 'track_latest'
  isBuiltin: boolean
  resolvedRelease: {
    id: string
    version: string
    commitSha: string
    imageDigest: string
    imageReference: string
    localNodeId: string | null
  } | null
  definition: {
    engine: 'generic' | 'postgresql' | 'mysql' | 'redis'
    resourceKind: 'application' | 'database'
    spec: {
      secretDelivery?: 'files' | 'environment'
      source: { type: 'image'; reference: string }
      limits: { cpuMilli: number; memoryBytes: string }
      ports: Array<{ containerPort: number; protocol: 'tcp' | 'udp' }>
      volumes: Array<{ name: string; mountTarget: string; kind: 'ephemeral' | 'persistent' }>
      restartPolicy: 'no' | 'on-failure' | 'unless-stopped'
      healthcheck?: { path: string; port: number }
    }
    parameters: TemplateParameter[]
  }
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
  capabilities: string[]
  gatewayStatus: 'pending' | 'installing' | 'healthy' | 'failed' | 'unknown'
  lastInventoryAt: string | null
  networks: NodeNetwork[]
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

interface ServiceOption {
  id: string
  serviceNumber: string
  name: string
  customerName: string
  status: 'active' | 'suspended' | 'cancelled'
}

interface ManagedDatabaseCluster {
  id: string
  name: string
  status: 'validating' | 'active' | 'degraded' | 'offline' | 'maintenance' | 'retired'
  isActive: boolean
  resourceState: string
  nodeId: string
  nodeName: string
  nodeStatus: string
  agentVersion: string | null
}

const [
  { data: templateResponse, status, error, refresh },
  { data: nodeResponse },
  { data: serviceResponse },
  { data: databaseClusterResponse },
] = await Promise.all([
  useFetch<{ data: InfrastructureTemplate[] }>('/api/infrastructure/templates'),
  useFetch<{ data: InfrastructureNode[] }>('/api/infrastructure/nodes'),
  useFetch<{ data: ServiceOption[] }>('/api/services', { query: { page: 1, perPage: 100 } }),
  useFetch<{ data: { clusters: ManagedDatabaseCluster[] } }>(
    '/api/infrastructure/database-clusters',
  ),
])

const templates = computed(() => templateResponse.value?.data ?? [])
const templateSections = computed(() =>
  [
    {
      key: 'application',
      title: 'Application dari repository',
      description:
        'Template runtime yang dibuat dari Application dan selalu memakai release hasil build repository.',
      items: templates.value.filter((template) => Boolean(template.applicationId)),
    },
    {
      key: 'native',
      title: 'Template native',
      description:
        'Service bawaan yang dapat langsung dideploy tanpa membuat Application atau release terlebih dahulu.',
      items: templates.value.filter((template) => !template.applicationId),
    },
  ].filter((section) => section.items.length > 0),
)
const nodes = computed(() =>
  (nodeResponse.value?.data ?? []).filter(
    (node) =>
      node.isActive &&
      !node.isDraining &&
      node.role !== 'builder' &&
      ['online', 'degraded'].includes(node.status) &&
      supportsTemplateSecrets(node.agentVersion),
  ),
)
const services = computed(() =>
  (serviceResponse.value?.data ?? []).filter((service) => service.status !== 'cancelled'),
)
const platformDomain = computed(() => String(runtimeConfig.public.platformDomain || ''))
const selectedTemplate = ref<InfrastructureTemplate | null>(null)
const editingTemplate = ref<InfrastructureTemplate | null>(null)
const deploying = ref(false)
const savingTemplate = ref(false)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
const form = reactive({
  nodeId: '',
  serviceId: '',
  name: '',
  subdomain: '',
  hostPort: '',
  networkName: 'oc-private',
  classification: 'internal' as 'billable' | 'internal' | 'ignored',
  exposure: 'domain' as 'domain' | 'port',
  databaseMode: 'external' as 'managed' | 'external',
  databaseClusterId: '',
  databaseEnvironmentKey: 'DATABASE_URL',
  values: {} as Record<string, string>,
})
const editForm = reactive({
  name: '',
  slug: '',
  description: '',
  cpuMilli: '500',
  memoryMiB: '512',
  containerPort: '3000',
  restartPolicy: 'unless-stopped' as 'no' | 'on-failure' | 'unless-stopped',
  healthcheckPath: '',
  environmentKeysText: '',
  secretKeysText: '',
  secretDelivery: 'environment' as 'files' | 'environment',
  volumeName: '',
  volumeMountTarget: '',
  trackLatest: true,
})

const selectedDatabaseParameter = computed(() =>
  selectedTemplate.value?.definition.parameters.find(
    (parameter) => parameter.environmentKey === 'DATABASE_URL',
  ),
)
const selectedNode = computed(() => nodes.value.find((node) => node.id === form.nodeId))
const reportedNetworks = computed<NodeNetwork[]>(() => selectedNode.value?.networks ?? [])

function isDeployableNetwork(network: NodeNetwork) {
  return (
    network.driver === 'bridge' &&
    network.scope === 'local' &&
    !['bridge', 'host', 'none'].includes(network.name)
  )
}

const deploymentNetworks = computed<NodeNetwork[]>(() => {
  const networks = reportedNetworks.value.filter(isDeployableNetwork)
  if (!networks.some((network) => network.name === 'oc-private')) {
    networks.unshift({
      id: 'managed:oc-private',
      name: 'oc-private',
      driver: 'bridge',
      scope: 'local',
      internal: false,
      attachable: false,
      managed: true,
      containerCount: 0,
    })
  }
  return networks
})

const availableDatabaseClusters = computed(() =>
  selectedTemplate.value ? databaseClustersForTemplate(selectedTemplate.value) : [],
)

function openDeploy(template: InfrastructureTemplate) {
  actionMessage.value = null
  actionError.value = null
  selectedTemplate.value = template
  form.exposure = template.resolvedRelease?.localNodeId ? 'port' : 'domain'
  form.nodeId = nodesForTemplate(template)[0]?.id ?? ''
  form.serviceId = ''
  form.name = `${template.slug}-01`
  form.subdomain = `${template.slug}-01`
  form.hostPort = String(defaultHostPort(template))
  form.networkName = 'oc-private'
  form.classification = 'internal'
  const databaseParameter = template.definition.parameters.find(
    (parameter) => parameter.environmentKey === 'DATABASE_URL',
  )
  const databaseCluster = databaseClustersForTemplate(template)[0]
  form.databaseMode = databaseParameter && databaseCluster ? 'managed' : 'external'
  form.databaseClusterId = databaseParameter && databaseCluster ? databaseCluster.id : ''
  form.databaseEnvironmentKey = databaseParameter?.environmentKey ?? 'DATABASE_URL'
  if (form.databaseMode === 'managed' && databaseCluster) form.nodeId = databaseCluster.nodeId
  form.values = Object.fromEntries(
    template.definition.parameters.map((parameter) => [
      parameter.key,
      parameter.defaultValue ?? '',
    ]),
  )
}

function openEdit(template: InfrastructureTemplate) {
  actionMessage.value = null
  actionError.value = null
  editingTemplate.value = template
  const volume = template.definition.spec.volumes[0]
  Object.assign(editForm, {
    name: template.name,
    slug: template.slug,
    description: template.description ?? '',
    cpuMilli: String(template.definition.spec.limits.cpuMilli),
    memoryMiB: String(Math.round(Number(template.definition.spec.limits.memoryBytes) / 1024 / 1024)),
    containerPort: String(template.definition.spec.ports[0]?.containerPort ?? 3000),
    restartPolicy: template.definition.spec.restartPolicy,
    healthcheckPath: template.definition.spec.healthcheck?.path ?? '',
    environmentKeysText: template.definition.parameters
      .filter((parameter) => parameter.type === 'string')
      .map((parameter) => parameter.environmentKey)
      .join('\n'),
    secretKeysText: template.definition.parameters
      .filter((parameter) => parameter.type === 'secret')
      .map((parameter) => parameter.environmentKey)
      .join('\n'),
    secretDelivery: template.definition.spec.secretDelivery ?? 'files',
    volumeName: volume?.name ?? '',
    volumeMountTarget: volume?.mountTarget ?? '',
    trackLatest: template.releasePolicy === 'track_latest',
  })
}

function parseEnvironmentKeys(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n|,/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ]
}

async function updateTemplate() {
  if (!editingTemplate.value) return
  savingTemplate.value = true
  actionMessage.value = null
  actionError.value = null
  const template = editingTemplate.value
  try {
    await $fetch(`/api/infrastructure/templates/${template.id}`, {
      method: 'PATCH',
      body: {
        name: editForm.name,
        slug: editForm.slug,
        description: editForm.description || undefined,
        cpuMilli: Number(editForm.cpuMilli),
        memoryMiB: Number(editForm.memoryMiB),
        containerPort: Number(editForm.containerPort),
        restartPolicy: editForm.restartPolicy,
        healthcheckPath: editForm.healthcheckPath || undefined,
        environmentKeys: parseEnvironmentKeys(editForm.environmentKeysText),
        secretKeys: parseEnvironmentKeys(editForm.secretKeysText),
        secretDelivery: editForm.secretDelivery,
        ...(editForm.volumeName && editForm.volumeMountTarget
          ? {
              volume: {
                name: editForm.volumeName,
                mountTarget: editForm.volumeMountTarget,
              },
            }
          : {}),
        trackLatest: editForm.trackLatest,
      },
    })
    editingTemplate.value = null
    actionMessage.value = `Template ${editForm.name} berhasil diperbarui.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal memperbarui template.')
  } finally {
    savingTemplate.value = false
  }
}

function databaseClustersForTemplate(template: InfrastructureTemplate) {
  const eligibleNodeIds = new Set(nodesForTemplate(template).map((node) => node.id))
  return (databaseClusterResponse.value?.data.clusters ?? []).filter(
    (cluster) =>
      cluster.isActive &&
      cluster.status === 'active' &&
      cluster.resourceState === 'running' &&
      ['online', 'degraded'].includes(cluster.nodeStatus) &&
      supportsDatabaseProvisioning(cluster.agentVersion) &&
      eligibleNodeIds.has(cluster.nodeId),
  )
}

function visibleTemplateParameters(template: InfrastructureTemplate) {
  if (form.databaseMode !== 'managed') return template.definition.parameters
  return template.definition.parameters.filter(
    (parameter) => parameter.environmentKey !== form.databaseEnvironmentKey,
  )
}

function nodesForTemplate(template: InfrastructureTemplate) {
  const eligible = template.resolvedRelease?.localNodeId
    ? nodes.value.filter(
        (node) =>
          node.id === template.resolvedRelease?.localNodeId &&
          node.capabilities.includes('local-image-build'),
      )
    : nodes.value
  const secretCompatible = eligible.filter(
    (node) =>
      template.definition.spec.secretDelivery !== 'environment' ||
      node.capabilities.includes('secret-environment'),
  )
  const compatible = template.applicationId
    ? secretCompatible.filter((node) => supportsApplicationRegistry(node.agentVersion))
    : secretCompatible
  const useGateway =
    template.definition.resourceKind === 'application' &&
    (selectedTemplate.value?.id === template.id
      ? form.exposure === 'domain'
      : !template.resolvedRelease?.localNodeId)
  return useGateway
    ? compatible.filter(
        (node) => supportsGatewayRoutes(node.agentVersion) && node.gatewayStatus === 'healthy',
      )
    : compatible
}

function defaultHostPort(template: InfrastructureTemplate) {
  if (template.definition.engine === 'postgresql') return 5432
  if (template.definition.engine === 'mysql') return 3306
  if (template.definition.engine === 'redis') return 6379
  return template.definition.spec.ports[0]?.containerPort ?? 3000
}

watch(
  () => form.nodeId,
  () => {
    if (!deploymentNetworks.value.some((network) => network.name === form.networkName)) {
      form.networkName = 'oc-private'
    }
  },
)

watch(
  () => form.exposure,
  (exposure) => {
    if (exposure === 'port' && form.classification === 'billable') form.classification = 'internal'
    if (selectedTemplate.value && form.databaseMode === 'managed') {
      const current = availableDatabaseClusters.value.find(
        (cluster) => cluster.id === form.databaseClusterId,
      )
      const cluster = current ?? availableDatabaseClusters.value[0]
      if (!cluster) {
        form.databaseMode = 'external'
        form.databaseClusterId = ''
      } else {
        form.databaseClusterId = cluster.id
        form.nodeId = cluster.nodeId
      }
    }
    if (
      selectedTemplate.value &&
      !nodesForTemplate(selectedTemplate.value).some((node) => node.id === form.nodeId)
    ) {
      form.nodeId = nodesForTemplate(selectedTemplate.value)[0]?.id ?? ''
    }
  },
)

watch(
  () => form.databaseClusterId,
  (clusterId) => {
    if (form.databaseMode !== 'managed') return
    const cluster = availableDatabaseClusters.value.find((item) => item.id === clusterId)
    if (cluster) form.nodeId = cluster.nodeId
  },
)

watch(
  () => form.databaseMode,
  (mode) => {
    if (mode !== 'managed') return
    const current = availableDatabaseClusters.value.find(
      (cluster) => cluster.id === form.databaseClusterId,
    )
    const cluster = current ?? availableDatabaseClusters.value[0]
    form.databaseClusterId = cluster?.id ?? ''
    if (cluster) form.nodeId = cluster.nodeId
  },
)

watch(
  () => form.classification,
  (classification) => {
    if (classification !== 'billable') form.serviceId = ''
  },
)

async function deployTemplate() {
  if (!selectedTemplate.value) return
  deploying.value = true
  actionMessage.value = null
  actionError.value = null
  const template = selectedTemplate.value
  try {
    await $fetch(`/api/infrastructure/templates/${template.id}/deploy`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `template:${template.id}:${crypto.randomUUID()}` },
      body: {
        nodeId: form.nodeId,
        networkName: form.networkName,
        serviceId: form.serviceId || undefined,
        name: form.name,
        subdomain: template.definition.resourceKind === 'application' ? form.subdomain : undefined,
        exposure: form.exposure,
        hostPort:
          template.definition.resourceKind === 'application' && form.exposure === 'domain'
            ? undefined
            : Number(form.hostPort),
        classification: form.classification,
        managedDatabase:
          selectedDatabaseParameter.value && form.databaseMode === 'managed'
            ? {
                clusterId: form.databaseClusterId,
                environmentKey: form.databaseEnvironmentKey,
              }
            : undefined,
        values: form.values,
      },
    })
    selectedTemplate.value = null
    actionMessage.value =
      template.definition.resourceKind === 'application' && form.exposure === 'domain'
        ? `${template.name} sedang dideploy. ${form.subdomain}.${platformDomain.value} akan diaktifkan setelah container berhasil.`
        : `${template.name} sedang dideploy. Progresnya dapat dilihat di halaman Resources.`
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Template gagal dideploy.')
  } finally {
    deploying.value = false
  }
}

function categoryLabel(category: InfrastructureTemplate['category']) {
  if (category === 'database') return 'Database'
  if (category === 'cache') return 'Cache'
  return 'Application'
}

function supportsTemplateSecrets(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 3
}

function supportsApplicationRegistry(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 6
}

function supportsGatewayRoutes(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  return major > 0 || minor > 7 || (minor === 7 && patch >= 2)
}

function supportsDatabaseProvisioning(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 5
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / Templates
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Deployment Templates</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Deploy service yang sama berkali-kali ke Ubuntu node. Setiap deployment memperoleh
          konfigurasi, secret, container, dan volume persisten yang terpisah.
        </p>
      </div>
      <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
    </header>

    <p
      v-if="actionMessage"
      class="mb-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
    >
      {{ actionMessage }}
      <NuxtLink to="/deployments" class="ml-2 font-semibold underline">
        Lihat deployment log
      </NuxtLink>
    </p>
    <p
      v-if="actionError"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>
    <p
      v-if="status !== 'pending' && !nodes.length"
      class="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      Template database membutuhkan OC Agent 0.3.0 atau lebih baru. Buka halaman Nodes lalu jalankan
      kembali perintah installer pada server; identity node lama tetap digunakan.
    </p>

    <div v-if="status === 'pending'" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <UiSkeleton v-for="item in 3" :key="item" height="17rem" />
    </div>
    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Template gagal dimuat"
        description="Pastikan migration database terbaru sudah dijalankan."
      />
    </UiCard>
    <UiCard v-else-if="!templates.length" :padded="false">
      <UiEmptyState title="Belum ada template" description="Jalankan migration database terbaru." />
    </UiCard>
    <div v-else class="space-y-8">
      <section
        v-for="(section, sectionIndex) in templateSections"
        :key="section.key"
        :class="sectionIndex > 0 ? 'border-t border-line pt-8' : ''"
      >
        <div class="mb-4">
          <h2 class="text-base font-semibold text-ink">{{ section.title }}</h2>
          <p class="mt-1 text-sm text-muted">{{ section.description }}</p>
        </div>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <UiCard v-for="template in section.items" :key="template.id">
            <div class="flex items-start justify-between gap-4">
              <div
                class="flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand"
              >
                <Database v-if="template.category === 'database'" :size="20" />
                <Box v-else :size="20" />
              </div>
              <div class="flex gap-2">
                <UiBadge tone="info">{{ categoryLabel(template.category) }}</UiBadge>
                <UiBadge v-if="template.applicationId" tone="success">Application</UiBadge>
                <UiBadge v-if="template.isBuiltin" tone="neutral">Built-in</UiBadge>
              </div>
            </div>
            <h3 class="mt-4 text-base font-semibold text-ink">{{ template.name }}</h3>
            <p class="mt-1 min-h-10 text-sm leading-5 text-muted">{{ template.description }}</p>
            <dl class="mt-4 space-y-2 border-t pt-4 text-xs">
              <div class="flex justify-between gap-3">
                <dt class="text-muted">Image</dt>
                <dd class="truncate font-mono text-ink">
                  {{ template.definition.spec.source.reference }}
                </dd>
              </div>
              <div v-if="template.resolvedRelease" class="flex justify-between gap-3">
                <dt class="text-muted">Release</dt>
                <dd class="font-mono text-ink">
                  {{ template.resolvedRelease.version }} ·
                  {{
                    template.releasePolicy === 'track_latest'
                      ? 'track latest'
                      : 'pinned after deploy'
                  }}
                </dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted">Container port</dt>
                <dd class="font-mono text-ink">
                  {{ template.definition.spec.ports[0]?.containerPort ?? '—' }}
                </dd>
              </div>
              <div class="flex justify-between gap-3">
                <dt class="text-muted">Storage</dt>
                <dd class="text-ink">
                  {{ template.definition.spec.volumes.length ? 'Persistent volume' : 'Ephemeral' }}
                </dd>
              </div>
            </dl>
            <div class="mt-5 flex gap-2">
              <UiButton
                v-if="template.applicationId && !template.isBuiltin"
                variant="secondary"
                aria-label="Edit template"
                title="Edit template"
                @click="openEdit(template)"
              >
                <Pencil :size="15" /> Edit
              </UiButton>
              <UiButton
                class="flex-1"
                :disabled="
                  !nodesForTemplate(template).length ||
                  (Boolean(template.applicationId) && !template.resolvedRelease)
                "
                @click="openDeploy(template)"
              >
                <Rocket :size="15" /> Deploy
              </UiButton>
            </div>
          </UiCard>
        </div>
      </section>
    </div>

    <UiDialog
      v-if="editingTemplate"
      :title="`Edit ${editingTemplate.name}`"
      description="Perubahan berlaku untuk deployment baru. Resource yang sudah berjalan tetap memakai konfigurasi sebelumnya."
      size="lg"
      :close-disabled="savingTemplate"
      @close="editingTemplate = null"
    >
      <form id="template-edit-form" class="space-y-5" @submit.prevent="updateTemplate">
        <div class="grid gap-4 md:grid-cols-2">
          <UiInput v-model="editForm.name" label="Nama template" required />
          <UiInput
            v-model="editForm.slug"
            label="Slug template"
            required
            pattern="[a-z0-9][a-z0-9-]*"
          />
          <UiInput v-model="editForm.description" class="md:col-span-2" label="Deskripsi" />
          <UiInput
            v-model="editForm.cpuMilli"
            label="CPU (millicore)"
            type="number"
            min="50"
            required
          />
          <UiInput
            v-model="editForm.memoryMiB"
            label="Memory (MiB)"
            type="number"
            min="16"
            required
          />
          <UiInput
            v-model="editForm.containerPort"
            label="Container port"
            type="number"
            min="1"
            max="65535"
            required
          />
          <UiInput
            v-model="editForm.healthcheckPath"
            label="Healthcheck path"
            placeholder="/health"
          />
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Restart policy</span>
            <select
              v-model="editForm.restartPolicy"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="unless-stopped">Unless stopped</option>
              <option value="on-failure">On failure</option>
              <option value="no">No restart</option>
            </select>
          </label>
          <label class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Pengiriman secret</span>
            <select
              v-model="editForm.secretDelivery"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="environment">Environment variable</option>
              <option value="files">Secret file</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Environment keys</span>
            <textarea
              v-model="editForm.environmentKeysText"
              rows="5"
              placeholder="APP_URL&#10;PUBLIC_NAME"
              class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-sm text-ink"
            />
            <span class="mt-1.5 block text-xs text-muted">Satu key per baris.</span>
          </label>
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Secret keys</span>
            <textarea
              v-model="editForm.secretKeysText"
              rows="5"
              placeholder="DATABASE_URL&#10;SESSION_SECRET"
              class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-sm text-ink"
            />
            <span class="mt-1.5 block text-xs text-muted">Nilainya diminta saat deploy.</span>
          </label>
          <UiInput
            v-model="editForm.volumeName"
            label="Persistent volume name"
            placeholder="data"
          />
          <UiInput
            v-model="editForm.volumeMountTarget"
            label="Volume mount target"
            placeholder="/app/data"
          />
        </div>
        <label class="flex items-start gap-3 rounded-md border border-line-strong p-3">
          <input
            v-model="editForm.trackLatest"
            type="checkbox"
            class="mt-0.5 size-4 accent-current"
          />
          <span>
            <strong class="block text-sm text-ink">Track release berikutnya</strong>
            <span class="mt-1 block text-xs text-muted">
              Deployment baru memakai release Application terbaru.
            </span>
          </span>
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton
            variant="secondary"
            :disabled="savingTemplate"
            @click="editingTemplate = null"
          >
            Batal
          </UiButton>
          <UiButton type="submit" form="template-edit-form" :disabled="savingTemplate">
            <Pencil :size="14" /> {{ savingTemplate ? 'Menyimpan…' : 'Simpan perubahan' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiDialog
      v-if="selectedTemplate"
      :title="`Deploy ${selectedTemplate.name}`"
      :description="
        selectedTemplate.applicationId
          ? `Deploy memakai release ${selectedTemplate.resolvedRelease?.version ?? 'terbaru'} dan menautkan resource ke Application.`
          : 'Password dapat diisi sendiri atau dikosongkan agar dibuat otomatis. Nilainya tidak akan ditampilkan kembali.'
      "
      size="lg"
      :close-disabled="deploying"
      @close="selectedTemplate = null"
    >
      <form id="template-deploy-form" class="space-y-5" @submit.prevent="deployTemplate">
        <div class="grid gap-4 md:grid-cols-2">
          <label class="block md:col-span-2">
            <span class="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
              <Server :size="13" /> Ubuntu node
            </span>
            <select
              v-model="form.nodeId"
              required
              :disabled="Boolean(selectedDatabaseParameter && form.databaseMode === 'managed')"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="" disabled>Pilih node</option>
              <option
                v-for="node in nodesForTemplate(selectedTemplate)"
                :key="node.id"
                :value="node.id"
              >
                {{ node.name }} · {{ node.environment }} · {{ node.status }}
              </option>
            </select>
            <span
              v-if="selectedTemplate.resolvedRelease?.localNodeId"
              class="mt-2 block text-xs text-muted"
            >
              Image lokal hanya tersedia pada server tempat build dijalankan.
            </span>
          </label>
          <label class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Docker network</span>
            <select
              v-model="form.networkName"
              required
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option
                v-for="network in deploymentNetworks"
                :key="network.id"
                :value="network.name"
              >
                {{ network.name }} · {{ network.driver }}/{{ network.scope }} ·
                {{ network.containerCount }} container{{ network.managed ? ' · managed' : '' }}
              </option>
            </select>
            <span class="mt-1.5 block text-xs text-muted">
              Application, shared PostgreSQL, dan gateway memakai network yang sama.
              <template v-if="selectedNode?.lastInventoryAt">
                Inventory {{ format.dateTime(selectedNode.lastInventoryAt) }}.
              </template>
            </span>
            <div
              v-if="reportedNetworks.length"
              class="mt-3 rounded-md border border-line bg-canvas/60 p-3"
            >
              <span class="block text-[11px] font-semibold tracking-wide text-muted uppercase">
                Network terdeteksi pada {{ selectedNode?.name }}
              </span>
              <div class="mt-2 flex flex-wrap gap-2">
                <span
                  v-for="network in reportedNetworks"
                  :key="network.id"
                  class="rounded border px-2 py-1 font-mono text-[11px]"
                  :class="
                    isDeployableNetwork(network)
                      ? 'border-info/30 bg-info/10 text-info'
                      : 'border-line text-muted'
                  "
                >
                  {{ network.name }} · {{ network.driver }}/{{ network.scope }} ·
                  {{ network.containerCount }} container ·
                  {{ isDeployableNetwork(network) ? 'dapat dipakai' : 'system/unsupported' }}
                </span>
              </div>
            </div>
          </label>
          <UiInput
            v-model="form.name"
            label="Nama resource"
            required
            pattern="[a-z0-9][a-z0-9-]*"
          />
          <label v-if="selectedTemplate.definition.resourceKind === 'application'" class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Akses aplikasi</span>
            <select
              v-model="form.exposure"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="port">Port server · akses LAN langsung</option>
              <option value="domain">Domain · melalui gateway</option>
            </select>
          </label>
          <UiInput
            v-if="
              selectedTemplate.definition.resourceKind === 'application' &&
              form.exposure === 'domain'
            "
            v-model="form.subdomain"
            label="Subdomain"
            required
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            :hint="`${form.subdomain || 'app'}.${platformDomain}`"
          />
          <UiInput
            v-else
            v-model="form.hostPort"
            label="Host port"
            type="number"
            min="1"
            max="65535"
            required
          />
          <label class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Classification</span>
            <select
              v-model="form.classification"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="internal">Internal</option>
              <option
                value="billable"
                :disabled="
                  selectedTemplate.definition.resourceKind === 'application' &&
                  form.exposure === 'port'
                "
              >
                Billable
              </option>
              <option value="ignored">Ignored</option>
            </select>
          </label>
          <label v-if="form.classification === 'billable'" class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">
              Billing service (wajib)
            </span>
            <select
              v-model="form.serviceId"
              required
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="" disabled>Pilih service</option>
              <option v-for="service in services" :key="service.id" :value="service.id">
                {{ service.serviceNumber }} · {{ service.customerName }} · {{ service.name }}
              </option>
            </select>
            <span class="mt-1 block text-xs text-muted">
              Hanya deployment billable yang ditautkan ke Service dan masuk billing gate.
            </span>
          </label>
        </div>

        <div
          v-if="selectedDatabaseParameter"
          class="rounded-md border border-line-strong"
        >
          <div class="border-b px-4 py-3">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
              <Database :size="15" /> Database aplikasi
            </h3>
            <p class="mt-1 text-xs text-muted">
              Pilih cluster terkelola yang sudah berjalan untuk membuat database logis dan user
              khusus aplikasi, atau masukkan URL database eksternal.
            </p>
          </div>
          <div class="grid gap-4 p-4 md:grid-cols-2">
            <label class="block">
              <span class="mb-2 block text-xs font-semibold text-muted">Sumber database</span>
              <select
                v-model="form.databaseMode"
                class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
              >
                <option value="managed" :disabled="availableDatabaseClusters.length === 0">
                  PostgreSQL cluster terkelola
                </option>
                <option value="external">Database URL eksternal</option>
              </select>
            </label>
            <label v-if="form.databaseMode === 'managed'" class="block">
              <span class="mb-2 block text-xs font-semibold text-muted">PostgreSQL cluster</span>
              <select
                v-model="form.databaseClusterId"
                required
                class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
              >
                <option value="" disabled>Pilih cluster</option>
                <option
                  v-for="cluster in availableDatabaseClusters"
                  :key="cluster.id"
                  :value="cluster.id"
                >
                  {{ cluster.name }} · {{ cluster.nodeName }}
                </option>
              </select>
            </label>
            <p
              v-if="form.databaseMode === 'managed'"
              class="text-xs leading-5 text-muted md:col-span-2"
            >
              Container PostgreSQL cluster digunakan bersama; image PostgreSQL baru tidak dibuat.
              Node mengikuti lokasi cluster. Sistem membuat database logis dan user/password
              khusus, memasang {{ form.databaseEnvironmentKey }} sebagai secret, lalu menjalankan
              aplikasi.
            </p>
            <p
              v-else-if="availableDatabaseClusters.length === 0"
              class="text-xs leading-5 text-warning md:col-span-2"
            >
              Belum ada cluster aktif pada node yang kompatibel. DATABASE_URL tetap dapat diisi
              dari database eksternal.
            </p>
          </div>
        </div>

        <div class="rounded-md border border-line-strong">
          <div class="border-b px-4 py-3">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
              <KeyRound :size="15" /> Parameter
            </h3>
            <p class="mt-1 text-xs text-muted">
              Secret disimpan terenkripsi dan dikirim ke agent saat operasi berjalan.
            </p>
          </div>
          <div class="grid gap-4 p-4 md:grid-cols-2">
            <UiInput
              v-for="parameter in visibleTemplateParameters(selectedTemplate)"
              :key="parameter.key"
              v-model="form.values[parameter.key]"
              :label="parameter.label"
              :type="parameter.type === 'secret' ? 'password' : 'text'"
              :required="parameter.required && !parameter.generated"
              :placeholder="parameter.generated ? 'Buat otomatis' : undefined"
              :hint="parameter.help"
              :autocomplete="parameter.type === 'secret' ? 'new-password' : 'off'"
            />
          </div>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="deploying" @click="selectedTemplate = null">
            Batal
          </UiButton>
          <UiButton
            type="submit"
            form="template-deploy-form"
            :disabled="
              deploying ||
              !nodesForTemplate(selectedTemplate).length ||
              (Boolean(selectedDatabaseParameter) &&
                form.databaseMode === 'managed' &&
                !form.databaseClusterId) ||
              (form.classification === 'billable' && !form.serviceId)
            "
          >
            <Rocket :size="15" /> {{ deploying ? 'Menjadwalkan…' : 'Deploy template' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>
  </div>
</template>
