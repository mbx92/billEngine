<script setup lang="ts">
import { ClockAlert, Plus, RefreshCw, Zap } from '@lucide/vue'
import type { InvoiceStatus } from '#shared/constants/domain'
import type { ApiInvoiceListResponse, ApiRecurringRunResult } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Invoices · Billing Infra' })

const format = useFormat()
const settings = useAppSettings()
const page = ref(1)
const perPage = 25
const statusFilter = ref<InvoiceStatus | ''>('')
const query = ref('')
const busy = ref<'generate' | 'overdue' | null>(null)
const showManualForm = ref(false)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)

const { data, status, error, refresh } = await useFetch<ApiInvoiceListResponse>('/api/invoices', {
  query: { page, perPage, status: statusFilter, query },
})

const invoices = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta)
const summary = computed(() => data.value?.summary)

const statusTabs = computed(() => {
  const counts = summary.value?.counts
  return [
    {
      value: '' as const,
      label: 'Semua',
      count: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0,
    },
    { value: 'draft' as const, label: 'Draft', count: counts?.draft ?? 0 },
    { value: 'unpaid' as const, label: 'Unpaid', count: counts?.unpaid ?? 0 },
    { value: 'overdue' as const, label: 'Overdue', count: counts?.overdue ?? 0 },
    { value: 'paid' as const, label: 'Paid', count: counts?.paid ?? 0 },
    { value: 'cancelled' as const, label: 'Cancelled', count: counts?.cancelled ?? 0 },
  ]
})

const openBalance = computed(() => {
  const entries = summary.value?.currencies ?? []
  if (entries.length === 0) return '—'
  // Single-currency deployments dominate; show the first balance clearly.
  return format.money(entries[0]!.balance, entries[0]!.currency)
})

async function generateRecurring() {
  busy.value = 'generate'
  actionError.value = null
  actionMessage.value = null

  try {
    const response = await $fetch<{ data: ApiRecurringRunResult }>('/api/invoices/generate', {
      method: 'POST',
      body: {},
    })
    const created = response.data.created.length

    if (created === 0 && response.data.skipped.length === 0) {
      actionMessage.value =
        'Tidak ada service yang jadwal invoicenya sudah tiba. Tidak ada invoice baru dibuat.'
    } else if (created === 0) {
      actionMessage.value = `Tidak ada invoice baru. ${format.count(response.data.skipped.length)} service dilewati.`
    } else {
      const skipped = response.data.skipped.length
        ? ` · ${format.count(response.data.skipped.length)} dilewati`
        : ''
      actionMessage.value = `${format.count(created)} invoice dibuat: ${response.data.created
        .map((entry) => entry.invoiceNumber)
        .join(', ')}${skipped}`
    }

    page.value = 1
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal menjalankan billing engine.')
  } finally {
    busy.value = null
  }
}

async function markOverdue() {
  busy.value = 'overdue'
  actionError.value = null
  actionMessage.value = null
  try {
    const response = await $fetch<{ data: { marked: number; asOf: string } }>(
      '/api/invoices/mark-overdue',
      { method: 'POST', body: {} },
    )
    actionMessage.value = response.data.marked
      ? `${format.count(response.data.marked)} invoice ditandai overdue per ${format.date(response.data.asOf)}.`
      : 'Tidak ada invoice baru yang perlu ditandai overdue.'
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal memperbarui status overdue.')
  } finally {
    busy.value = null
  }
}

