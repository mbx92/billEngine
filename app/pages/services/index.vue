<script setup lang="ts">
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
} from '@lucide/vue'
import type {
  ApiService,
  ApiServiceOptions,
  ApiInfrastructureReconciliationPreview,
  ApiInfrastructureReconciliationResult,
  InfrastructureComplianceStatus,
  Paginated,
} from '#shared/types/api'
import { billingCycleUnit } from '#shared/utils/billing-display'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Services · Billing Infra' })

const format = useFormat()
const appSettings = useAppSettings()
const page = ref(1)
const perPage = 25
const showAddForm = ref(false)
const wizardStep = ref(1)
const wizardError = ref<string | null>(null)
const resourceQuery = ref('')
const saving = ref(false)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const selectedService = ref<ApiService | null>(null)
const showEditForm = ref(false)
const showTransitionForm = ref(false)
const showInfrastructureDialog = ref(false)
const infrastructureLoading = ref(false)
const infrastructureApplying = ref(false)
const infrastructureError = ref<string | null>(null)
const infrastructurePreview = ref<ApiInfrastructureReconciliationPreview | null>(null)
const infrastructureResult = ref<ApiInfrastructureReconciliationResult | null>(null)
const restartRunning = ref(true)
const transitionTarget = ref<'active' | 'suspended' | 'cancelled'>('suspended')
const transitionReason = ref('')
const editForm = reactive({
  planId: '',
  name: '',
  description: '',
  nextDueDate: '',
  invoiceLeadDays: '0',
  paymentDueDays: '7',
  taxRate: '',
  resourceIds: [] as string[],
})
const today = new Date().toLocaleDateString('en-CA', {
  timeZone: appSettings.value.billingTimezone,
})
const form = reactive({
  customerId: '',
  planId: '',
  name: '',
  description: '',
  billingStartDate: today,
  nextDueDate: today,
  invoiceLeadDays: '0',
  paymentDueDays: '7',
  taxRate: appSettings.value.defaultTaxRate ?? '',
  resourceIds: [] as string[],
})

const { data, status, error, refresh } = await useFetch<Paginated<ApiService>>('/api/services', {
  query: { page, perPage },
})
const { data: optionData, refresh: refreshOptions } = await useFetch<{ data: ApiServiceOptions }>(
  '/api/services/options',
)

const services = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta)
const plans = computed(() => optionData.value?.data.plans ?? [])
const customers = computed(() => optionData.value?.data.customers ?? [])
const resources = computed(() => optionData.value?.data.resources ?? [])
const selectedCustomer = computed(() =>
  customers.value.find((customer) => customer.id === form.customerId),
)
const selectedPlan = computed(() => plans.value.find((plan) => plan.id === form.planId))
const selectedResources = computed(() =>
  resources.value.filter((resource) => form.resourceIds.includes(resource.id)),
)
const filteredResources = computed(() => {
  const query = resourceQuery.value.trim().toLocaleLowerCase()
  if (!query) return resources.value
  return resources.value.filter((resource) =>
    [resource.name, resource.serverName, resource.projectName, resource.environmentName]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query)),
  )
})
const wizardSteps = [
  { number: 1, label: 'Service' },
  { number: 2, label: 'Billing' },
  { number: 3, label: 'App yang sudah ada' },
  { number: 4, label: 'Konfirmasi' },
]

function infrastructureLabel(status: InfrastructureComplianceStatus) {
  return {
    matched: 'Sesuai plan',
    under_allocated: 'Di bawah plan',
    over_allocated: 'Melebihi plan',
    mixed: 'Allocation mismatch',
    unknown: 'Limit tidak diketahui',
    not_configured: 'Quota belum diatur',
  }[status]
}

function infrastructureTone(
  status: InfrastructureComplianceStatus,
): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'matched') return 'success'
  if (status === 'over_allocated' || status === 'mixed') return 'danger'
  if (status === 'under_allocated' || status === 'unknown') return 'warning'
  return 'neutral'
}

watch(
  () => form.billingStartDate,
  (startDate) => {
    form.nextDueDate = startDate
  },
  { immediate: true },
)

function resetForm() {
  Object.assign(form, {
    customerId: '',
    planId: '',
    name: '',
    description: '',
    billingStartDate: today,
    nextDueDate: today,
    invoiceLeadDays: '0',
    paymentDueDays: '7',
    taxRate: appSettings.value.defaultTaxRate ?? '',
    resourceIds: [],
  })
  wizardStep.value = 1
  wizardError.value = null
  resourceQuery.value = ''
}

function openServiceDialog() {
  actionError.value = null
  wizardError.value = null
  showAddForm.value = true
}

function closeServiceDialog() {
  if (saving.value) return
  showAddForm.value = false
  resetForm()
}

