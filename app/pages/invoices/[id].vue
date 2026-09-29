<script setup lang="ts">
import { ArrowLeft, Download } from '@lucide/vue'
import type { ApiInvoiceDetail } from '#shared/types/api'
import { billingPeriodMonths, monthlyEquivalent } from '#shared/utils/billing-display'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const format = useFormat()
const invoiceId = computed(() => String(route.params.id))
const pdfUrl = computed(() => `/api/invoices/${encodeURIComponent(invoiceId.value)}/pdf`)

const { data, status, error, refresh } = await useFetch<{ data: ApiInvoiceDetail }>(
  () => `/api/invoices/${encodeURIComponent(invoiceId.value)}`,
)

const detail = computed(() => data.value?.data)
const invoice = computed(() => detail.value?.invoice)

useHead(() => ({
  title: invoice.value
    ? `${invoice.value.invoiceNumber} · Billing Infra`
    : 'Invoice · Billing Infra',
}))

function taxLabel(rate: string | null) {
  if (!rate) return '—'
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(rate) * 100)}%`
}

function monthlyBreakdown(item: ApiInvoiceDetail['items'][number]) {
  const months = billingPeriodMonths(item.servicePeriodStart, item.servicePeriodEnd)
  if (months <= 1) return null
  const monthly = monthlyEquivalent(BigInt(item.unitPriceAmount), months)
  return `Rata-rata ${format.money(monthly, detail.value!.invoice.currency)} / bulan × ${months} bulan`
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <div class="mb-5">
      <NuxtLink
        to="/invoices"
        class="focus-ring inline-flex items-center gap-2 rounded text-xs font-semibold text-muted hover:text-ink"
      >
        <ArrowLeft :size="14" aria-hidden="true" />
        Kembali ke invoices
      </NuxtLink>
    </div>

    <div v-if="status === 'pending'" class="space-y-4">
      <UiSkeleton height="7rem" />
      <UiSkeleton height="24rem" />
    </div>

    <UiCard v-else-if="error || !detail" :padded="false">
      <UiEmptyState
        title="Invoice tidak dapat dimuat"
        description="Invoice tidak ditemukan atau server gagal membaca detail invoice."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>
    </UiCard>

    <template v-else>
      <header class="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
            Commercial / invoice detail
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="font-mono text-2xl font-semibold tracking-tight text-ink">
              {{ detail.invoice.invoiceNumber }}
            </h1>
            <BillingStatusBadge kind="invoice" :status="detail.invoice.status" />
          </div>
          <p class="mt-2 text-sm text-muted">
            Dibuat {{ format.date(detail.invoice.issueDate) }} · jatuh tempo
            {{ format.date(detail.invoice.dueDate) }}
          </p>
        </div>
        <a
          :href="pdfUrl"
          download
          class="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-brand bg-brand px-4 text-sm font-semibold text-[#071109] transition hover:bg-brand-strong"
        >
          <Download :size="15" aria-hidden="true" />
          Download PDF
        </a>
      </header>

      <div class="mb-5 grid gap-4 lg:grid-cols-2">
        <UiCard>
          <p class="text-[10px] font-semibold tracking-wider text-muted uppercase">Dari</p>
          <h2 class="mt-2 text-sm font-semibold text-ink">{{ detail.invoice.sellerName }}</h2>
          <div class="mt-2 space-y-1 text-xs leading-5 text-muted">
            <p v-if="detail.invoice.sellerAddress">{{ detail.invoice.sellerAddress }}</p>
            <p v-if="detail.invoice.sellerEmail">{{ detail.invoice.sellerEmail }}</p>
            <p v-if="detail.invoice.sellerTaxId">Tax ID: {{ detail.invoice.sellerTaxId }}</p>
          </div>
        </UiCard>

        <UiCard>
          <p class="text-[10px] font-semibold tracking-wider text-muted uppercase">
            Ditagihkan kepada
          </p>
          <h2 class="mt-2 text-sm font-semibold text-ink">
            {{ detail.invoice.customerCompanyName || detail.invoice.customerName }}
          </h2>
          <div class="mt-2 space-y-1 text-xs leading-5 text-muted">
            <p v-if="detail.invoice.customerCompanyName">{{ detail.invoice.customerName }}</p>
            <p>{{ detail.invoice.customerEmail }}</p>
            <p v-if="detail.invoice.customerPhone">{{ detail.invoice.customerPhone }}</p>
            <p v-if="detail.invoice.customerAddress">{{ detail.invoice.customerAddress }}</p>
            <p v-if="detail.invoice.customerTaxId">Tax ID: {{ detail.invoice.customerTaxId }}</p>
          </div>
        </UiCard>
      </div>

      <UiCard :padded="false" class="mb-5 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Deskripsi</th>
                <th class="px-4 py-3 text-center font-semibold">Qty</th>
                <th class="px-4 py-3 text-right font-semibold">Harga</th>
                <th class="px-4 py-3 text-right font-semibold">Pajak</th>
                <th class="px-4 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.items" :key="item.id" class="border-b last:border-0">
                <td class="px-4 py-3">
                  <span class="block font-medium text-ink">{{ item.description }}</span>
                  <span
                    v-if="item.servicePeriodStart && item.servicePeriodEnd"
                    class="mt-1 block font-mono text-[11px] text-muted"
                  >
                    {{ format.date(item.servicePeriodStart) }} –
                    {{ format.date(item.servicePeriodEnd) }}
                  </span>
                  <span v-if="monthlyBreakdown(item)" class="mt-1 block text-xs text-brand">
                    {{ monthlyBreakdown(item) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-center font-mono text-xs text-muted">
                  {{ Number(item.quantity).toLocaleString('id-ID') }}
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs text-ink">
                  <MoneyDisplay
                    :amount="item.unitPriceAmount"
                    :currency="detail.invoice.currency"
                  />
                </td>
                <td class="px-4 py-3 text-right text-xs text-muted">
                  {{ taxLabel(item.taxRate) }}
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs font-semibold text-ink">
                  <MoneyDisplay :amount="item.totalAmount" :currency="detail.invoice.currency" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex justify-end border-t bg-canvas/30 p-4 sm:p-5">
          <dl class="w-full max-w-sm space-y-3 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-muted">Subtotal</dt>
              <dd class="font-mono text-ink">
                <MoneyDisplay
                  :amount="detail.invoice.subtotalAmount"
                  :currency="detail.invoice.currency"
                />
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">Pajak</dt>
              <dd class="font-mono text-ink">
                <MoneyDisplay
                  :amount="detail.invoice.taxAmount"
                  :currency="detail.invoice.currency"
                />
              </dd>
            </div>
            <div class="flex justify-between gap-4 border-t pt-3 text-base font-semibold">
              <dt class="text-ink">Total</dt>
              <dd class="font-mono text-ink">
                <MoneyDisplay
                  :amount="detail.invoice.totalAmount"
                  :currency="detail.invoice.currency"
                />
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted">Dibayar</dt>
              <dd class="font-mono text-muted">
                <MoneyDisplay
                  :amount="detail.invoice.amountPaid"
                  :currency="detail.invoice.currency"
                />
              </dd>
            </div>
            <div class="flex justify-between gap-4 font-semibold">
              <dt class="text-ink">Sisa tagihan</dt>
              <dd class="font-mono text-ink">
                <MoneyDisplay
                  :amount="detail.invoice.balanceDue"
                  :currency="detail.invoice.currency"
                />
              </dd>
            </div>
          </dl>
        </div>
      </UiCard>

      <UiCard v-if="detail.invoice.notes || detail.payments.length">
        <div v-if="detail.invoice.notes">
          <p class="text-[10px] font-semibold tracking-wider text-muted uppercase">Catatan</p>
          <p class="mt-2 whitespace-pre-line text-sm leading-6 text-ink">
            {{ detail.invoice.notes }}
          </p>
        </div>
        <div
          v-if="detail.payments.length"
          :class="detail.invoice.notes ? 'mt-5 border-t pt-5' : ''"
        >
          <p class="mb-3 text-[10px] font-semibold tracking-wider text-muted uppercase">
            Pembayaran
          </p>
          <div class="space-y-2">
            <div
              v-for="payment in detail.payments"
              :key="payment.id"
              class="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-canvas px-3 py-2 text-xs"
            >
              <span class="font-mono text-ink">{{ payment.paymentNumber }}</span>
              <span class="text-muted">{{ format.dateTime(payment.paidAt) }}</span>
              <MoneyDisplay :amount="payment.amount" :currency="payment.currency" />
              <BillingStatusBadge kind="payment" :status="payment.status" />
            </div>
          </div>
        </div>
      </UiCard>
    </template>
  </div>
</template>
