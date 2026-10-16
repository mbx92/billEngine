<script setup lang="ts">
import { Archive, Cloud, Database, Plus, RotateCcw, Server, ShieldCheck } from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Backups · OC Infrastructure' })

interface BackupTarget {
  id: string
  name: string
  provider: 's3'
  endpoint: string
  region: string
  bucket: string
  prefix: string
  pathStyle: boolean
  isActive: boolean
}

interface BackupSource {
  id: string
  databaseName: string
  status: string
  serviceNumber: string
  serviceName: string
  customerName: string
  clusterName: string
  nodeName: string
}

interface BackupPolicy {
  id: string
  name: string
  serviceDatabaseId: string
  storageTargetId: string
  intervalMinutes: number
  retentionCount: number
  alertEmail: string | null
  isActive: boolean
  nextRunAt: string
  lastRunAt: string | null
  databaseName: string
  serviceNumber: string
  serviceName: string
  targetName: string
}

interface BackupRun {
  id: string
  serviceDatabaseId: string
  policyId: string | null
  status: 'queued' | 'creating' | 'available' | 'restoring' | 'failed' | 'deleting'
  storagePath: string | null
  checksumSha256: string | null
  sizeBytes: string | null
  lastError: string | null
  completedAt: string | null
  restoredAt: string | null
  createdAt: string
  databaseName: string
  serviceNumber: string
  serviceName: string
  clusterName: string
  nodeName: string
  targetName: string | null
}

interface BackupOverview {
  targets: BackupTarget[]
  sources: BackupSource[]
  policies: BackupPolicy[]
  runs: BackupRun[]
}

const format = useFormat()
const { data, status, error, refresh } = await useFetch<{ data: BackupOverview }>(
  '/api/infrastructure/backups',
)
const overview = computed(() => data.value?.data)
const showTarget = ref(false)
const showPolicy = ref(false)
const saving = ref(false)
const busySourceIds = ref<string[]>([])
const pendingRestore = ref<BackupRun | null>(null)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const targetForm = reactive({
  name: '',
  endpoint: 'https://',
  region: 'auto',
  bucket: '',
  prefix: 'oc-backups',
  pathStyle: false,
  accessKey: '',
  secretKey: '',
})
const policyForm = reactive({
  name: '',
  serviceDatabaseId: '',
  storageTargetId: '',
  intervalMinutes: 1440,
  retentionCount: 14,
  alertEmail: '',
})

const availableCount = computed(
  () => overview.value?.runs.filter((run) => run.status === 'available').length ?? 0,
)
const failedCount = computed(
  () => overview.value?.runs.filter((run) => run.status === 'failed').length ?? 0,
)

let refreshTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refreshTimer = setInterval(() => {
    if (
      document.visibilityState === 'visible' &&
      overview.value?.runs.some((run) => ['queued', 'creating', 'restoring', 'deleting'].includes(run.status))
    ) void refresh()
  }, 5000)
})
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

function openPolicy(source?: BackupSource) {
  Object.assign(policyForm, {
    name: source ? `${source.databaseName}-daily` : '',
    serviceDatabaseId: source?.id ?? overview.value?.sources[0]?.id ?? '',
    storageTargetId: overview.value?.targets[0]?.id ?? '',
    intervalMinutes: 1440,
    retentionCount: 14,
    alertEmail: '',
  })
  showPolicy.value = true
}

async function createTarget() {
  saving.value = true
  actionError.value = null
  try {
    await $fetch('/api/infrastructure/backups/targets', { method: 'POST', body: targetForm })
    showTarget.value = false
    actionMessage.value = `Storage target ${targetForm.name} berhasil disimpan.`
    Object.assign(targetForm, { name: '', endpoint: 'https://', region: 'auto', bucket: '', prefix: 'oc-backups', pathStyle: false, accessKey: '', secretKey: '' })
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Storage target gagal dibuat.')
  } finally {
    saving.value = false
  }
}

