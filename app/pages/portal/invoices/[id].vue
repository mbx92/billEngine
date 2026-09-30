<script setup lang="ts">
import { ArrowLeft, Download } from '@lucide/vue'
import type { ApiInvoiceDetail } from '#shared/types/api'

definePageMeta({ middleware: 'auth' })
const route = useRoute()
const format = useFormat()
const invoiceId = computed(() => String(route.params.id))
const { data, status, error } = await useFetch<{ data: ApiInvoiceDetail }>(
  () => `/api/portal/invoices/${encodeURIComponent(invoiceId.value)}`,
)
const detail = computed(() => data.value?.data)
useHead(() => ({
  title: detail.value ? `${detail.value.invoice.invoiceNumber} · Portal` : 'Invoice · Portal',
}))
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <NuxtLink
      to="/portal"
      class="focus-ring mb-5 inline-flex items-center gap-2 rounded text-xs font-semibold text-muted hover:text-ink"
      ><ArrowLeft :size="14" /> Kembali ke portal</NuxtLink
    >
    <div v-if="status === 'pending'" class="space-y-4">
      <UiSkeleton height="7rem" /><UiSkeleton height="20rem" />
    </div>
    <UiEmptyState
      v-else-if="error || !detail"
      title="Invoice tidak ditemukan"
      description="Invoice tidak tersedia untuk akun customer ini."
    />
    <template v-else>
      <header class="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
            Customer portal / invoice
          </p>
          <div class="flex items-center gap-3">
            <h1 class="font-mono text-2xl font-semibold text-ink">
              {{ detail.invoice.invoiceNumber }}
            </h1>
            <BillingStatusBadge kind="invoice" :status="detail.invoice.status" />
          </div>
          <p class="mt-2 text-sm text-muted">
            Jatuh tempo {{ format.date(detail.invoice.dueDate) }}
          </p>
        </div>
        <a
          :href="`/api/portal/invoices/${detail.invoice.id}/pdf`"
          download
          class="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-brand bg-brand px-4 text-sm font-semibold text-[#071109]"
          ><Download :size="15" /> Download PDF</a
        >
      </header>

      <UiCard :padded="false" class="mb-5">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[620px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] uppercase text-muted">
              <tr>
                <th class="px-4 py-3">Deskripsi</th>
                <th class="px-4 py-3 text-center">Qty</th>
                <th class="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.items" :key="item.id" class="border-b">
                <td class="px-4 py-3 text-ink">{{ item.description }}</td>
                <td class="px-4 py-3 text-center font-mono">{{ Number(item.quantity) }}</td>
                <td class="px-4 py-3 text-right font-mono">
                  <MoneyDisplay :amount="item.totalAmount" :currency="detail.invoice.currency" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl class="ml-auto w-full max-w-sm space-y-3 border-t p-4 text-sm">
          <div class="flex justify-between">
            <dt class="text-muted">Total</dt>
            <dd>
              <MoneyDisplay
                :amount="detail.invoice.totalAmount"
                :currency="detail.invoice.currency"
              />
            </dd>
          </div>
          <div v-if="detail.invoice.creditedAmount !== '0'" class="flex justify-between">
            <dt class="text-muted">Credit note</dt>
            <dd>
              -<MoneyDisplay
                :amount="detail.invoice.creditedAmount"
                :currency="detail.invoice.currency"
              />
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-muted">Dibayar</dt>
            <dd>
              <MoneyDisplay
                :amount="detail.invoice.amountPaid"
                :currency="detail.invoice.currency"
              />
            </dd>
          </div>
          <div class="flex justify-between border-t pt-3 font-semibold">
            <dt>Sisa tagihan</dt>
            <dd>
              <MoneyDisplay
                :amount="detail.invoice.balanceDue"
                :currency="detail.invoice.currency"
              />
            </dd>
          </div>
        </dl>
      </UiCard>

      <UiCard v-if="detail.payments.length || detail.creditNotes.length">
        <p class="mb-3 text-[10px] font-semibold tracking-wider text-muted uppercase">
          Riwayat transaksi
        </p>
        <div class="space-y-2">
          <div
            v-for="payment in detail.payments"
            :key="payment.id"
            class="flex justify-between rounded-md border px-3 py-2 text-xs"
          >
            <span class="font-mono">{{ payment.paymentNumber }}</span
            ><span>{{ format.dateTime(payment.paidAt) }}</span
            ><MoneyDisplay :amount="payment.amount" :currency="payment.currency" />
          </div>
          <div
            v-for="credit in detail.creditNotes"
            :key="credit.id"
            class="flex justify-between rounded-md border px-3 py-2 text-xs"
          >
            <span class="font-mono">{{ credit.creditNoteNumber }}</span
            ><span>{{ credit.reason }}</span
            ><span
              >-<MoneyDisplay :amount="credit.amount" :currency="detail.invoice.currency"
            /></span>
          </div>
        </div>
      </UiCard>
    </template>
  </div>
</template>