async function manualInvoiceCreated(invoice: { id: string; invoiceNumber: string }) {
  showManualForm.value = false
  await navigateTo(`/invoices/${invoice.id}`)
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 lg:flex-row lg:items-start">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Commercial / invoices
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Invoices</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Immutable customer and seller snapshots with payment and overdue state.
        </p>
      </div>
      <div class="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
        <UiButton class="w-full sm:w-auto" @click="showManualForm = true">
          <Plus :size="15" :stroke-width="1.8" aria-hidden="true" />
          Manual invoice
        </UiButton>
        <div class="flex flex-wrap justify-end gap-2">
          <UiButton
            variant="ghost"
            size="sm"
            :disabled="status === 'pending'"
            @click="refresh()"
          >
            <RefreshCw :size="14" :stroke-width="1.8" aria-hidden="true" />
            Refresh
          </UiButton>
          <UiButton variant="secondary" size="sm" :disabled="busy !== null" @click="markOverdue()">
            <ClockAlert :size="14" :stroke-width="1.8" aria-hidden="true" />
            {{ busy === 'overdue' ? 'Memproses…' : 'Mark overdue' }}
          </UiButton>
          <UiButton
            variant="secondary"
            size="sm"
            :disabled="busy !== null || !settings.billingAutomationEnabled"
            :title="
              settings.billingAutomationEnabled
                ? 'Jalankan recurring billing sekarang'
                : 'Aktifkan billing automation melalui Settings'
            "
            @click="generateRecurring()"
          >
            <Zap :size="14" :stroke-width="1.8" aria-hidden="true" />
            {{ busy === 'generate' ? 'Menjalankan…' : 'Generate' }}
          </UiButton>
        </div>
      </div>
    </header>

    <div class="mb-5 grid gap-4 sm:grid-cols-3 sm:gap-5">
      <UiStat
        label="Open invoices"
        :value="summary ? format.count(summary.counts.unpaid + summary.counts.overdue) : '—'"
        :detail="summary ? `${format.count(summary.counts.overdue)} overdue` : ''"
        :tone="summary && summary.counts.overdue > 0 ? 'warning' : 'neutral'"
      />
      <UiStat
        label="Unpaid balance"
        :value="openBalance"
        detail="Issued and not fully paid"
        tone="warning"
      />
      <UiStat
        label="Collected"
        :value="summary ? format.count(summary.counts.paid) : '—'"
        detail="Fully paid invoices"
        tone="success"
      />
    </div>

    <div
      v-if="actionError"
      class="mb-5 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger"
    >
      {{ actionError }}
    </div>
    <div
      v-else-if="actionMessage"
      class="mb-5 rounded-md border border-brand/30 bg-brand/10 px-4 py-3 text-xs text-brand"
    >
      {{ actionMessage }}
    </div>

    <ManualInvoiceDialog
      v-if="showManualForm"
      @close="showManualForm = false"
      @created="manualInvoiceCreated"
    />

    <UiCard :padded="false">
      <div class="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="tab in statusTabs"
            :key="tab.value"
            type="button"
            class="focus-ring rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase transition"
            :class="
              statusFilter === tab.value
                ? 'border-brand/40 bg-brand/10 text-brand'
                : 'border-line-strong bg-surface-raised text-muted hover:text-ink'
            "
            @click="
              () => {
                statusFilter = tab.value
                page = 1
              }
            "
          >
            {{ tab.label }}
            <span class="ml-1 font-mono">{{ format.count(tab.count) }}</span>
          </button>
        </div>
        <UiInput
          v-model="query"
          placeholder="Cari nomor / customer…"
          class="sm:max-w-xs"
          @change="page = 1"
        />
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="2.25rem" />
      </div>

      <UiEmptyState
        v-else-if="error"
        title="Gagal memuat invoices"
        description="Server tidak dapat membaca data invoice. Coba muat ulang halaman."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>

      <UiEmptyState
        v-else-if="invoices.length === 0"
        :title="statusFilter || query ? 'Invoice tidak ditemukan' : 'Belum ada invoice'"
        :description="
          statusFilter || query
            ? 'Tidak ada invoice yang cocok dengan filter saat ini.'
            : 'Buat manual invoice, atau aktifkan billing automation untuk invoice recurring.'
        "
      >
        <UiButton v-if="!statusFilter && !query" size="sm" @click="showManualForm = true">
          <Plus :size="14" :stroke-width="1.8" aria-hidden="true" />
          Buat manual invoice
        </UiButton>
      </UiEmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[900px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Invoice</th>
                <th class="px-4 py-3 font-semibold">Customer</th>
                <th class="px-4 py-3 font-semibold">Issue / Due</th>
                <th class="px-4 py-3 text-right font-semibold">Total</th>
                <th class="px-4 py-3 text-right font-semibold">Sisa</th>
                <th class="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="invoice in invoices"
                :key="invoice.id"
                class="border-b last:border-0 hover:bg-surface-raised/60"
              >
                <td class="px-4 py-3">
                  <NuxtLink
                    :to="`/invoices/${invoice.id}`"
                    class="focus-ring rounded font-mono text-xs font-semibold text-brand hover:underline"
                  >
                    {{ invoice.invoiceNumber }}
                  </NuxtLink>
                </td>
                <td class="px-4 py-3">
                  <span class="block text-ink">{{ invoice.customerName }}</span>
                  <span v-if="invoice.customerCompanyName" class="block text-xs text-muted">
                    {{ invoice.customerCompanyName }}
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-muted">
                  <span class="block">{{ format.date(invoice.issueDate) }}</span>
                  <span class="block" :class="invoice.daysPastDue > 0 ? 'text-warning' : ''">
                    {{ format.date(invoice.dueDate) }}
                    <template v-if="invoice.daysPastDue > 0">
                      · +{{ invoice.daysPastDue }}h
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