async function createPolicy() {
  saving.value = true
  actionError.value = null
  try {
    await $fetch('/api/infrastructure/backups/policies', {
      method: 'POST',
      body: { ...policyForm, alertEmail: policyForm.alertEmail || null },
    })
    showPolicy.value = false
    actionMessage.value = `Policy ${policyForm.name} aktif dan backup pertama akan segera dijadwalkan.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Backup policy gagal dibuat.')
  } finally {
    saving.value = false
  }
}

async function runBackup(source: BackupSource) {
  busySourceIds.value.push(source.id)
  actionError.value = null
  try {
    await $fetch(`/api/infrastructure/database-clusters/databases/${source.id}/backups`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `database-backup:${crypto.randomUUID()}` },
    })
    actionMessage.value = `Backup lokal ${source.databaseName} masuk antrean.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Backup gagal dijadwalkan.')
  } finally {
    busySourceIds.value = busySourceIds.value.filter((id) => id !== source.id)
  }
}

async function restoreBackup() {
  if (!pendingRestore.value) return
  const backup = pendingRestore.value
  saving.value = true
  actionError.value = null
  try {
    await $fetch(`/api/infrastructure/database-backups/${backup.id}/restore`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `database-restore:${crypto.randomUUID()}` },
    })
    pendingRestore.value = null
    actionMessage.value = `Restore ${backup.databaseName} masuk antrean.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Restore gagal dijadwalkan.')
  } finally {
    saving.value = false
  }
}

function humanBytes(value: string | null) {
  if (!value) return '—'
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return value
  return `${(bytes / 1024 ** 2).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MiB`
}

function runTone(runStatus: BackupRun['status']) {
  if (runStatus === 'available') return 'success' as const
  if (runStatus === 'failed') return 'danger' as const
  return 'warning' as const
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / Data protection
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Backups</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Jadwalkan backup PostgreSQL workload, simpan ke object storage S3-compatible,
          terapkan retention, dan restore melalui operation yang diaudit.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
        <UiButton variant="secondary" @click="showTarget = true"><Cloud :size="15" /> Storage target</UiButton>
        <UiButton :disabled="!overview?.targets.length || !overview?.sources.length" @click="openPolicy()"><Plus :size="15" /> Backup policy</UiButton>
      </div>
    </header>

    <p v-if="actionMessage" class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand">{{ actionMessage }}</p>
    <p v-if="actionError" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{{ actionError }}</p>

    <div v-if="status === 'pending' && !overview" class="grid gap-4 md:grid-cols-4">
      <UiSkeleton v-for="item in 4" :key="item" height="7rem" />
    </div>
    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState title="Backup center gagal dimuat" description="Pastikan migration backup terbaru sudah diterapkan." />
    </UiCard>
    <template v-else>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <UiStat label="Protected sources" :value="String(overview?.policies.length ?? 0)" />
        <UiStat label="Available backups" :value="String(availableCount)" />
        <UiStat label="Failed runs" :value="String(failedCount)" />
        <UiStat label="Storage targets" :value="String(overview?.targets.length ?? 0)" />
      </div>

      <section class="mt-8">
        <div class="mb-3 flex items-center justify-between">
          <div><h2 class="text-sm font-semibold text-ink">Backup sources</h2><p class="mt-1 text-xs text-muted">PostgreSQL workload aktif yang dikelola OC.</p></div>
          <UiBadge tone="neutral">{{ overview?.sources.length ?? 0 }} source</UiBadge>
        </div>
        <div class="grid gap-4 lg:grid-cols-2">
          <UiCard v-for="source in overview?.sources" :key="source.id">
            <div class="flex items-start justify-between gap-3">
              <div class="flex min-w-0 gap-3"><span class="rounded bg-brand/10 p-2 text-brand"><Database :size="17" /></span><div><h3 class="font-mono text-sm font-semibold text-ink">{{ source.databaseName }}</h3><p class="mt-1 text-xs text-muted">{{ source.serviceNumber }} · {{ source.serviceName }} · {{ source.customerName }}</p><p class="mt-1 text-xs text-muted">{{ source.clusterName }} · {{ source.nodeName }}</p></div></div>
              <UiBadge :tone="source.status === 'active' ? 'success' : 'warning'" dot>{{ source.status }}</UiBadge>
            </div>
            <div class="mt-4 flex gap-2 border-t pt-4">
              <UiButton variant="secondary" class="flex-1" :disabled="source.status !== 'active' || busySourceIds.includes(source.id)" @click="runBackup(source)"><Archive :size="14" /> Backup now</UiButton>
              <UiButton class="flex-1" :disabled="!overview?.targets.length || source.status !== 'active'" @click="openPolicy(source)"><ShieldCheck :size="14" /> Protect</UiButton>
            </div>
          </UiCard>
        </div>
      </section>

      <section class="mt-8">
        <div class="mb-3 flex items-center justify-between"><div><h2 class="text-sm font-semibold text-ink">Policies</h2><p class="mt-1 text-xs text-muted">Interval, retention count, object storage, dan email alert.</p></div><UiBadge tone="neutral">{{ overview?.policies.length ?? 0 }} policy</UiBadge></div>
        <UiCard v-if="!overview?.policies.length" :padded="false"><UiEmptyState title="Belum ada scheduled backup" description="Tambahkan storage target lalu buat policy untuk database workload." /></UiCard>
        <div v-else class="grid gap-4 lg:grid-cols-2">
          <UiCard v-for="policy in overview?.policies" :key="policy.id">
            <div class="flex justify-between gap-3"><div><h3 class="text-sm font-semibold text-ink">{{ policy.name }}</h3><p class="mt-1 font-mono text-xs text-muted">{{ policy.databaseName }} → {{ policy.targetName }}</p></div><UiBadge :tone="policy.isActive ? 'success' : 'neutral'" dot>{{ policy.isActive ? 'active' : 'disabled' }}</UiBadge></div>
            <dl class="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs"><div><dt class="text-muted">Schedule</dt><dd class="mt-1 text-ink">Setiap {{ policy.intervalMinutes }} menit</dd></div><div><dt class="text-muted">Retention</dt><dd class="mt-1 text-ink">{{ policy.retentionCount }} backup</dd></div><div><dt class="text-muted">Next run</dt><dd class="mt-1 text-ink">{{ format.dateTime(policy.nextRunAt) }}</dd></div><div><dt class="text-muted">Alert</dt><dd class="mt-1 truncate text-ink">{{ policy.alertEmail || 'Prometheus only' }}</dd></div></dl>
          </UiCard>
        </div>
      </section>

      <section class="mt-8">
        <div class="mb-3 flex items-center justify-between"><div><h2 class="text-sm font-semibold text-ink">Backup runs</h2><p class="mt-1 text-xs text-muted">Artifact, checksum, ukuran, dan hasil restore terbaru.</p></div><UiBadge tone="neutral">{{ overview?.runs.length ?? 0 }} run</UiBadge></div>
        <UiCard :padded="false">
          <div v-if="!overview?.runs.length" class="p-6"><UiEmptyState title="Belum ada backup run" description="Jalankan Backup now atau buat scheduled policy." /></div>
          <div v-else class="overflow-x-auto"><table class="w-full text-left text-sm"><thead class="border-b bg-surface text-xs text-muted"><tr><th class="px-4 py-3">Database</th><th class="px-4 py-3">Created</th><th class="px-4 py-3">Target</th><th class="px-4 py-3">Size</th><th class="px-4 py-3">Status</th><th class="px-4 py-3 text-right">Action</th></tr></thead><tbody class="divide-y"><tr v-for="run in overview?.runs" :key="run.id"><td class="px-4 py-3"><p class="font-mono text-xs text-ink">{{ run.databaseName }}</p><p class="mt-1 text-xs text-muted">{{ run.serviceNumber }} · {{ run.nodeName }}</p><p v-if="run.lastError" class="mt-1 max-w-md text-xs text-danger">{{ run.lastError }}</p></td><td class="px-4 py-3 text-xs text-muted">{{ format.dateTime(run.createdAt) }}</td><td class="px-4 py-3 text-xs text-ink">{{ run.targetName || 'Node local' }}</td><td class="px-4 py-3 font-mono text-xs text-ink">{{ humanBytes(run.sizeBytes) }}</td><td class="px-4 py-3"><UiBadge :tone="runTone(run.status)" dot>{{ run.status }}</UiBadge></td><td class="px-4 py-3 text-right"><UiButton v-if="run.status === 'available'" variant="ghost" size="sm" @click="pendingRestore = run"><RotateCcw :size="14" /> Restore</UiButton></td></tr></tbody></table></div>
        </UiCard>
      </section>

      <section class="mt-8">
        <h2 class="text-sm font-semibold text-ink">Fitur backup mendatang</h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <UiCard v-for="driver in ['PostgreSQL eksternal/native Ubuntu', 'MySQL / MariaDB', 'Redis RDB / AOF', 'Docker named volume']" :key="driver"><div class="flex items-center gap-3"><Server :size="16" class="text-muted" /><div><p class="text-sm font-medium text-ink">{{ driver }}</p><p class="mt-1 text-xs text-muted">Belum tersedia</p></div></div></UiCard>
        </div>
      </section>
    </template>

    <UiDialog v-if="showTarget" title="Add S3-compatible target" description="Credential dienkripsi oleh control plane dan hanya diberikan kepada agent saat operation aktif." size="lg" :close-disabled="saving" @close="showTarget = false"><form id="backup-target-form" class="grid gap-4 md:grid-cols-2" @submit.prevent="createTarget"><UiInput v-model="targetForm.name" label="Name" required /><UiInput v-model="targetForm.endpoint" label="Endpoint URL" type="url" required /><UiInput v-model="targetForm.region" label="Region" required /><UiInput v-model="targetForm.bucket" label="Bucket" required /><UiInput v-model="targetForm.prefix" label="Prefix" required /><label class="flex items-center gap-2 self-end pb-2 text-sm text-ink"><input v-model="targetForm.pathStyle" type="checkbox" /> Path-style endpoint (MinIO/R2)</label><UiInput v-model="targetForm.accessKey" label="Access key" autocomplete="off" required /><UiInput v-model="targetForm.secretKey" label="Secret key" type="password" autocomplete="new-password" required /></form><template #footer><UiButton variant="secondary" :disabled="saving" @click="showTarget = false">Batal</UiButton><UiButton type="submit" form="backup-target-form" :disabled="saving">{{ saving ? 'Menyimpan…' : 'Save target' }}</UiButton></template></UiDialog>

    <UiDialog v-if="showPolicy" title="Create backup policy" description="Backup pertama dijadwalkan segera; run berikutnya mengikuti interval." size="lg" :close-disabled="saving" @close="showPolicy = false"><form id="backup-policy-form" class="grid gap-4 md:grid-cols-2" @submit.prevent="createPolicy"><UiInput v-model="policyForm.name" label="Policy name" required /><label class="block"><span class="mb-2 block text-xs font-semibold text-muted">Database source</span><select v-model="policyForm.serviceDatabaseId" required class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm"><option v-for="source in overview?.sources" :key="source.id" :value="source.id">{{ source.databaseName }} · {{ source.serviceNumber }}</option></select></label><label class="block"><span class="mb-2 block text-xs font-semibold text-muted">Storage target</span><select v-model="policyForm.storageTargetId" required class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm"><option v-for="target in overview?.targets" :key="target.id" :value="target.id">{{ target.name }} · {{ target.bucket }}</option></select></label><label class="block"><span class="mb-2 block text-xs font-semibold text-muted">Interval (minutes)</span><input v-model.number="policyForm.intervalMinutes" type="number" min="5" max="525600" required class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm" /></label><label class="block"><span class="mb-2 block text-xs font-semibold text-muted">Retention count</span><input v-model.number="policyForm.retentionCount" type="number" min="1" max="1000" required class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm" /></label><UiInput v-model="policyForm.alertEmail" label="Failure alert email (optional)" type="email" /></form><template #footer><UiButton variant="secondary" :disabled="saving" @click="showPolicy = false">Batal</UiButton><UiButton type="submit" form="backup-policy-form" :disabled="saving">{{ saving ? 'Menyimpan…' : 'Activate policy' }}</UiButton></template></UiDialog>

    <UiConfirmDialog v-if="pendingRestore" :title="`Restore ${pendingRestore.databaseName}?`" description="Database workload akan dibersihkan dan dipulihkan secara transaksional. Hentikan penulisan aplikasi sebelum melanjutkan." confirm-label="Restore database" destructive :pending="saving" @confirm="restoreBackup" @cancel="pendingRestore = null" />
  </div>
</template>
