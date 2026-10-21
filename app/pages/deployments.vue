<script setup lang="ts">
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  LoaderCircle,
  Rocket,
  Square,
  XCircle,
} from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Deployments · Billing Infra' })

type OperationStatus =
  'queued' | 'dispatched' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

interface DeploymentOperation {
  id: string
  nodeId: string
  nodeName: string
  nodeEnvironment: string
  resourceId: string | null
  resourceName: string | null
  resourceKind: 'application' | 'database' | 'volume' | null
  action: string
  status: OperationStatus
  correlationId: string
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: string
  expiresAt: string
  startedAt: string | null
  completedAt: string | null
  errorCode: string | null
  errorMessage: string | null
  logExcerpt: string
  logUpdatedAt: string | null
  normalizedError?: NormalizedOperationError | null
  createdAt: string
  updatedAt: string
}

interface NormalizedOperationError {
  code: string
  stage:
    | 'agent'
    | 'database'
    | 'image'
    | 'build'
    | 'container'
    | 'network'
    | 'secret'
    | 'route'
    | 'backup'
    | 'unknown'
  title: string
  summary: string
  decision:
    | 'retry'
    | 'retry_after_check'
    | 'fix_configuration'
    | 'restore_dependency'
    | 'manual_investigation'
  retryable: boolean
  recommendedAction: string
  technicalDetail: string | null
}

const format = useFormat()
const toast = useToast()
const { data, status, error, refresh } = await useFetch<{ data: DeploymentOperation[] }>(
  '/api/infrastructure/operations',
)

const operations = computed(() => data.value?.data ?? [])
type DeploymentFilter = 'all' | 'active' | 'failed' | 'succeeded'
type DeploymentGroupStatus = 'active' | 'succeeded' | 'failed' | 'cancelled'

interface DeploymentGroup {
  correlationId: string
  operations: DeploymentOperation[]
  status: DeploymentGroupStatus
  resourceId: string | null
  resourceName: string | null
  nodeName: string
  nodeEnvironment: string
  createdAt: string
  updatedAt: string
  completedSteps: number
  progress: number
}

const filter = ref<DeploymentFilter>('all')
const pendingForceStop = ref<DeploymentOperation | null>(null)
const forceStoppingId = ref<string | null>(null)
const deploymentGroups = computed<DeploymentGroup[]>(() => {
  const grouped = new Map<string, DeploymentOperation[]>()
  for (const operation of operations.value) {
    const group = grouped.get(operation.correlationId) ?? []
    group.push(operation)
    grouped.set(operation.correlationId, group)
  }

  return [...grouped.entries()]
    .map(([correlationId, groupOperations]) => {
      const timeline = [...groupOperations].sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      )
      const failed = timeline.some((operation) =>
        ['failed', 'expired'].includes(operation.status),
      )
      const active = timeline.some((operation) =>
        ['queued', 'dispatched', 'running'].includes(operation.status),
      )
      const succeeded = timeline.every((operation) => operation.status === 'succeeded')
      const groupStatus: DeploymentGroupStatus = failed
        ? 'failed'
        : active
          ? 'active'
          : succeeded
            ? 'succeeded'
            : 'cancelled'
      const resourceOperation = timeline.find((operation) => operation.resourceId)
      const completedSteps = timeline.filter((operation) =>
        ['succeeded', 'failed', 'cancelled', 'expired'].includes(operation.status),
      ).length
      const updatedAt = timeline.reduce(
        (latest, operation) =>
          new Date(operation.updatedAt).getTime() > new Date(latest).getTime()
            ? operation.updatedAt
            : latest,
        timeline[0]!.updatedAt,
      )
      return {
        correlationId,
        operations: timeline,
        status: groupStatus,
        resourceId: resourceOperation?.resourceId ?? null,
        resourceName: resourceOperation?.resourceName ?? null,
        nodeName: timeline[0]!.nodeName,
        nodeEnvironment: timeline[0]!.nodeEnvironment,
        createdAt: timeline[0]!.createdAt,
        updatedAt,
        completedSteps,
        progress: Math.round((completedSteps / timeline.length) * 100),
      }
    })
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
})