function validateCurrentStep() {
  if (wizardStep.value === 1) {
    if (!form.customerId) return 'Pilih customer untuk service ini.'
    if (!form.planId) return 'Pilih plan untuk service ini.'
    if (form.name.trim().length < 2) return 'Nama service minimal 2 karakter.'
  }

  if (wizardStep.value === 2) {
    if (!form.billingStartDate) return 'Tanggal mulai billing wajib diisi.'
    if (!form.nextDueDate) {
      return 'Jadwal invoice pertama wajib diisi.'
    }
    if (form.nextDueDate < form.billingStartDate) {
      return 'Jadwal invoice pertama tidak boleh sebelum tanggal mulai billing.'
    }
    const leadDays = Number(form.invoiceLeadDays)
    const dueDays = Number(form.paymentDueDays)
    if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365) {
      return 'Jarak generate invoice harus antara 0–365 hari.'
    }
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) {
      return 'Batas pembayaran harus antara 0–365 hari.'
    }
    if (form.taxRate !== '') {
      const taxRate = Number(form.taxRate)
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
        return 'Tax rate harus berada di antara 0 dan 1.'
      }
    }
  }

  return null
}

function nextStep() {
  actionError.value = null
  const validationError = validateCurrentStep()
  if (validationError) {
    wizardError.value = validationError
    return
  }
  wizardError.value = null
  wizardStep.value = Math.min(wizardStep.value + 1, wizardSteps.length)
}

function previousStep() {
  actionError.value = null
  wizardError.value = null
  wizardStep.value = Math.max(wizardStep.value - 1, 1)
}

async function addService() {
  saving.value = true
  actionError.value = null
  actionMessage.value = null

  try {
    const response = await $fetch<{ data: { serviceNumber: string; name: string } }>(
      '/api/services',
      {
        method: 'POST',
        body: {
          customerId: form.customerId,
          planId: form.planId,
          name: form.name,
          description: form.description,
          billingStartDate: form.billingStartDate,
          nextDueDate: form.nextDueDate,
          invoiceLeadDays: form.invoiceLeadDays,
          paymentDueDays: form.paymentDueDays,
          taxRate: form.taxRate,
          resourceIds: form.resourceIds,
        },
      },
    )
    actionMessage.value = `${response.data.serviceNumber} · ${response.data.name} berhasil ditambahkan.`
    showAddForm.value = false
    resetForm()
    page.value = 1
    await Promise.all([refresh(), refreshOptions()])
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal menambahkan service.')
  } finally {
    saving.value = false
  }
}

function openEdit(service: ApiService) {
  selectedService.value = service
  Object.assign(editForm, {
    planId: service.planId ?? '',
    name: service.name,
    description: service.description ?? '',
    nextDueDate: service.nextDueDate ?? '',
    invoiceLeadDays: String(service.invoiceLeadDays),
    paymentDueDays: String(service.paymentDueDays),
    taxRate: service.taxRate ?? '',
    resourceIds: service.resources.map((resource) => resource.id),
  })
  showEditForm.value = true
}

const editResources = computed(() => {
  const current = selectedService.value?.resources ?? []
  const merged = new Map(resources.value.map((resource) => [resource.id, resource]))
  for (const resource of current) {
    if (!merged.has(resource.id)) {
      merged.set(resource.id, {
        ...resource,
        serverName: 'Current assignment',
        projectName: null,
        environmentName: null,
      })
    }
  }
  return [...merged.values()]
})

async function updateService() {
  if (!selectedService.value) return
  saving.value = true
  actionError.value = null
  try {
    await $fetch(`/api/services/${selectedService.value.id}`, {
      method: 'PATCH',
      body: { ...editForm, nextDueDate: editForm.nextDueDate || null },
    })
    actionMessage.value = `${selectedService.value.serviceNumber} berhasil diperbarui.`
    showEditForm.value = false
    await Promise.all([refresh(), refreshOptions()])
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal memperbarui service.')
  } finally {
    saving.value = false
  }
}

function openTransition(service: ApiService, target: 'active' | 'suspended' | 'cancelled') {
  selectedService.value = service
  transitionTarget.value = target
  transitionReason.value = ''
  showTransitionForm.value = true
}

async function transitionService() {
  if (!selectedService.value) return
  saving.value = true
  actionError.value = null
  try {
    await $fetch(`/api/services/${selectedService.value.id}/transition`, {
      method: 'POST',
      body: { status: transitionTarget.value, reason: transitionReason.value },
    })
    actionMessage.value = `${selectedService.value.serviceNumber} sekarang berstatus ${transitionTarget.value}.`
    showTransitionForm.value = false
    await Promise.all([refresh(), refreshOptions()])
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Status service gagal diubah.')
  } finally {
    saving.value = false
  }
}

async function openInfrastructure(service: ApiService) {
  selectedService.value = service
  showInfrastructureDialog.value = true
  infrastructureLoading.value = true
  infrastructureError.value = null
  infrastructurePreview.value = null
  infrastructureResult.value = null
  restartRunning.value = true

  try {
    const response = await $fetch<{ data: ApiInfrastructureReconciliationPreview }>(
      `/api/services/${service.id}/infrastructure`,
    )
    infrastructurePreview.value = response.data
  } catch (caught) {
    infrastructureError.value = apiErrorMessage(caught, 'Preview infrastructure gagal dimuat.')
  } finally {
    infrastructureLoading.value = false
  }
}

