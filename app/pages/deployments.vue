<script setup lang="ts">
import { LoaderCircle, Rocket } from '@lucide/vue'

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
  createdAt: string
  updatedAt: string
}

const format = useFormat()
const { data, status, error, refresh } = await useFetch<{ data: DeploymentOperation[] }>(
  '/api/infrastructure/operations',
)

const operations = computed(() => data.value?.data ?? [])
const activeCount = computed(
  () =>
    operations.value.filter((operation) =>
      ['queued', 'dispatched', 'running'].includes(operation.status),
    ).length,
)
const failedCount = computed(
  () => operations.value.filter((operation) => operation.status === 'failed').length,
)
const succeededCount = computed(
  () => operations.value.filter((operation) => operation.status === 'succeeded').length,
)
let refreshTimer: number | undefined

onMounted(() => {
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && activeCount.value > 0) void refresh()
  }, 5_000)
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
    'database.cluster.activate': 'Activate database cluster',
    'database.service.ensure': 'Provision service database',
    'route.configure': 'Configure route',
    'route.delete': 'Delete route',
  }
  return labels[action] ?? action
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

    <UiCard v-else :padded="false" class="overflow-hidden">
      <div
        class="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_140px_110px_150px] gap-4 border-b bg-canvas px-5 py-3 text-[10px] font-semibold tracking-wider text-muted uppercase md:grid"
      >
        <span>Operation</span>
        <span>Resource</span>
        <span>Server</span>
        <span>Status</span>
        <span>Waktu</span>
      </div>

      <div
        v-for="operation in operations"
        :key="operation.id"
        class="grid gap-3 border-b px-5 py-4 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_140px_110px_150px] md:items-center md:gap-4"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <LoaderCircle
              v-if="['dispatched', 'running'].includes(operation.status)"
              :size="14"
              class="shrink-0 animate-spin text-brand"
              aria-hidden="true"
            />
            <Rocket v-else :size="14" class="shrink-0 text-muted" aria-hidden="true" />
            <strong class="truncate text-sm text-ink">{{ actionLabel(operation.action) }}</strong>
          </div>
          <p class="mt-1 truncate font-mono text-[10px] text-muted">
            {{ operation.correlationId }}
          </p>
        </div>

        <div class="min-w-0">
          <NuxtLink
            v-if="operation.resourceId"
            :to="`/resources`"
            class="block truncate text-sm font-medium text-brand hover:underline"
          >
            {{ operation.resourceName || operation.resourceId }}
          </NuxtLink>
          <span v-else class="text-sm text-muted">Control-plane operation</span>
          <p v-if="operation.errorMessage" class="mt-1 line-clamp-2 text-xs text-danger">
            {{ operation.errorMessage }}
          </p>
        </div>

        <div>
          <p class="truncate text-sm text-ink">{{ operation.nodeName }}</p>
          <p class="text-[10px] tracking-wide text-muted uppercase">
            {{ operation.nodeEnvironment }}
          </p>
        </div>

        <div class="flex items-center justify-between gap-3 md:block">
          <span class="text-[10px] font-semibold tracking-wide text-muted uppercase md:hidden"
            >Status</span
          >
          <div>
            <UiBadge :tone="statusTone(operation.status)" dot>{{ operation.status }}</UiBadge>
            <p class="mt-1 text-[10px] text-muted">
              {{ operation.attemptCount }}/{{ operation.maxAttempts }} attempt
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 md:block">
          <span class="text-[10px] font-semibold tracking-wide text-muted uppercase md:hidden"
            >Dibuat</span
          >
          <div class="text-right md:text-left">
            <p class="text-xs text-ink">{{ format.dateTime(operation.createdAt) }}</p>
            <p v-if="operation.completedAt" class="mt-1 text-[10px] text-muted">
              Selesai {{ format.dateTime(operation.completedAt) }}
            </p>
          </div>
        </div>
      </div>
    </UiCard>
  </div>
</template>
