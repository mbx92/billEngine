<script setup lang="ts">
import { Check, ChevronLeft, ChevronRight, Plus, RefreshCw } from '@lucide/vue'
import type { BillingCycle } from '#shared/constants/domain'
import type { ApiService, ApiServiceOptions, Paginated } from '#shared/types/api'
import { billingCycleUnit } from '#shared/utils/billing-display'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Services · Billing Infra' })

const format = useFormat()
const config = useRuntimeConfig()
const page = ref(1)
const perPage = 25
const showAddForm = ref(false)
const wizardStep = ref(1)
const wizardError = ref<string | null>(null)
const resourceQuery = ref('')
const saving = ref(false)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const today = new Date().toLocaleDateString('en-CA', {
  timeZone: config.public.billingTimezone,
})
const form = reactive({
  customerId: '',
  name: '',
  description: '',
  currency: 'IDR',
  priceAmount: '',
  billingCycle: 'monthly' as BillingCycle,
  billingStartDate: today,
  nextDueDate: today,
  invoiceLeadDays: '0',
  paymentDueDays: '7',
  taxRate: '',
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
const customers = computed(() => optionData.value?.data.customers ?? [])
const resources = computed(() => optionData.value?.data.resources ?? [])
const selectedCustomer = computed(() =>
  customers.value.find((customer) => customer.id === form.customerId),
)
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
const priceLabel = computed(() =>
  form.billingCycle === 'one_time'
    ? 'Harga sekali bayar'
    : `Harga per ${billingCycleUnit(form.billingCycle)}`,
)
const priceHint = computed(() => {
  if (form.billingCycle === 'one_time') return 'Nominal ditagihkan satu kali.'
  return `Nominal ini ditagihkan setiap ${billingCycleUnit(form.billingCycle)}.`
})

const wizardSteps = [
  { number: 1, label: 'Service' },
  { number: 2, label: 'Billing' },
  { number: 3, label: 'Resources' },
  { number: 4, label: 'Konfirmasi' },
]

const billingCycles: Array<{ value: BillingCycle; label: string }> = [
  { value: 'one_time', label: 'Sekali bayar' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'quarterly', label: 'Tiga bulanan' },
  { value: 'semi_annually', label: 'Enam bulanan' },
  { value: 'annually', label: 'Tahunan' },
]

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
    name: '',
    description: '',
    currency: 'IDR',
    priceAmount: '',
    billingCycle: 'monthly',
    billingStartDate: today,
    nextDueDate: today,
    invoiceLeadDays: '0',
    paymentDueDays: '7',
    taxRate: '',
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
    if (form.name.trim().length < 2) return 'Nama service minimal 2 karakter.'
  }

  if (wizardStep.value === 2) {
    if (!/^\d+$/.test(form.priceAmount) || BigInt(form.priceAmount) <= 0n) {
      return 'Harga service harus berupa angka dan lebih besar dari nol.'
    }
    if (form.currency.trim().length !== 3) return 'Mata uang harus menggunakan kode 3 huruf.'
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
          ...form,
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
          Billable business services, recurring price, billing cycle, and linked Coolify resources.
        </p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
          Refresh
        </UiButton>
        <UiButton @click="openServiceDialog">
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
          <label class="block md:col-span-2">
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
        </div>

        <div v-else-if="wizardStep === 2" class="grid gap-4 md:grid-cols-2">
          <UiMoneyInput
            v-model="form.priceAmount"
            :label="priceLabel"
            :currency="form.currency"
            :hint="`${priceHint} Pemisah ribuan ditambahkan otomatis.`"
            placeholder="500000"
          />
          <UiInput v-model="form.currency" label="Mata uang" maxlength="3" placeholder="IDR" />
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Siklus billing</span>
            <select
              v-model="form.billingCycle"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option v-for="cycle in billingCycles" :key="cycle.value" :value="cycle.value">
                {{ cycle.label }}
              </option>
            </select>
          </label>
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
          <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 class="text-sm font-semibold text-ink">Hubungkan resource Coolify</h3>
              <p class="mt-1 text-xs text-muted">
                Opsional. Hanya resource billable yang belum dipakai service lain yang ditampilkan.
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
                {{ format.money(form.priceAmount, form.currency.toUpperCase()) }}
                <template v-if="form.billingCycle === 'one_time'"> sekali bayar</template>
                <template v-else> / {{ billingCycleUnit(form.billingCycle) }}</template>
              </p>
            </div>
            <dl class="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-3">
              <div>
                <dt class="text-muted">Siklus</dt>
                <dd class="mt-1 font-medium text-ink">
                  {{ format.billingCycle(form.billingCycle) }}
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
            <p v-else class="text-xs text-muted">Service akan dibuat tanpa resource Coolify.</p>
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
              :disabled="customers.length === 0"
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
        description="Service adalah unit billing. Buat service untuk menghubungkan customer dengan Coolify resources."
      >
        <UiButton size="sm" @click="openServiceDialog">
          <Plus :size="14" aria-hidden="true" />
          Tambah service
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
                <th class="px-4 py-3 font-semibold">Resources</th>
                <th class="px-4 py-3 font-semibold">Status</th>
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
                </td>
                <td class="px-4 py-3">
                  <ResourceStatusBadge :status="service.status" />
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