const visibleDeploymentGroups = computed(() =>
  filter.value === 'all'
    ? deploymentGroups.value
    : deploymentGroups.value.filter((group) => group.status === filter.value),
)
const activeCount = computed(
  () => deploymentGroups.value.filter((group) => group.status === 'active').length,
)
const failedCount = computed(
  () => deploymentGroups.value.filter((group) => group.status === 'failed').length,
)
const succeededCount = computed(
  () => deploymentGroups.value.filter((group) => group.status === 'succeeded').length,
)
let refreshTimer: number | undefined

onMounted(() => {
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && activeCount.value > 0) void refresh()
  }, 2_000)
})

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})

function statusTone(status: OperationStatus) {
  if (status === 'succeeded') return 'success' as const
  if (status === 'failed' || status === 'expired') return 'danger' as const
  if (status === 'running' || status === 'dispatched') return 'warning' as const
  return 'neutral' as const
}

function groupTone(status: DeploymentGroupStatus) {
  if (status === 'succeeded') return 'success' as const
  if (status === 'failed') return 'danger' as const
  if (status === 'active') return 'warning' as const
  return 'neutral' as const
}

function groupStatusLabel(status: DeploymentGroupStatus) {
  if (status === 'active') return 'Berjalan'
  if (status === 'succeeded') return 'Berhasil'
  if (status === 'failed') return 'Gagal'
  return 'Dibatalkan'
}

function groupTitle(group: DeploymentGroup) {
  const actions = new Set(group.operations.map((operation) => operation.action))
  if (actions.has('database.service.ensure') && actions.has('application.ensure')) {
    return `Deploy ${group.resourceName ?? 'application'} + managed database`
  }
  return actionLabel(group.operations[0]?.action ?? 'Deployment')
}

function operationStatusText(operation: DeploymentOperation) {
  if (operation.status === 'queued') {
    return operation.attemptCount > 0 ? 'Menunggu percobaan ulang' : 'Menunggu agent mengambil tugas'
  }
  if (operation.status === 'dispatched') return 'Sudah dikirim ke agent'
  if (operation.status === 'running') return 'Sedang dijalankan oleh agent'
  if (operation.status === 'succeeded') return 'Tahap selesai'
  if (operation.status === 'expired') return 'Operation melewati batas waktu'
  if (operation.status === 'cancelled') return 'Operation dibatalkan'
  return 'Tahap gagal'
}

function operationIcon(status: OperationStatus) {
  if (status === 'succeeded') return CheckCircle2
  if (status === 'failed' || status === 'expired') return XCircle
  if (status === 'running' || status === 'dispatched') return LoaderCircle
  if (status === 'queued') return Clock3
  return Circle
}

function operationDuration(operation: DeploymentOperation) {
  if (!operation.startedAt) return null
  const end = operation.completedAt ? new Date(operation.completedAt) : new Date()
  const milliseconds = Math.max(0, end.getTime() - new Date(operation.startedAt).getTime())
  if (milliseconds < 1_000) return `${milliseconds} ms`
  const seconds = Math.round(milliseconds / 1_000)
  if (seconds < 60) return `${seconds} detik`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    'agent.upgrade': 'Upgrade OC Agent',
    'agent.rollback': 'Rollback OC Agent',
    'gateway.ensure': 'Bootstrap Traefik gateway',
    'application.ensure': 'Deploy application',
    'application.build': 'Build application image',
    'image.delete': 'Delete Docker image',
    'application.deploy': 'Deploy application',
    'application.start': 'Start application',
    'application.stop': 'Stop application',
    'application.restart': 'Restart application',
    'application.redeploy': 'Redeploy application',
    'application.delete': 'Delete application',
    'application.set-limits': 'Update resource limits',
    'container.exec': 'Docker sh command',
    'database.cluster.activate': 'Activate database cluster',
    'database.service.ensure': 'Provision application database',
    'route.configure': 'Configure route',
    'route.delete': 'Delete route',
  }
  return labels[action] ?? action
}

