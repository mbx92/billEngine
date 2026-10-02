<script setup lang="ts">
import { FileCode2, RefreshCw, Rocket, RotateCcw } from '@lucide/vue'
import type {
  ApiProvisioningJob,
  ApiProvisioningOverview,
  ProvisioningStatus,
} from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Provisioning · Billing Infra' })

const { dateTime } = useFormat()

const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<{
  data: ApiProvisioningOverview
}>('/api/provisioning')

const data = computed(() => response.value?.data)
const showJobForm = ref(false)
const queueing = ref(false)
const retryingId = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)

const jobForm = reactive({
  blueprintId: '',
  serviceId: '',
  applicationName: '',
  hostname: '',
  domainType: 'platform' as 'platform' | 'custom',
  environmentText: '',
  sqlImportFilename: '',
  sqlImportContent: '',
})

const selectedBlueprint = computed(() =>
  data.value?.blueprints.find((blueprint) => blueprint.id === jobForm.blueprintId),
)
const selectedService = computed(() =>
  data.value?.services.find((service) => service.id === jobForm.serviceId),
)
const databaseCompatibilityError = computed(() => {
  if (!selectedBlueprint.value || !selectedService.value) return null
  if (
    selectedBlueprint.value.databaseClusterId &&
    selectedService.value.databaseMode !== 'shared'
  ) {
    return 'Blueprint memakai database shared, tetapi service belum memakai plan dengan mode database shared.'
  }
  if (
    selectedService.value.databaseMode === 'shared' &&
    !selectedBlueprint.value.databaseClusterId
  ) {
    return 'Service memakai database shared, tetapi blueprint belum memiliki database cluster.'
  }
  return null
})
const activeJobs = computed(
  () => data.value?.jobs.some((job) => !['active', 'failed'].includes(job.status)) ?? false,
)

let pollTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  pollTimer = setInterval(() => {
    if (activeJobs.value) refresh()
  }, 5_000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

watch([selectedBlueprint, selectedService], ([blueprint]) => {
  if (!blueprint) return
  const current = parseEnvironmentLines(jobForm.environmentText)
  jobForm.environmentText = blueprint.environmentKeys
    .filter(
      (key) =>
        !(
          selectedService.value?.databaseMode === 'shared' &&
          key === blueprint.databaseEnvironmentKey
        ),
    )
    .map((key) => `${key}=${current[key] ?? ''}`)
    .join('\n')
})

async function queueJob() {
  if (databaseCompatibilityError.value) {
    actionError.value = databaseCompatibilityError.value
    return
  }
  queueing.value = true
  clearFeedback()
  try {
    const environmentVariables = parseEnvironmentLines(jobForm.environmentText)
    await $fetch('/api/provisioning', {
      method: 'POST',
      body: {
        blueprintId: jobForm.blueprintId,
        serviceId: jobForm.serviceId,
        applicationName: jobForm.applicationName,
        hostname: jobForm.hostname,
        domainType: jobForm.hostname ? jobForm.domainType : undefined,
        environmentVariables,
        sqlImport: jobForm.sqlImportContent
          ? { filename: jobForm.sqlImportFilename, content: jobForm.sqlImportContent }
          : undefined,
      },
    })
    actionMessage.value = `${jobForm.applicationName} masuk antrean provisioning.`
    showJobForm.value = false
    Object.assign(jobForm, {
      blueprintId: '',
      serviceId: '',
      applicationName: '',
      hostname: '',
      domainType: 'platform',
      environmentText: '',
      sqlImportFilename: '',
      sqlImportContent: '',
    })
    await refresh()
  } catch (requestError) {
    actionError.value = apiErrorMessage(requestError, 'Provisioning gagal diantrekan.')
  } finally {
    queueing.value = false
  }
}

async function selectSqlFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    jobForm.sqlImportFilename = ''
    jobForm.sqlImportContent = ''
    return
  }
  if (!file.name.toLowerCase().endsWith('.sql')) {
    actionError.value = 'File import harus berekstensi .sql.'
    input.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    actionError.value = 'File SQL maksimal 10 MB.'
    input.value = ''
    return
  }
  jobForm.sqlImportFilename = file.name
  jobForm.sqlImportContent = await file.text()
}

