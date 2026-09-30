<script setup lang="ts">
import { Download, RefreshCw } from '@lucide/vue'
import type { ApiReportSummary } from '#shared/types/api'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Reports · Billing Infra' })

const format = useFormat()
const from = ref('')
const to = ref('')
const query = computed(() => ({ from: from.value || undefined, to: to.value || undefined }))
const { data, status, error, refresh } = await useFetch<{ data: ApiReportSummary }>(
  '/api/reports/summary',
  { query },
)
const report = computed(() => data.value?.data)
const exportUrl = computed(() => {
  const params = new URLSearchParams()
  if (from.value) params.set('from', from.value)
  if (to.value) params.set('to', to.value)
  return `/api/reports/export${params.size ? `?${params}` : ''}`
})
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Commercial / reports
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Financial reports</h1>
        <p class="mt-2 text-sm text-muted">Invoice, collection, dan outstanding per periode.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" aria-hidden="true" /> Refresh
        </UiButton>
        <a
          :href="exportUrl"
          class="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-brand bg-brand px-4 text-sm font-semibold text-[#071109]"
        >
          <Download :size="15" aria-hidden="true" /> Export CSV
        </a>
      </div>
    </header>

    <UiCard class="mb-5">
      <div class="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
        <UiInput v-model="from" label="Dari tanggal" type="date" />
        <UiInput v-model="to" label="Sampai tanggal" type="date" />
      </div>
    </UiCard>

    <UiEmptyState
      v-if="error"
      title="Laporan tidak dapat dimuat"
      description="Periksa rentang tanggal lalu coba lagi."
    />
    <div v-else-if="status === 'pending'" class="grid gap-4 md:grid-cols-3">
      <UiSkeleton v-for="item in 3" :key="item" height="7rem" />
    </div>
    <template v-else-if="report">
      <div class="mb-5 grid gap-4 md:grid-cols-3">
        <UiCard>
          <p class="text-xs font-semibold text-muted">Invoiced</p>
          <p
            v-for="entry in report.invoiced"
            :key="entry.currency"
            class="mt-2 font-mono text-xl font-semibold text-ink"
          >
            {{ format.money(entry.amount, entry.currency) }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ report.invoiced.reduce((sum, entry) => sum + entry.count, 0) }} invoice
          </p>
        </UiCard>
        <UiCard>
          <p class="text-xs font-semibold text-muted">Collected net</p>
          <p
            v-for="entry in report.collected"
            :key="entry.currency"
            class="mt-2 font-mono text-xl font-semibold text-brand"
          >
            {{ format.money(entry.amount, entry.currency) }}
          </p>
          <p v-if="!report.collected.length" class="mt-2 text-sm text-muted">Belum ada payment.</p>
        </UiCard>
        <UiCard>
          <p class="text-xs font-semibold text-muted">Outstanding</p>
          <p
            v-for="entry in report.outstanding"
            :key="entry.currency"
            class="mt-2 font-mono text-xl font-semibold text-warning"
          >
            {{ format.money(entry.amount, entry.currency) }}
          </p>
          <p v-if="!report.outstanding.length" class="mt-2 text-sm text-muted">Tidak ada saldo.</p>
        </UiCard>
      </div>

      <UiCard :padded="false">
        <div class="border-b px-4 py-3 text-xs font-semibold text-muted">Monthly breakdown</div>
        <UiEmptyState
          v-if="!report.monthly.length"
          title="Belum ada data"
          description="Tidak ada transaksi pada rentang yang dipilih."
        />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[620px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3">Bulan</th>
                <th class="px-4 py-3">Currency</th>
                <th class="px-4 py-3 text-right">Invoiced</th>
                <th class="px-4 py-3 text-right">Collected</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in report.monthly"
                :key="`${row.month}-${row.currency}`"
                class="border-b"
              >
                <td class="px-4 py-3 font-mono text-ink">{{ row.month }}</td>
                <td class="px-4 py-3 text-muted">{{ row.currency }}</td>
                <td class="px-4 py-3 text-right font-mono">
                  {{ format.money(row.invoiced, row.currency) }}
                </td>
                <td class="px-4 py-3 text-right font-mono">
                  {{ format.money(row.collected, row.currency) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </template>
  </div>
</template>