function errorStageLabel(stage: NormalizedOperationError['stage']) {
  const labels: Record<NormalizedOperationError['stage'], string> = {
    agent: 'Agent',
    database: 'Database',
    image: 'Image',
    build: 'Build',
    container: 'Container',
    network: 'Network',
    secret: 'Secret',
    route: 'Routing',
    backup: 'Backup',
    unknown: 'Unknown',
  }
  return labels[stage]
}

function errorDecisionLabel(decision: NormalizedOperationError['decision']) {
  const labels: Record<NormalizedOperationError['decision'], string> = {
    retry: 'Aman dicoba ulang',
    retry_after_check: 'Periksa lalu coba ulang',
    fix_configuration: 'Perbaiki konfigurasi',
    restore_dependency: 'Pulihkan dependency',
    manual_investigation: 'Investigasi manual',
  }
  return labels[decision]
}

function errorDecisionTone(decision: NormalizedOperationError['decision']) {
  if (decision === 'retry') return 'success' as const
  if (decision === 'retry_after_check' || decision === 'restore_dependency') {
    return 'warning' as const
  }
  return 'danger' as const
}

function canForceStop(operation: DeploymentOperation) {
  return ['queued', 'dispatched', 'running'].includes(operation.status)
}

async function forceStopOperation() {
  const operation = pendingForceStop.value
  if (!operation) return
  forceStoppingId.value = operation.id
  try {
    await $fetch(`/api/infrastructure/operations/${operation.id}/force-stop`, {
      method: 'POST',
    })
    toast.success(`${actionLabel(operation.action)} berhasil dihentikan.`)
    pendingForceStop.value = null
    await refresh()
  } catch (caught) {
    toast.error(apiErrorMessage(caught, 'Operation gagal dihentikan.'))
  } finally {
    forceStoppingId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / operations
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Deployments</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Antrean dan riwayat perintah yang dijalankan OC Agent pada setiap server. Template hanya
          membuat deployment; progres eksekusinya tercatat di sini.
        </p>
      </div>
      <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
    </header>

    <div class="mb-6 grid gap-4 sm:grid-cols-3">
      <UiStat
        label="Dalam antrean"
        :value="format.count(activeCount)"
        detail="Queued atau running"
      />
      <UiStat
        label="Berhasil"
        :value="format.count(succeededCount)"
        detail="100 operasi terakhir"
        tone="success"
      />
      <UiStat
        label="Gagal"
        :value="format.count(failedCount)"
        detail="Perlu diperiksa"
        :tone="failedCount > 0 ? 'warning' : undefined"
      />
    </div>

    <UiEmptyState
      v-if="error"
      title="Gagal memuat deployments"
      description="Riwayat operasi dari control plane tidak dapat dimuat."
    >
      <UiButton variant="secondary" size="sm" @click="refresh">Coba lagi</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="status !== 'pending' && operations.length === 0"
      title="Belum ada deployment"
      description="Deploy sebuah template atau jalankan aksi pada resource untuk membuat operation pertama."
    >
      <NuxtLink to="/templates"><UiButton size="sm">Buka templates</UiButton></NuxtLink>
    </UiEmptyState>

    <div v-else>
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <UiButton
          v-for="option in (['all', 'active', 'failed', 'succeeded'] as DeploymentFilter[])"
          :key="option"
          size="sm"
          :variant="filter === option ? 'primary' : 'secondary'"
          @click="filter = option"
        >
          {{
            option === 'all'
              ? 'Semua'
              : option === 'active'
                ? `Berjalan (${activeCount})`
                : option === 'failed'
                  ? `Gagal (${failedCount})`
                  : `Berhasil (${succeededCount})`
          }}
        </UiButton>
      </div>

      <UiEmptyState
        v-if="visibleDeploymentGroups.length === 0"
        title="Tidak ada deployment pada filter ini"
        description="Pilih filter lain untuk melihat deployment yang tersimpan."
      />

      <div v-else class="space-y-4">
        <UiCard
          v-for="group in visibleDeploymentGroups"
          :key="group.correlationId"
          :padded="false"
          class="overflow-hidden"
        >
          <details :open="group.status !== 'succeeded'">
            <summary class="cursor-pointer list-none px-5 py-4 hover:bg-canvas/60">
              <div class="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <LoaderCircle
                      v-if="group.status === 'active'"
                      :size="16"
                      class="shrink-0 animate-spin text-brand"
                    />
                    <AlertTriangle
                      v-else-if="group.status === 'failed'"
                      :size="16"
                      class="shrink-0 text-danger"
                    />
                    <CheckCircle2
                      v-else-if="group.status === 'succeeded'"
                      :size="16"
                      class="shrink-0 text-success"
                    />
                    <Rocket v-else :size="16" class="shrink-0 text-muted" />
                    <h2 class="truncate text-sm font-semibold text-ink">
                      {{ groupTitle(group) }}
                    </h2>
                    <UiBadge :tone="groupTone(group.status)" dot>
                      {{ groupStatusLabel(group.status) }}
                    </UiBadge>
                  </div>
                  <p class="mt-2 text-xs text-muted">
                    {{ group.nodeName }} · {{ group.nodeEnvironment }} · dimulai
                    {{ format.dateTime(group.createdAt) }}
                  </p>
                  <p class="mt-1 truncate font-mono text-[10px] text-muted">
                    correlation {{ group.correlationId }}
                  </p>
                </div>
                <div class="w-full shrink-0 md:w-56">
                  <div class="mb-2 flex items-center justify-between text-[11px] text-muted">
                    <span>{{ group.completedSteps }}/{{ group.operations.length }} tahap selesai</span>
                    <span>{{ group.progress }}%</span>
                  </div>
                  <UiProgress :value="group.progress" />
                  <NuxtLink
                    v-if="group.resourceId"
                    to="/resources"
                    class="mt-2 block truncate text-xs font-medium text-brand hover:underline"
                    @click.stop
                  >
                    {{ group.resourceName || group.resourceId }}
                  </NuxtLink>
                </div>
              </div>
            </summary>

            <div class="border-t bg-canvas/40 px-5 py-5">
              <h3 class="mb-4 text-xs font-semibold tracking-wide text-muted uppercase">
                Deployment log
              </h3>
              <ol class="space-y-0">
                <li
                  v-for="(operation, index) in group.operations"
                  :key="operation.id"
                  class="relative flex gap-3 pb-5 last:pb-0"
                >
                  <span
                    v-if="index < group.operations.length - 1"
                    class="absolute top-5 bottom-0 left-[9px] w-px bg-line-strong"
                  />
                  <component
                    :is="operationIcon(operation.status)"
                    :size="19"
                    :class="[
                      'relative z-10 shrink-0 bg-canvas',
                      operation.status === 'succeeded'
                        ? 'text-success'
                        : ['failed', 'expired'].includes(operation.status)
                          ? 'text-danger'
                          : ['running', 'dispatched'].includes(operation.status)
                            ? 'animate-spin text-brand'
                            : 'text-muted',
                    ]"
                  />
                  <div class="min-w-0 flex-1 rounded-md border bg-surface px-4 py-3">
                    <div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                      <div>
                        <p class="text-sm font-semibold text-ink">
                          {{ actionLabel(operation.action) }}
                        </p>
                        <p class="mt-1 text-xs text-muted">
                          {{ operationStatusText(operation) }}
                        </p>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        <UiBadge :tone="statusTone(operation.status)" dot>
                          {{ operation.status }}
                        </UiBadge>
                        <UiButton
                          v-if="canForceStop(operation)"
                          size="sm"
                          variant="danger"
                          :disabled="forceStoppingId === operation.id"
                          @click="pendingForceStop = operation"
                        >
                          <Square :size="12" />
                          Force stop
                        </UiButton>
                      </div>
                    </div>

                    <div
                      v-if="operation.errorMessage || operation.errorCode"
                      class="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2"
                    >
                      <template v-if="operation.normalizedError">
                        <div class="flex flex-wrap items-center gap-2">
                          <p class="text-sm font-semibold text-danger">
                            {{ operation.normalizedError.title }}
                          </p>
                          <UiBadge tone="neutral">
                            {{ errorStageLabel(operation.normalizedError.stage) }}
                          </UiBadge>
                          <UiBadge :tone="errorDecisionTone(operation.normalizedError.decision)">
                            {{ errorDecisionLabel(operation.normalizedError.decision) }}
                          </UiBadge>
                        </div>
                        <p class="mt-2 text-xs leading-5 text-ink">
                          {{ operation.normalizedError.summary }}
                        </p>
                        <div class="mt-3 rounded border border-line bg-surface/80 px-3 py-2">
                          <p class="text-[10px] font-semibold tracking-wide text-muted uppercase">
                            Tindakan yang disarankan
                          </p>
                          <p class="mt-1 text-xs leading-5 text-ink">
                            {{ operation.normalizedError.recommendedAction }}
                          </p>
                        </div>
                        <details
                          v-if="operation.normalizedError.technicalDetail"
                          class="mt-3 text-xs text-muted"
                        >
                          <summary class="cursor-pointer font-medium hover:text-ink">
                            Detail teknis · {{ operation.normalizedError.code }}
                          </summary>
                          <pre
                            class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-ink px-3 py-2 font-mono text-[10px] leading-4 text-canvas"
                          >{{ operation.normalizedError.technicalDetail }}</pre>
                        </details>
                        <p v-else class="mt-3 font-mono text-[10px] text-muted">
                          {{ operation.normalizedError.code }}
                        </p>
                      </template>
                      <template v-else>
                        <p class="text-xs font-semibold text-danger">
                          {{ operation.errorCode || 'DEPLOYMENT_ERROR' }}
                        </p>
                        <p v-if="operation.errorMessage" class="mt-1 text-xs leading-5 text-danger">
                          {{ operation.errorMessage }}
                        </p>
                      </template>
                    </div>

                    <div class="mt-3 overflow-hidden rounded border border-line bg-ink">
                      <div
                        class="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-[10px] text-canvas/70"
                      >
                        <span class="font-semibold tracking-wide uppercase">Agent execution log</span>
                        <span v-if="operation.logUpdatedAt">
                          update {{ format.dateTime(operation.logUpdatedAt) }}
                        </span>
                        <span
                          v-if="['running', 'dispatched'].includes(operation.status)"
                          class="flex items-center gap-1 text-success"
                        >
                          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> live
                        </span>
                      </div>
                      <pre
                        v-if="operation.logExcerpt"
                        class="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-[10px] leading-5 text-canvas"
                      >{{ operation.logExcerpt }}</pre>
                      <p v-else class="px-3 py-3 font-mono text-[10px] text-canvas/60">
                        Belum ada log dari agent. Log live membutuhkan OC Agent 0.12.10+.
                      </p>
                    </div>

                    <dl class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted">
                      <div class="flex gap-1">
                        <dt>Operation:</dt>
                        <dd class="font-mono">{{ operation.id }}</dd>
                      </div>
                      <div class="flex gap-1">
                        <dt>Attempt:</dt>
                        <dd>{{ operation.attemptCount }}/{{ operation.maxAttempts }}</dd>
                      </div>
                      <div v-if="operationDuration(operation)" class="flex gap-1">
                        <dt>Durasi:</dt>
                        <dd>{{ operationDuration(operation) }}</dd>
                      </div>
                      <div class="flex gap-1">
                        <dt>Update:</dt>
                        <dd>{{ format.dateTime(operation.updatedAt) }}</dd>
                      </div>
                      <div
                        v-if="operation.status === 'queued' && operation.attemptCount > 0"
                        class="flex gap-1"
                      >
                        <dt>Retry:</dt>
                        <dd>{{ format.dateTime(operation.nextAttemptAt) }}</dd>
                      </div>
                    </dl>
                  </div>
                </li>
              </ol>
            </div>
          </details>
        </UiCard>
      </div>
    </div>

    <UiConfirmDialog
      v-if="pendingForceStop"
      :title="`Force stop ${actionLabel(pendingForceStop.action)}?`"
      :description="`Operation ${pendingForceStop.id} akan langsung dibatalkan. Perubahan Docker atau database yang sudah sempat dijalankan mungkin perlu diperiksa sebelum deployment diulang.`"
      confirm-label="Force stop"
      destructive
      :pending="forceStoppingId === pendingForceStop.id"
      @confirm="forceStopOperation"
      @cancel="pendingForceStop = null"
    />
  </div>
</template>