async function retryJob(id: string) {
  retryingId.value = id
  clearFeedback()
  try {
    await $fetch(`/api/provisioning/${id}/retry`, { method: 'POST' })
    actionMessage.value = 'Provisioning job dijadwalkan ulang.'
    await refresh()
  } catch (requestError) {
    actionError.value = apiErrorMessage(requestError, 'Retry provisioning gagal.')
  } finally {
    retryingId.value = null
  }
}

function openJobDialog() {
  clearFeedback()
  showJobForm.value = true
}

function parseEnvironmentLines(value: string) {
  const result: Record<string, string> = {}
  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1)
  }
  return result
}

function clearFeedback() {
  actionMessage.value = null
  actionError.value = null
}

function statusTone(status: ProvisioningStatus) {
  if (status === 'active') return 'success' as const
  if (status === 'failed') return 'danger' as const
  if (status === 'queued') return 'neutral' as const
  return 'info' as const
}

function statusLabel(value: ProvisioningStatus) {
  if (value === 'active') return 'provisioned'
  return value.replaceAll('_', ' ')
}

function resourceStatusTone(status: ApiProvisioningJob['resourceStatus']) {
  if (status === 'running') return 'success' as const
  if (status === 'restarting') return 'info' as const
  if (status === 'degraded' || status === 'stopped') return 'danger' as const
  return 'neutral' as const
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / provisioning
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Deployment Provisioning</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Buat aplikasi Coolify dari blueprint, terapkan environment dan domain, lalu pantau health
          serta SSL sampai aktif.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :class="{ 'animate-spin': status === 'pending' }" />
          Refresh
        </UiButton>
        <NuxtLink
          to="/blueprints"
          class="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink transition hover:border-muted hover:bg-[#1a222d]"
        >
          <FileCode2 :size="15" />
          Kelola blueprint
        </NuxtLink>
        <UiButton @click="openJobDialog">
          <Rocket :size="15" />
          Provision app
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

    <UiDialog
      v-if="showJobForm"
      title="Provision aplikasi"
      description="Pilih langganan customer sebagai pemilik aplikasi, lalu worker membuat dan menghubungkan resource Coolify secara otomatis."
      size="lg"
      :close-disabled="queueing"
      @close="showJobForm = false"
    >
      <p
        v-if="actionError"
        class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ actionError }}
      </p>
      <form class="grid gap-4 md:grid-cols-2" @submit.prevent="queueJob">
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Blueprint</span>
          <select
            v-model="jobForm.blueprintId"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            required
          >
            <option value="" disabled>Pilih blueprint</option>
            <option
              v-for="blueprint in data?.blueprints.filter((item) => item.isActive)"
              :key="blueprint.id"
              :value="blueprint.id"
            >
              {{ blueprint.name }} · {{ blueprint.buildPack }}
            </option>
          </select>
        </label>
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">
            Target service (langganan customer)
          </span>
          <select
            v-model="jobForm.serviceId"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            required
          >
            <option value="" disabled>Pilih service</option>
            <option v-for="service in data?.services" :key="service.id" :value="service.id">
              {{ service.serviceNumber }} · {{ service.customerName }} · {{ service.name }} ·
              {{ service.planName || 'Plan lama' }} · DB {{ service.databaseMode }}
            </option>
          </select>
          <span class="mt-1 block text-xs leading-5 text-muted">
            Service dibuat lebih dahulu dari menu Services tanpa harus memilih aplikasi. Hasil
            provisioning otomatis menjadi resource milik service tersebut.
          </span>
        </label>
        <p
          v-if="databaseCompatibilityError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger md:col-span-2"
        >
          {{ databaseCompatibilityError }}
        </p>
        <UiInput v-model="jobForm.applicationName" label="Nama aplikasi" required />
        <UiInput
          v-model="jobForm.hostname"
          label="Hostname (opsional)"
          placeholder="customer-a.ocnetworks.web.id"
        />
        <label v-if="jobForm.hostname" class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Tipe domain</span>
          <select
            v-model="jobForm.domainType"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="platform">Platform</option>
            <option value="custom">Custom hostname</option>
          </select>
        </label>
        <label class="block md:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">Environment values</span>
          <textarea
            v-model="jobForm.environmentText"
            rows="6"
            autocomplete="off"
            class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-sm text-ink"
            placeholder="DATABASE_URL=...&#10;APP_SECRET=..."
          />
          <span class="mt-1 block text-xs text-muted">
            Nilai dienkripsi di database dan dihapus dari job setelah provisioning aktif.
          </span>
        </label>
        <label v-if="selectedService?.databaseMode === 'shared'" class="block md:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">Import SQL (opsional)</span>
          <input
            type="file"
            accept=".sql,application/sql,text/plain"
            class="focus-ring block w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-brand/10 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-brand"
            @change="selectSqlFile"
          />
          <span class="mt-1 block text-xs text-muted">
            Maksimal 10 MB. Dijalankan sebagai role aplikasi dalam satu transaksi sebelum deploy.
          </span>
        </label>
        <div class="flex justify-end gap-2 md:col-span-2">
          <UiButton
            type="button"
            variant="secondary"
            :disabled="queueing"
            @click="showJobForm = false"
          >
            Batal
          </UiButton>
          <UiButton type="submit" :disabled="queueing || Boolean(databaseCompatibilityError)">
            {{ queueing ? 'Mengantrekan…' : 'Mulai provisioning' }}
          </UiButton>
        </div>
      </form>
    </UiDialog>

    <div v-if="status === 'pending' && !data" class="grid gap-4">
      <UiSkeleton v-for="item in 3" :key="item" height="9rem" />
    </div>
    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Gagal memuat provisioning"
        description="Periksa koneksi database dan muat ulang halaman."
      />
    </UiCard>
    <UiCard v-else-if="!data?.jobs.length" :padded="false">
      <UiEmptyState
        title="Belum ada provisioning job"
        description="Buat blueprint lalu provision aplikasi pertama."
      />
    </UiCard>
    <div v-else class="space-y-4">
      <UiCard v-for="job in data.jobs" :key="job.id">
        <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-semibold text-ink">{{ job.applicationName }}</h2>
              <UiBadge :tone="statusTone(job.status)" dot>{{ statusLabel(job.status) }}</UiBadge>
              <UiBadge v-if="job.resourceStatus" :tone="resourceStatusTone(job.resourceStatus)" dot>
                container {{ job.resourceStatus }}
              </UiBadge>
            </div>
            <p class="mt-1 text-xs text-muted">
              {{ job.customerName }} · {{ job.serviceNumber }} · {{ job.blueprintName }}
            </p>
            <p v-if="job.hostname" class="mt-1 font-mono text-[11px] text-muted">
              {{ job.hostname }}
            </p>
            <p v-if="job.databaseName" class="mt-1 font-mono text-[11px] text-muted">
              {{ job.databaseClusterName }} · {{ job.databaseName }} · {{ job.databaseRoleName }}
            </p>
          </div>
          <UiButton
            v-if="job.status === 'failed'"
            variant="secondary"
            size="sm"
            :disabled="retryingId === job.id"
            @click="retryJob(job.id)"
          >
            <RotateCcw :size="13" />
            Retry
          </UiButton>
        </div>

        <p
          v-if="job.lastError"
          class="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {{ job.lastError }}
        </p>

        <dl class="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-3">
          <div>
            <dt class="text-muted">Application UUID</dt>
            <dd class="mt-1 truncate font-mono text-ink">
              {{ job.coolifyApplicationUuid || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">SQL import</dt>
            <dd class="mt-1 truncate font-mono text-ink">
              {{ job.sqlImportFilename || '—' }}{{ job.sqlImportedAt ? ' · imported' : '' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">Deployment UUID</dt>
            <dd class="mt-1 truncate font-mono text-ink">
              {{ job.coolifyDeploymentUuid || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">Attempt</dt>
            <dd class="mt-1 font-mono text-ink">{{ job.attemptCount }}/{{ job.maxAttempts }}</dd>
          </div>
        </dl>

        <div v-if="job.events.length" class="mt-4 border-t pt-4">
          <h3 class="mb-2 text-xs font-semibold text-muted">Job log</h3>
          <ol class="space-y-1.5">
            <li
              v-for="eventItem in job.events.slice(0, 6)"
              :key="eventItem.id"
              class="flex gap-3 text-xs"
            >
              <span class="shrink-0 font-mono text-[10px] text-muted">
                {{ dateTime(eventItem.createdAt) }}
              </span>
              <span :class="eventItem.level === 'error' ? 'text-danger' : 'text-ink'">
                {{ eventItem.message }}
              </span>
            </li>
          </ol>
        </div>
      </UiCard>
    </div>
  </div>
</template>
