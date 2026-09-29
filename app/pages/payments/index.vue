<script setup lang="ts">
import { Plus, RefreshCw } from '@lucide/vue'
import type { PaymentStatus } from '#shared/constants/domain'
import type { ApiPaymentInvoiceOption, ApiPaymentListResponse } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'
import { PAYMENT_METHODS } from '~/lib/billing-status'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Payments · Billing Infra' })

const format = useFormat()
const route = useRoute()
const page = ref(1)
const perPage = 25
const statusFilter = ref<PaymentStatus | ''>('')
const fromFilter = ref('')
const toFilter = ref('')
const showRecordForm = ref(false)
const saving = ref(false)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)

function localDateTimeValue() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const form = reactive({
  invoiceId: '',
  amount: '',
  method: PAYMENT_METHODS[0] as string,
  reference: '',
  paidAt: localDateTimeValue(),
  notes: '',
})

const { data, status, error, refresh } = await useFetch<ApiPaymentListResponse>('/api/payments', {
  query: { page, perPage, status: statusFilter, from: fromFilter, to: toFilter },
})
const { data: optionData, refresh: refreshOptions } = await useFetch<{
  data: ApiPaymentInvoiceOption[]
}>('/api/payments/options')

const payments = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta)
const invoiceOptions = computed(() => optionData.value?.data ?? [])
const selectedInvoice = computed(() =>
  invoiceOptions.value.find((invoice) => invoice.id === form.invoiceId),
)
const requestedInvoiceHandled = ref(false)

watch(
  invoiceOptions,
  (available) => {
    if (requestedInvoiceHandled.value) return
    const requested = typeof route.query.invoiceId === 'string' ? route.query.invoiceId : ''
    if (!requested || !available.some((invoice) => invoice.id === requested)) return
    requestedInvoiceHandled.value = true
    openRecordForm(requested)
  },
  { immediate: true },
)

function clearFilters() {
  statusFilter.value = ''
  fromFilter.value = ''
  toFilter.value = ''
  page.value = 1
}

function fillOutstandingBalance() {
  const invoice = invoiceOptions.value.find((entry) => entry.id === form.invoiceId)
  form.amount = invoice?.balanceDue ?? ''
}

function openRecordForm(invoiceId?: string) {
  actionError.value = null
  Object.assign(form, {
    invoiceId: invoiceId ?? invoiceOptions.value[0]?.id ?? '',
    amount: '',
    method: PAYMENT_METHODS[0],
    reference: '',
    paidAt: localDateTimeValue(),
    notes: '',
  })
  fillOutstandingBalance()
  showRecordForm.value = true
}

async function refreshAll() {
  await Promise.all([refresh(), refreshOptions()])
}

