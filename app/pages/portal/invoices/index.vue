<script setup lang="ts">
import type { InvoiceStatus } from '#shared/constants/domain'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Invoice · Portal' })

const { format, invoices, status, error, refresh } = await usePortalSummary()
const statusFilter = ref<InvoiceStatus | ''>('')

const tabs = computed(() => invoiceFilterTabs(invoices.value))
const filtered = computed(() =>
  statusFilter.value
    ? invoices.value.filter((invoice) => invoice.status === statusFilter.value)
    : invoices.value,
)
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Customer portal / invoice
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Invoice</h1>
        <p class="mt-2 text-sm text-muted">
          Unduh PDF dan cek sisa tagihan untuk setiap invoice akun Anda.
        </p>
      </div>
      <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
    </header>

    <UiCard :padded="false">
      <div class="flex flex-wrap gap-1.5 border-b p-4">
        <button
          v-for="tab in tabs"
          :key="tab.value || 'all'"
          type="button"
          class="focus-ring rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase transition"
          :class="
            statusFilter === tab.value
              ? 'border-brand/40 bg-brand/10 text-brand'
              : 'border-line-strong bg-surface-raised text-muted hover:text-ink'
          "
          @click="statusFilter = tab.value"
        >
          {{ tab.label }}
          <span class="ml-1 font-mono">{{ format.count(tab.count) }}</span>
        </button>
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="2.25rem" />
      </div>

      <UiEmptyState
        v-else-if="error"
        title="Invoice tidak dapat dimuat"
        description="Server tidak dapat membaca invoice akun ini."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>

      <UiEmptyState
        v-else-if="filtered.length === 0"
        :title="statusFilter ? 'Tidak ada invoice pada filter ini' : 'Belum ada invoice'"
        description="Invoice baru akan tampil setelah periode billing atau invoice manual diterbitkan."
      />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
            <tr>
              <th class="px-4 py-3 font-semibold">Invoice</th>
              <th class="px-4 py-3 font-semibold">Terbit / Jatuh tempo</th>
              <th class="px-4 py-3 text-right font-semibold">Total</th>
              <th class="px-4 py-3 text-right font-semibold">Sisa</th>
              <th class="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="invoice in filtered"
              :key="invoice.id"
              class="border-b last:border-0 hover:bg-surface-raised/60"
            >
              <td class="px-4 py-3">
                <NuxtLink
                  :to="`/portal/invoices/${invoice.id}`"
                  class="focus-ring rounded font-mono text-xs font-semibold text-brand hover:underline"
                >
                  {{ invoice.invoiceNumber }}
                </NuxtLink>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-muted">
                <span class="block">{{ format.date(invoice.issueDate) }}</span>
                <span class="block" :class="invoice.daysPastDue > 0 ? 'text-warning' : ''">
                  {{ format.date(invoice.dueDate) }}
                  <template v-if="invoice.daysPastDue > 0">
                    · +{{ invoice.daysPastDue }} hari
                  </template>
                </span>
              </td>
              <td class="px-4 py-3 text-right font-mono text-xs text-ink">
                <MoneyDisplay :amount="invoice.totalAmount" :currency="invoice.currency" />
              </td>
              <td class="px-4 py-3 text-right font-mono text-xs">
                <span :class="invoice.balanceDue === '0' ? 'text-muted' : 'text-ink'">
                  <MoneyDisplay :amount="invoice.balanceDue" :currency="invoice.currency" />
                </span>
              </td>
              <td class="px-4 py-3">
                <BillingStatusBadge kind="invoice" :status="invoice.status" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>
  </div>
</template>