function closeInfrastructure() {
  if (infrastructureApplying.value) return
  showInfrastructureDialog.value = false
}

async function applyInfrastructure() {
  if (!selectedService.value || !infrastructurePreview.value?.canApply) return
  infrastructureApplying.value = true
  infrastructureError.value = null
  infrastructureResult.value = null

  try {
    const response = await $fetch<{ data: ApiInfrastructureReconciliationResult }>(
      `/api/services/${selectedService.value.id}/infrastructure`,
      {
        method: 'POST',
        body: {
          fingerprint: infrastructurePreview.value.fingerprint,
          restartRunning: restartRunning.value,
        },
      },
    )
    infrastructureResult.value = response.data
    infrastructurePreview.value = response.data.preview
    actionMessage.value =
      response.data.status === 'completed'
        ? `${response.data.updatedCount} resource berhasil disesuaikan dengan plan.`
        : `Rekonsiliasi selesai sebagian: ${response.data.updatedCount} berhasil, ${response.data.failedCount} gagal.`
    await Promise.all([refresh(), refreshOptions()])
  } catch (caught) {
    infrastructureError.value = apiErrorMessage(caught, 'Resource gagal disesuaikan dengan plan.')
  } finally {
    infrastructureApplying.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Commercial / services
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Services</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Service customer berdasarkan plan, jadwal billing, dan resource Coolify yang terhubung.
        </p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
          Refresh
        </UiButton>
        <UiButton :disabled="plans.length === 0" @click="openServiceDialog">
          <Plus :size="15" aria-hidden="true" />
          Tambah service
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
    <UiDialog
      v-if="showAddForm"
      title="Tambah service"
      description="Lengkapi konfigurasi service dalam empat langkah."
      size="xl"
      :close-disabled="saving"
      @close="closeServiceDialog"
    >
      <nav aria-label="Progress tambah service" class="mb-6">
        <ol class="grid grid-cols-4 gap-2">
          <li v-for="step in wizardSteps" :key="step.number" class="min-w-0">
            <div
              class="mb-2 h-1 rounded-full transition-colors"
              :class="step.number <= wizardStep ? 'bg-brand' : 'bg-line-strong'"
            />
            <div class="flex items-center gap-2">
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold"
                :class="
                  step.number < wizardStep
                    ? 'border-brand bg-brand text-[#071109]'
                    : step.number === wizardStep
                      ? 'border-brand text-brand'
                      : 'border-line-strong text-muted'
                "
              >
                <Check v-if="step.number < wizardStep" :size="12" aria-hidden="true" />
                <template v-else>{{ step.number }}</template>
              </span>
              <span
                class="truncate text-[10px] font-semibold tracking-wide uppercase sm:text-xs"
                :class="step.number === wizardStep ? 'text-ink' : 'text-muted'"
              >
                {{ step.label }}
              </span>
            </div>
          </li>
        </ol>
      </nav>

      <p
        v-if="wizardError || actionError"
        class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ wizardError || actionError }}
      </p>

      <form id="add-service-form" @submit.prevent="addService">
        <div v-if="wizardStep === 1" class="grid gap-4 md:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Customer</span>
            <select
              v-model="form.customerId"
              autofocus
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="" disabled>Pilih customer aktif</option>
              <option v-for="customer in customers" :key="customer.id" :value="customer.id">
                {{ customer.companyName || customer.name }} · {{ customer.customerNumber }}
              </option>
            </select>
            <span v-if="customers.length === 0" class="mt-1.5 block text-xs text-warning">
              Belum ada customer aktif.
              <NuxtLink class="font-semibold underline" to="/customers">Tambah customer</NuxtLink>
              terlebih dahulu.
            </span>
          </label>
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Plan</span>
            <select
              v-model="form.planId"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="" disabled>Pilih plan aktif</option>
              <option v-for="plan in plans" :key="plan.id" :value="plan.id">
                {{ plan.name }} · {{ format.money(plan.priceAmount, plan.currency) }}
              </option>
            </select>
            <span v-if="plans.length === 0" class="mt-1.5 block text-xs text-warning">
              Belum ada plan aktif.
              <NuxtLink class="font-semibold underline" to="/plans">Buat plan</NuxtLink>
              terlebih dahulu.
            </span>
          </label>
          <UiInput v-model="form.name" label="Nama service" placeholder="Production Hosting" />
          <label class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Deskripsi</span>
            <textarea
              v-model="form.description"
              rows="4"
              placeholder="Keterangan service untuk kebutuhan internal dan invoice."
              class="focus-ring min-h-10 w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted/60"
            />
          </label>
          <div
            v-if="selectedPlan"
            class="rounded-md border border-brand/25 bg-brand/5 p-4 md:col-span-2"
          >
            <div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div>
                <p class="text-sm font-semibold text-ink">{{ selectedPlan.name }}</p>
                <p v-if="selectedPlan.description" class="mt-1 text-xs text-muted">
                  {{ selectedPlan.description }}
                </p>
              </div>
              <p class="shrink-0 font-mono text-sm font-semibold text-ink">
                {{ format.money(selectedPlan.priceAmount, selectedPlan.currency) }}
                <template v-if="selectedPlan.billingCycle !== 'one_time'">
                  / {{ billingCycleUnit(selectedPlan.billingCycle) }}
                </template>
              </p>
            </div>
            <ul class="mt-3 grid gap-1.5 border-t pt-3 text-xs text-ink sm:grid-cols-2">
              <li v-for="item in selectedPlan.inclusions" :key="item" class="flex gap-2">
                <Check class="mt-0.5 shrink-0 text-brand" :size="12" aria-hidden="true" />
                {{ item }}
              </li>
            </ul>
          </div>
          <p class="text-xs leading-5 text-muted md:col-span-2">
            Service adalah langganan milik customer dan dapat dibuat sebelum aplikasinya ada. Untuk
            aplikasi baru, buat service ini tanpa resource lalu lanjutkan dari halaman
            <NuxtLink class="font-semibold text-brand underline" to="/provisioning">
              Provisioning
            </NuxtLink>
            .
          </p>
        </div>

        <div v-else-if="wizardStep === 2" class="grid gap-4 md:grid-cols-2">
          <div class="rounded-md border bg-canvas/60 p-4 md:col-span-2">
            <p class="text-xs font-semibold tracking-wide text-muted uppercase">
              Billing dari plan
            </p>
            <div class="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <span class="font-medium text-ink">{{ selectedPlan?.name }}</span>
              <span class="font-mono text-sm font-semibold text-ink">
                {{
                  format.money(selectedPlan?.priceAmount ?? '0', selectedPlan?.currency ?? 'IDR')
                }}
                <template v-if="selectedPlan?.billingCycle !== 'one_time'">
                  / {{ billingCycleUnit(selectedPlan?.billingCycle ?? 'monthly') }}
                </template>
              </span>
            </div>
            <p class="mt-2 text-xs text-muted">
              Harga dan siklus disalin dari plan sebagai snapshot saat service dibuat.
            </p>
          </div>
          <UiInput v-model="form.billingStartDate" label="Mulai billing" type="date" />
          <UiInput
            v-model="form.nextDueDate"
            label="Jadwal invoice pertama"
            hint="Sama dengan tanggal mulai billing; jadwal berikutnya maju otomatis setelah invoice dibuat."
            type="date"
            readonly
          />
          <UiInput
            v-model="form.invoiceLeadDays"
            label="Generate sebelum jadwal invoice (hari)"
            type="number"
            min="0"
            max="365"
          />
          <UiInput
            v-model="form.paymentDueDays"
            label="Batas pembayaran (hari)"
            type="number"
            min="0"
            max="365"
          />
          <UiInput
            v-model="form.taxRate"
            label="Tax rate"
            hint="Gunakan desimal, misalnya 0.11 untuk 11%."
            inputmode="decimal"
            placeholder="0.11"
          />
        </div>

        <div v-else-if="wizardStep === 3">
          <div class="mb-4 rounded-md border border-info/30 bg-info/10 px-4 py-3">
            <p class="text-sm font-semibold text-ink">Langkah ini khusus aplikasi yang sudah ada</p>
            <p class="mt-1 text-xs leading-5 text-muted">
              Kosongkan pilihan jika aplikasi akan dibuat oleh Provisioning. Resource Coolify yang
              baru akan dihubungkan ke service ini secara otomatis setelah dibuat.
            </p>
          </div>
          <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 class="text-sm font-semibold text-ink">
                Hubungkan aplikasi Coolify yang sudah ada
              </h3>
              <p class="mt-1 text-xs text-muted">
                Opsional, untuk adopsi atau migrasi. Hanya resource billable yang belum dipakai
                service lain yang ditampilkan.
              </p>
            </div>
            <UiInput
              v-if="resources.length"
              v-model="resourceQuery"
              placeholder="Cari resource / server…"
              class="sm:w-64"
            />
          </div>
          <div v-if="filteredResources.length" class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="resource in filteredResources"
              :key="resource.id"
              class="flex cursor-pointer items-start gap-3 rounded-md border bg-canvas p-3 text-sm transition"
              :class="
                form.resourceIds.includes(resource.id)
                  ? 'border-brand/60 bg-brand/5'
                  : 'border-line-strong hover:border-muted'
              "
            >
              <input
                v-model="form.resourceIds"
                type="checkbox"
                :value="resource.id"
                class="mt-0.5 size-4 accent-brand"
              />
              <span class="min-w-0">
                <span class="block truncate font-medium text-ink">{{ resource.name }}</span>
                <span class="block truncate text-xs text-muted">
                  {{ resource.serverName
                  }}<template v-if="resource.projectName"> · {{ resource.projectName }}</template>
                </span>
                <span class="mt-1 block font-mono text-[11px] text-muted">
                  {{ format.cpu(resource.limitsCpus) }} ·
                  {{ format.bytes(resource.limitsMemoryBytes) }}
                </span>
              </span>
            </label>
          </div>
          <p v-else class="rounded-md border border-dashed p-4 text-center text-xs text-muted">
            {{
              resourceQuery
                ? 'Resource tidak ditemukan.'
                : 'Tidak ada resource billable yang belum digunakan. Service tetap dapat dibuat tanpa resource.'
            }}
          </p>
        </div>

        <div v-else class="space-y-4">
          <div class="rounded-lg border border-line-strong bg-canvas/60 p-4">
            <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <p class="text-xs font-semibold tracking-wide text-muted uppercase">Service</p>
                <h3 class="mt-1 text-base font-semibold text-ink">{{ form.name }}</h3>
                <p class="mt-1 text-xs text-muted">
                  {{ selectedCustomer?.companyName || selectedCustomer?.name }} ·
                  {{ selectedCustomer?.customerNumber }}
                </p>
              </div>
              <p class="font-mono text-base font-semibold text-ink">
                {{
                  format.money(selectedPlan?.priceAmount ?? '0', selectedPlan?.currency ?? 'IDR')
                }}
                <template v-if="selectedPlan?.billingCycle === 'one_time'"> sekali bayar</template>
                <template v-else>
                  / {{ billingCycleUnit(selectedPlan?.billingCycle ?? 'monthly') }}
                </template>
              </p>
            </div>
            <dl class="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-3">
              <div>
                <dt class="text-muted">Plan</dt>
                <dd class="mt-1 font-medium text-ink">
                  {{ selectedPlan?.name }} ·
                  {{ format.billingCycle(selectedPlan?.billingCycle ?? 'monthly') }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Mulai billing</dt>
                <dd class="mt-1 font-mono text-ink">{{ format.date(form.billingStartDate) }}</dd>
              </div>
              <div>
                <dt class="text-muted">Invoice pertama</dt>
                <dd class="mt-1 font-mono text-ink">
                  {{ format.date(form.nextDueDate) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Generate invoice</dt>
                <dd class="mt-1 text-ink">{{ form.invoiceLeadDays }} hari sebelumnya</dd>
              </div>
              <div>
                <dt class="text-muted">Batas pembayaran</dt>
                <dd class="mt-1 text-ink">{{ form.paymentDueDays }} hari</dd>
              </div>
              <div>
                <dt class="text-muted">Tax rate</dt>
                <dd class="mt-1 text-ink">{{ form.taxRate || 'Tanpa pajak' }}</dd>
              </div>
            </dl>
            <div v-if="selectedPlan" class="mt-4 border-t pt-4">
              <p class="mb-2 text-xs font-semibold text-muted">Termasuk dalam plan</p>
              <div class="flex flex-wrap gap-2">
                <UiBadge v-if="selectedPlan.includedResourceCount" tone="info">
                  {{ selectedPlan.includedResourceCount }} resource
                </UiBadge>
                <UiBadge v-if="selectedPlan.includedCpuCores" tone="info">
                  {{ format.cpu(selectedPlan.includedCpuCores) }}
                </UiBadge>
                <UiBadge v-if="selectedPlan.includedMemoryBytes" tone="info">
                  {{ format.bytes(selectedPlan.includedMemoryBytes) }}
                </UiBadge>
                <UiBadge v-for="item in selectedPlan.inclusions" :key="item" tone="success">
                  {{ item }}
                </UiBadge>
              </div>
            </div>
          </div>
          <div>
            <p class="mb-2 text-xs font-semibold text-muted">
              {{ selectedResources.length }} resource dipilih
            </p>
            <div v-if="selectedResources.length" class="flex flex-wrap gap-2">
              <UiBadge v-for="resource in selectedResources" :key="resource.id">
                {{ resource.name }} · {{ resource.serverName }}
              </UiBadge>
            </div>
            <p v-else class="text-xs text-muted">
              Belum ada aplikasi yang dihubungkan. Service siap dipilih sebagai target Provisioning.
            </p>
          </div>
        </div>
      </form>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <UiButton variant="secondary" :disabled="saving" @click="closeServiceDialog">
            Batal
          </UiButton>
          <div class="flex gap-2">
            <UiButton
              v-if="wizardStep > 1"
              variant="secondary"
              :disabled="saving"
              @click="previousStep"
            >
              <ChevronLeft :size="15" aria-hidden="true" />
              Kembali
            </UiButton>
            <UiButton
              v-if="wizardStep < wizardSteps.length"
              :disabled="customers.length === 0 || plans.length === 0"
              @click="nextStep"
            >
              Lanjut
              <ChevronRight :size="15" aria-hidden="true" />
            </UiButton>
            <UiButton v-else type="submit" form="add-service-form" :disabled="saving">
              {{ saving ? 'Menyimpan…' : 'Buat service' }}
            </UiButton>
          </div>
        </div>
      </template>
    </UiDialog>

    <UiDialog
      v-if="showInfrastructureDialog && selectedService"
      title="Terapkan plan ke infrastructure"
      :description="`${selectedService.serviceNumber} · ${selectedService.name}`"
      size="xl"
      :close-disabled="infrastructureApplying"
      @close="closeInfrastructure"
    >
      <div v-if="infrastructureLoading" class="space-y-3">
        <UiSkeleton v-for="row in 3" :key="row" height="3.5rem" />
      </div>

      <template v-else>
        <p
          v-if="infrastructureError"
          class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {{ infrastructureError }}
        </p>

        <template v-if="infrastructurePreview">
          <div class="mb-4 grid gap-3 sm:grid-cols-3">
            <div class="rounded-md border bg-canvas/60 p-3">
              <p class="text-[10px] font-semibold tracking-wide text-muted uppercase">Plan</p>
              <p class="mt-1 text-sm font-medium text-ink">
                {{ infrastructurePreview.planName || 'Legacy' }}
              </p>
            </div>
            <div class="rounded-md border bg-canvas/60 p-3">
              <p class="text-[10px] font-semibold tracking-wide text-muted uppercase">Resource</p>
              <p class="mt-1 font-mono text-sm text-ink">
                {{ infrastructurePreview.actualResourceCount }} /
                {{ infrastructurePreview.expectedResourceCount ?? '—' }}
              </p>
            </div>
            <div class="rounded-md border bg-canvas/60 p-3">
              <p class="text-[10px] font-semibold tracking-wide text-muted uppercase">Perubahan</p>
              <p class="mt-1 font-mono text-sm text-ink">
                {{ infrastructurePreview.resources.filter((resource) => resource.changed).length }}
                resource
              </p>
            </div>
          </div>

          <p
            v-if="infrastructurePreview.blockingReason"
            class="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            {{ infrastructurePreview.blockingReason }}
          </p>

          <div class="overflow-x-auto rounded-md border">
            <table class="w-full min-w-[680px] text-left text-xs">
              <thead class="border-b bg-canvas/60 text-[10px] tracking-wide text-muted uppercase">
                <tr>
                  <th class="px-3 py-2 font-semibold">Resource</th>
                  <th class="px-3 py-2 font-semibold">CPU sekarang → plan</th>
                  <th class="px-3 py-2 font-semibold">RAM sekarang → plan</th>
                  <th class="px-3 py-2 font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="resource in infrastructurePreview.resources"
                  :key="resource.id"
                  class="border-b last:border-0"
                >
                  <td class="px-3 py-3">
                    <span class="block font-medium text-ink">{{ resource.name }}</span>
                    <span class="text-[10px] text-muted">{{ resource.serverName }}</span>
                  </td>
                  <td class="px-3 py-3 font-mono text-muted">
                    {{ format.cpu(resource.currentCpuCores) }} →
                    {{ format.cpu(resource.desiredCpuCores) }}
                  </td>
                  <td class="px-3 py-3 font-mono text-muted">
                    {{ format.bytes(resource.currentMemoryBytes) }} →
                    {{ format.bytes(resource.desiredMemoryBytes) }}
                  </td>
                  <td class="px-3 py-3">
                    <UiBadge :tone="resource.changed ? 'warning' : 'success'">
                      {{ resource.changed ? 'Akan diubah' : 'Sesuai' }}
                    </UiBadge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <label
            v-if="infrastructurePreview.restartRequired"
            class="mt-4 flex items-start gap-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm"
          >
            <input v-model="restartRunning" type="checkbox" class="mt-0.5 size-4 accent-brand" />
            <span>
              <span class="block font-medium text-ink"
                >Restart application yang sedang berjalan</span
              >
              <span class="mt-1 block text-xs leading-5 text-muted">
                Coolify memerlukan restart atau redeploy agar limit baru aktif pada container.
                Restart dapat menyebabkan interupsi singkat.
              </span>
            </span>
          </label>

          <div
            v-if="infrastructureResult"
            class="mt-4 rounded-md border border-brand/30 bg-brand/5 p-3"
          >
            <p class="text-sm font-semibold text-ink">
              {{
                infrastructureResult.status === 'completed'
                  ? 'Rekonsiliasi berhasil'
                  : infrastructureResult.status === 'partial'
                    ? 'Rekonsiliasi selesai sebagian'
                    : 'Rekonsiliasi gagal'
              }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ infrastructureResult.updatedCount }} diperbarui ·
              {{ infrastructureResult.restartedCount }} restart dijadwalkan ·
              {{ infrastructureResult.failedCount }} gagal
            </p>
            <p v-if="infrastructureResult.verificationFailed" class="mt-2 text-xs text-warning">
              Sinkronisasi verifikasi gagal. Jalankan Sync Coolify sebelum mencoba kembali.
            </p>
            <ul class="mt-3 space-y-1 text-xs text-muted">
              <li v-for="resource in infrastructureResult.resources" :key="resource.id">
                {{ resource.name }} · {{ resource.message || resource.status }}
              </li>
            </ul>
          </div>
        </template>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton
            variant="secondary"
            :disabled="infrastructureApplying"
            @click="closeInfrastructure"
          >
            Tutup
          </UiButton>
          <UiButton
            :disabled="
              infrastructureApplying || infrastructureLoading || !infrastructurePreview?.canApply
            "
            @click="applyInfrastructure"
          >
            {{ infrastructureApplying ? 'Menerapkan…' : 'Terapkan ke Coolify' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiDialog
      v-if="showEditForm && selectedService"
      title="Edit service"
      :description="`${selectedService.serviceNumber} · perubahan plan berlaku untuk invoice berikutnya.`"
      size="xl"
      :close-disabled="saving"
      @close="showEditForm = false"
    >
      <form
        id="edit-service-form"
        class="grid gap-4 md:grid-cols-2"
        @submit.prevent="updateService"
      >
        <UiInput v-model="editForm.name" label="Nama service" required />
        <label>
          <span class="mb-2 block text-xs font-semibold text-muted">Plan</span>
          <select
            v-model="editForm.planId"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option v-for="plan in plans" :key="plan.id" :value="plan.id">
              {{ plan.name }} · {{ format.money(plan.priceAmount, plan.currency) }}
            </option>
          </select>
        </label>
        <UiInput v-model="editForm.nextDueDate" label="Invoice berikutnya" type="date" />
        <UiInput v-model="editForm.taxRate" label="Tax rate" placeholder="0.11" />
        <UiInput
          v-model="editForm.invoiceLeadDays"
          label="Generate lebih awal (hari)"
          type="number"
          min="0"
          max="365"
        />
        <UiInput
          v-model="editForm.paymentDueDays"
          label="Batas pembayaran (hari)"
          type="number"
          min="0"
          max="365"
        />
        <label class="md:col-span-2"
          ><span class="mb-2 block text-xs font-semibold text-muted">Deskripsi</span
          ><textarea
            v-model="editForm.description"
            rows="3"
            class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink"
          />
        </label>
        <fieldset class="md:col-span-2">
          <legend class="mb-2 text-xs font-semibold text-muted">Resources</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="resource in editResources"
              :key="resource.id"
              class="flex items-center gap-2 rounded-md border p-3 text-sm text-ink"
              ><input
                v-model="editForm.resourceIds"
                type="checkbox"
                :value="resource.id"
                class="accent-brand"
              />{{ resource.name }}
              <span class="text-xs text-muted">· {{ resource.serverName }}</span></label
            >
          </div>
        </fieldset>
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="showEditForm = false"
            >Batal</UiButton
          ><UiButton type="submit" form="edit-service-form" :disabled="saving">{{
            saving ? 'Menyimpan…' : 'Simpan perubahan'
          }}</UiButton>
        </div></template
      >
    </UiDialog>

    <UiDialog
      v-if="showTransitionForm && selectedService"
      :title="`${transitionTarget === 'active' ? 'Aktifkan' : transitionTarget === 'suspended' ? 'Suspend' : 'Batalkan'} service?`"
      :description="`${selectedService.serviceNumber} · ${selectedService.name}`"
      :close-disabled="saving"
      @close="showTransitionForm = false"
    >
      <form id="transition-service-form" @submit.prevent="transitionService">
        <label
          ><span class="mb-2 block text-xs font-semibold text-muted">Alasan</span
          ><textarea
            v-model="transitionReason"
            rows="4"
            required
            class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink"
          />
        </label>
        <p class="mt-3 text-xs text-muted">
          <template v-if="transitionTarget === 'suspended'">
            Semua Coolify application yang terhubung akan dihentikan tanpa Docker cleanup. Service
            juga berhenti menghasilkan recurring invoice baru.
          </template>
          <template v-else-if="transitionTarget === 'active'">
            Semua Coolify application yang terhubung akan dijalankan kembali dan recurring billing
            akan aktif.
          </template>
          <template v-else>
            Service tidak akan menghasilkan recurring invoice baru. Cancellation bersifat permanen
            dan aplikasi Coolify akan dihentikan tanpa menghapus resource. Database masuk masa
            retensi 30 hari dan tidak langsung dihapus.
          </template>
        </p>
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="showTransitionForm = false"
            >Kembali</UiButton
          ><UiButton
            :variant="transitionTarget === 'cancelled' ? 'danger' : 'primary'"
            type="submit"
            form="transition-service-form"
            :disabled="saving"
            >Konfirmasi</UiButton
          >
        </div></template
      >
    </UiDialog>

    <UiCard :padded="false">
      <div class="flex h-11 items-center justify-between border-b px-4">
        <span class="text-xs font-semibold text-muted">Billable catalog</span>
        <UiBadge v-if="meta">{{ format.count(meta.total) }} total</UiBadge>
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="2.25rem" />
      </div>

      <UiEmptyState
        v-else-if="error"
        title="Gagal memuat services"
        description="Server tidak dapat membaca data service. Coba muat ulang halaman."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>

      <UiEmptyState
        v-else-if="services.length === 0"
        title="Belum ada service"
        :description="
          plans.length
            ? 'Service adalah unit billing. Buat service untuk menghubungkan customer, plan, dan Coolify resources.'
            : 'Buat plan beserta harga dan benefit terlebih dahulu sebelum membuat service.'
        "
      >
        <UiButton v-if="plans.length" size="sm" @click="openServiceDialog">
          <Plus :size="14" aria-hidden="true" />
          Tambah service
        </UiButton>
        <UiButton v-else size="sm" @click="navigateTo('/plans')">
          <Plus :size="14" aria-hidden="true" />
          Buat plan
        </UiButton>
      </UiEmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[880px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Service</th>
                <th class="px-4 py-3 font-semibold">Customer</th>
                <th class="px-4 py-3 text-right font-semibold">Harga</th>
                <th class="px-4 py-3 font-semibold">Siklus</th>
                <th class="px-4 py-3 font-semibold">Invoice berikutnya</th>
                <th class="px-4 py-3 font-semibold">Infrastructure</th>
                <th class="px-4 py-3 font-semibold">Status</th>
                <th class="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="service in services"
                :key="service.id"
                class="border-b last:border-0 hover:bg-surface-raised/60"
              >
                <td class="px-4 py-3">
                  <span class="block font-medium text-ink">{{ service.name }}</span>
                  <span class="block font-mono text-xs text-muted">{{
                    service.serviceNumber
                  }}</span>
                  <span class="mt-1 block text-xs text-brand">{{
                    service.planName || 'Legacy'
                  }}</span>
                  <span
                    v-if="service.database"
                    class="mt-1 block max-w-52 truncate font-mono text-[10px] text-muted"
                  >
                    {{ service.database.clusterName }} · {{ service.database.databaseName }} ·
                    {{ service.database.status }}
                  </span>
                  <UiBadge v-else-if="service.planDatabaseMode === 'shared'" tone="warning">
                    Database belum diprovision
                  </UiBadge>
                </td>
                <td class="px-4 py-3">
                  <span class="block text-ink">{{ service.customerName }}</span>
                  <span class="block font-mono text-xs text-muted">{{
                    service.customerNumber
                  }}</span>
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs text-ink">
                  <MoneyDisplay :amount="service.priceAmount" :currency="service.currency" />
                  <span class="mt-0.5 block text-[10px] text-muted">
                    <template v-if="service.billingCycle === 'one_time'">sekali bayar</template>
                    <template v-else>/ {{ billingCycleUnit(service.billingCycle) }}</template>
                  </span>
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ format.billingCycle(service.billingCycle) }}
                </td>
                <td class="px-4 py-3 font-mono text-xs text-muted">
                  {{ format.date(service.nextDueDate) }}
                </td>
                <td class="px-4 py-3">
                  <div v-if="service.resources.length" class="flex flex-wrap gap-1.5">
                    <span
                      v-for="resource in service.resources"
                      :key="resource.id"
                      class="inline-flex items-center gap-1.5 rounded border bg-canvas px-2 py-0.5 font-mono text-[11px] text-muted"
                    >
                      <span
                        class="size-1.5 rounded-full"
                        :class="resource.status === 'running' ? 'bg-brand' : 'bg-line-strong'"
                      />
                      {{ resource.name }}
                    </span>
                  </div>
                  <span v-else class="text-xs text-muted">—</span>
                  <div class="mt-2">
                    <UiBadge :tone="infrastructureTone(service.infrastructure.status)" dot>
                      {{ infrastructureLabel(service.infrastructure.status) }}
                    </UiBadge>
                    <p
                      v-if="service.infrastructure.status !== 'not_configured'"
                      class="mt-1 font-mono text-[10px] leading-4 text-muted"
                    >
                      {{ service.infrastructure.actual.resourceCount }}/{{
                        service.infrastructure.expected.resourceCount ?? '—'
                      }}
                      resource · {{ format.cpu(service.infrastructure.actual.cpuCores) }}/{{
                        format.cpu(service.infrastructure.expected.cpuCores)
                      }}
                      · {{ format.bytes(service.infrastructure.actual.memoryBytes) }}/{{
                        format.bytes(service.infrastructure.expected.memoryBytes)
                      }}
                    </p>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <ResourceStatusBadge :status="service.status" />
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1">
                    <UiButton
                      v-if="service.status !== 'cancelled'"
                      variant="ghost"
                      size="sm"
                      title="Terapkan plan ke Coolify"
                      @click="openInfrastructure(service)"
                      ><Cpu :size="14"
                    /></UiButton>
                    <UiButton
                      v-if="service.status !== 'cancelled'"
                      variant="ghost"
                      size="sm"
                      title="Edit service"
                      @click="openEdit(service)"
                      ><Pencil :size="14"
                    /></UiButton>
                    <UiButton
                      v-if="service.status === 'active'"
                      variant="ghost"
                      size="sm"
                      title="Suspend"
                      @click="openTransition(service, 'suspended')"
                      ><Pause :size="14"
                    /></UiButton>
                    <UiButton
                      v-if="service.status === 'suspended'"
                      variant="ghost"
                      size="sm"
                      title="Aktifkan"
                      @click="openTransition(service, 'active')"
                      ><Play :size="14"
                    /></UiButton>
                    <UiButton
                      v-if="service.status !== 'cancelled'"
                      variant="danger"
                      size="sm"
                      title="Batalkan"
                      @click="openTransition(service, 'cancelled')"
                      ><Ban :size="14"
                    /></UiButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <UiPagination
          v-if="meta"
          :page="meta.page"
          :per-page="meta.perPage"
          :total="meta.total"
          :total-pages="meta.totalPages"
          @update:page="page = $event"
        />
      </template>
    </UiCard>
  </div>
</template>