async function recordPayment() {
  actionError.value = null
  const invoice = selectedInvoice.value
  const amount = form.amount ? BigInt(form.amount) : 0n

  if (!invoice) {
    actionError.value = 'Pilih invoice yang akan dibayar.'
    return
  }
  if (amount <= 0n) {
    actionError.value = 'Jumlah pembayaran harus lebih dari 0.'
    return
  }
  if (amount > BigInt(invoice.balanceDue)) {
    actionError.value = 'Jumlah pembayaran tidak boleh melebihi sisa tagihan.'
    return
  }

  saving.value = true
  try {
    const response = await $fetch<{
      data: { payment: { paymentNumber: string }; invoice: { status: string } }
    }>('/api/payments', {
      method: 'POST',
      body: {
        invoiceId: form.invoiceId,
        amount: form.amount,
        method: form.method,
        reference: form.reference || undefined,
        notes: form.notes || undefined,
        paidAt: new Date(form.paidAt).toISOString(),
        status: 'completed',
      },
    })

    actionMessage.value = `${response.data.payment.paymentNumber} berhasil dicatat untuk ${invoice.invoiceNumber}.`
    showRecordForm.value = false
    page.value = 1
    await refreshAll()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal mencatat pembayaran.')
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
          Commercial / payments
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Payments</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Catat pembayaran manual dan pantau alokasinya terhadap invoice yang sudah terbit.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refreshAll()">
          <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
          Refresh
        </UiButton>
        <UiButton :disabled="invoiceOptions.length === 0" @click="openRecordForm()">
          <Plus :size="15" :stroke-width="1.8" aria-hidden="true" />
          Catat payment
        </UiButton>
      </div>
    </header>

    <p
      v-if="actionMessage"
      class="mb-5 rounded-md border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-brand"
      role="status"
    >
      {{ actionMessage }}
    </p>

    <UiDialog
      v-if="showRecordForm"
      title="Catat payment"
      description="Payment completed langsung mengurangi saldo invoice. Partial payment diperbolehkan."
      :close-disabled="saving"
      @close="showRecordForm = false"
    >
      <form
        id="record-payment-form"
        class="grid gap-4 sm:grid-cols-2"
        @submit.prevent="recordPayment"
      >
        <p
          v-if="actionError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger sm:col-span-2"
          role="alert"
        >
          {{ actionError }}
        </p>

        <label class="block sm:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">Invoice</span>
          <select
            v-model="form.invoiceId"
            autofocus
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            @change="fillOutstandingBalance"
          >
            <option v-for="invoice in invoiceOptions" :key="invoice.id" :value="invoice.id">
              {{ invoice.invoiceNumber }} ·
              {{ invoice.customerCompanyName || invoice.customerName }} ·
              {{ format.money(invoice.balanceDue, invoice.currency) }}
            </option>
          </select>
        </label>

        <div
          v-if="selectedInvoice"
          class="rounded-md border bg-canvas px-3 py-2 text-xs text-muted sm:col-span-2"
        >
          Sisa tagihan
          <strong class="ml-1 font-mono font-semibold text-ink">
            {{ format.money(selectedInvoice.balanceDue, selectedInvoice.currency) }}
          </strong>
          <span class="mx-2">·</span>
          Jatuh tempo {{ format.date(selectedInvoice.dueDate) }}
        </div>

        <UiMoneyInput
          v-model="form.amount"
          label="Jumlah pembayaran"
          :currency="selectedInvoice?.currency || 'IDR'"
          required
        />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Metode</span>
          <select
            v-model="form.method"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option v-for="method in PAYMENT_METHODS" :key="method" :value="method">
              {{ method }}
            </option>
          </select>
        </label>
        <UiInput v-model="form.paidAt" label="Tanggal pembayaran" type="datetime-local" required />
        <UiInput
          v-model="form.reference"
          label="Nomor referensi"
          placeholder="Opsional"
          maxlength="255"
        />
        <label class="block sm:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">Catatan</span>
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
          <UiButton variant="secondary" :disabled="saving" @click="showRecordForm = false">
            Batal
          </UiButton>
          <UiButton type="submit" form="record-payment-form" :disabled="saving">
            {{ saving ? 'Menyimpan…' : 'Simpan payment' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiCard :padded="false">
      <div
        class="grid gap-3 border-b p-4 md:grid-cols-[minmax(0,1fr)_160px_160px_auto] md:items-end"
      >
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Status</span>
          <select
            v-model="statusFilter"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            @change="page = 1"
          >
            <option value="">Semua status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <UiInput v-model="fromFilter" label="Dari tanggal" type="date" @change="page = 1" />
        <UiInput v-model="toFilter" label="Sampai tanggal" type="date" @change="page = 1" />
        <UiButton
          variant="secondary"
          :disabled="!statusFilter && !fromFilter && !toFilter"
          @click="clearFilters"
        >
          Reset filter
        </UiButton>
      </div>

      <div class="flex h-11 items-center justify-between border-b px-4">
        <span class="text-xs font-semibold text-muted">Riwayat payment</span>
        <UiBadge v-if="meta">{{ format.count(meta.total) }} total</UiBadge>
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="2.25rem" />
      </div>

      <UiEmptyState
        v-else-if="error"
        title="Gagal memuat payments"
        description="Server tidak dapat membaca data pembayaran. Coba muat ulang halaman."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>

      <UiEmptyState
        v-else-if="payments.length === 0"
        :title="
          statusFilter || fromFilter || toFilter ? 'Payment tidak ditemukan' : 'Belum ada payment'
        "
        :description="
          statusFilter || fromFilter || toFilter
            ? 'Tidak ada pembayaran yang cocok dengan filter saat ini.'
            : invoiceOptions.length
              ? 'Catat pembayaran pertama untuk memperbarui saldo invoice.'
              : 'Belum ada invoice unpaid atau overdue yang dapat dibayar.'
        "
      >
        <UiButton v-if="invoiceOptions.length" size="sm" @click="openRecordForm()">
          <Plus :size="14" aria-hidden="true" />
          Catat payment
        </UiButton>
      </UiEmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[980px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Payment</th>
                <th class="px-4 py-3 font-semibold">Invoice / Customer</th>
                <th class="px-4 py-3 font-semibold">Tanggal</th>
                <th class="px-4 py-3 font-semibold">Metode / Referensi</th>
                <th class="px-4 py-3 text-right font-semibold">Jumlah</th>
                <th class="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="payment in payments"
                :key="payment.id"
                class="border-b last:border-0 hover:bg-surface-raised/60"
              >
                <td class="px-4 py-3">
                  <span class="block font-mono text-xs font-semibold text-ink">
                    {{ payment.paymentNumber }}
                  </span>
                  <span v-if="payment.recordedByName" class="mt-1 block text-xs text-muted">
                    oleh {{ payment.recordedByName }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <NuxtLink
                    :to="`/invoices/${payment.invoiceId}`"
                    class="focus-ring rounded font-mono text-xs font-semibold text-brand hover:underline"
                  >
                    {{ payment.invoiceNumber }}
                  </NuxtLink>
                  <span class="mt-1 block text-xs text-muted">
                    {{ payment.customerCompanyName || payment.customerName }}
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-muted">
                  {{ format.dateTime(payment.paidAt) }}
                </td>
                <td class="px-4 py-3">
                  <span class="block text-xs text-ink">{{ payment.method }}</span>
                  <span class="mt-1 block font-mono text-xs text-muted">
                    {{ payment.reference || '—' }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs font-semibold text-ink">
                  <MoneyDisplay :amount="payment.amount" :currency="payment.currency" />
                </td>
                <td class="px-4 py-3">
                  <BillingStatusBadge kind="payment" :status="payment.status" />
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
