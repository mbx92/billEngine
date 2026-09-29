<script setup lang="ts">
import { LoaderCircle, Plus, Trash2 } from '@lucide/vue'
import type { ApiManualInvoiceOptions } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

const emit = defineEmits<{
  close: []
  created: [invoice: { id: string; invoiceNumber: string }]
}>()

interface InvoiceLineForm {
  serviceId: string
  description: string
  quantity: string
  unitPriceAmount: string
  taxRate: string
  servicePeriodStart: string
  servicePeriodEnd: string
}

const settings = useAppSettings()
const format = useFormat()
const loadingOptions = ref(true)
const saving = ref(false)
const optionError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const options = ref<ApiManualInvoiceOptions>({ customers: [], services: [] })

const today = dateInTimeZone(new Date(), settings.value.billingTimezone)
const form = reactive({
  customerId: '',
  issueDate: today,
  dueDate: addIsoDays(today, 7),
  notes: '',
  items: [newLine()] as InvoiceLineForm[],
})

const customerServices = computed(() =>
  options.value.services.filter((service) => service.customerId === form.customerId),
)
const selectedCustomer = computed(() =>
  options.value.customers.find((customer) => customer.id === form.customerId),
)

onMounted(loadOptions)

function newLine(): InvoiceLineForm {
  return {
    serviceId: '',
    description: '',
    quantity: '1',
    unitPriceAmount: '',
    taxRate: settings.value.defaultTaxRate ?? '',
    servicePeriodStart: '',
    servicePeriodEnd: '',
  }
}

async function loadOptions() {
  loadingOptions.value = true
  optionError.value = null
  try {
    const response = await $fetch<{ data: ApiManualInvoiceOptions }>('/api/invoices/options')
    options.value = response.data
    form.customerId = response.data.customers[0]?.id ?? ''
  } catch (caught) {
    optionError.value = apiErrorMessage(caught, 'Pilihan customer dan service gagal dimuat.')
  } finally {
    loadingOptions.value = false
  }
}

function changeCustomer() {
  for (const item of form.items) {
    const service = options.value.services.find((entry) => entry.id === item.serviceId)
    if (service?.customerId !== form.customerId) item.serviceId = ''
  }
}

function selectService(item: InvoiceLineForm) {
  const service = options.value.services.find((entry) => entry.id === item.serviceId)
  if (!service) return
  item.description = service.name
  item.unitPriceAmount = service.priceAmount
}

function addLine() {
  form.items.push(newLine())
}

function removeLine(index: number) {
  if (form.items.length > 1) form.items.splice(index, 1)
}

async function createInvoice() {
  actionError.value = null
  if (!form.customerId) {
    actionError.value = 'Pilih customer terlebih dahulu.'
    return
  }
  if (form.dueDate < form.issueDate) {
    actionError.value = 'Due date tidak boleh sebelum issue date.'
    return
  }

  saving.value = true
  try {
    const response = await $fetch<{
      data: { id: string; invoiceNumber: string; status: string }
    }>('/api/invoices', {
      method: 'POST',
      body: {
        customerId: form.customerId,
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        notes: form.notes || undefined,
        items: form.items.map((item) => ({
          serviceId: item.serviceId || undefined,
          description: item.description,
          quantity: item.quantity,
          unitPriceAmount: item.unitPriceAmount,
          taxRate: item.taxRate || undefined,
          servicePeriodStart: item.servicePeriodStart || undefined,
          servicePeriodEnd: item.servicePeriodEnd || undefined,
        })),
      },
    })
    emit('created', response.data)
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal membuat manual invoice.')
  } finally {
    saving.value = false
  }
}

function dateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
</script>

<template>
  <UiDialog
    title="Buat manual invoice"
    description="Pilih customer dan susun satu atau beberapa item. Nilai akhir dihitung ulang oleh server."
    size="xl"
    :close-disabled="saving"
    @close="emit('close')"
  >
    <div
      v-if="loadingOptions"
      class="flex min-h-48 items-center justify-center gap-2 text-sm text-muted"
    >
      <LoaderCircle class="animate-spin" :size="18" aria-hidden="true" />
      Memuat customer dan service…
    </div>

    <UiEmptyState
      v-else-if="optionError"
      title="Pilihan invoice gagal dimuat"
      :description="optionError"
    >
      <UiButton variant="secondary" size="sm" @click="loadOptions">Coba lagi</UiButton>
    </UiEmptyState>

    <form v-else id="manual-invoice-form" class="space-y-5" @submit.prevent="createInvoice">
      <p
        v-if="actionError"
        class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ actionError }}
      </p>

      <div class="grid gap-4 sm:grid-cols-3">
        <label class="block sm:col-span-3">
          <span class="mb-2 block text-xs font-semibold text-muted">Customer</span>
          <select
            v-model="form.customerId"
            autofocus
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            @change="changeCustomer"
          >
            <option value="" disabled>Pilih customer</option>
            <option v-for="customer in options.customers" :key="customer.id" :value="customer.id">
              {{ customer.customerNumber }} · {{ customer.companyName || customer.name }}
            </option>
          </select>
        </label>
        <UiInput v-model="form.issueDate" label="Issue date" type="date" required />
        <UiInput v-model="form.dueDate" label="Due date" type="date" required />
        <div class="rounded-md border bg-canvas px-3 py-2 text-xs leading-5 text-muted">
          Currency
          <strong class="ml-1 font-mono text-ink">{{ settings.billingCurrency }}</strong>
          <span v-if="selectedCustomer" class="block truncate">{{ selectedCustomer.email }}</span>
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-ink">Invoice items</h3>
            <p class="mt-1 text-xs text-muted">
              Service bersifat opsional; item custom diperbolehkan.
            </p>
          </div>
          <UiButton variant="secondary" size="sm" @click="addLine">
            <Plus :size="14" aria-hidden="true" />
            Tambah item
          </UiButton>
        </div>

        <div
          v-for="(item, index) in form.items"
          :key="index"
          class="rounded-lg border bg-canvas/40 p-4"
        >
          <div class="mb-3 flex items-center justify-between gap-3">
            <span class="font-mono text-xs font-semibold text-muted">ITEM {{ index + 1 }}</span>
            <UiButton
              variant="ghost"
              size="sm"
              :disabled="form.items.length === 1"
              :aria-label="`Hapus item ${index + 1}`"
              @click="removeLine(index)"
            >
              <Trash2 :size="14" aria-hidden="true" />
            </UiButton>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label class="block sm:col-span-2">
              <span class="mb-2 block text-xs font-semibold text-muted">Service opsional</span>
              <select
                v-model="item.serviceId"
                class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
                @change="selectService(item)"
              >
                <option value="">Custom item</option>
                <option v-for="service in customerServices" :key="service.id" :value="service.id">
                  {{ service.serviceNumber }} · {{ service.name }} ·
                  {{ format.money(service.priceAmount, service.currency) }}
                </option>
              </select>
            </label>
            <UiInput
              v-model="item.quantity"
              label="Quantity"
              inputmode="decimal"
              placeholder="1"
              required
            />
            <UiMoneyInput
              v-model="item.unitPriceAmount"
              label="Harga satuan"
              :currency="settings.billingCurrency"
              required
            />
            <div class="sm:col-span-2">
              <UiInput
                v-model="item.description"
                label="Deskripsi"
                minlength="2"
                maxlength="500"
                required
              />
            </div>
            <UiInput
              v-model="item.taxRate"
              label="Tax rate"
              inputmode="decimal"
              placeholder="0.11"
              hint="Pecahan; kosong memakai default settings."
            />
            <div class="grid grid-cols-2 gap-2">
              <UiInput v-model="item.servicePeriodStart" label="Periode mulai" type="date" />
              <UiInput v-model="item.servicePeriodEnd" label="Periode akhir" type="date" />
            </div>
          </div>
        </div>
      </div>

      <label class="block">
        <span class="mb-2 block text-xs font-semibold text-muted">Catatan invoice</span>
        <textarea
          v-model="form.notes"
          rows="3"
          maxlength="5000"
          class="focus-ring min-h-10 w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted/60"
          placeholder="Opsional"
        />
      </label>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UiButton variant="secondary" :disabled="saving" @click="emit('close')">Batal</UiButton>
        <UiButton
          type="submit"
          form="manual-invoice-form"
          :disabled="saving || loadingOptions || Boolean(optionError)"
        >
          <LoaderCircle v-if="saving" class="animate-spin" :size="15" aria-hidden="true" />
          {{ saving ? 'Membuat…' : 'Buat invoice' }}
        </UiButton>
      </div>
    </template>
  </UiDialog>
</template>
