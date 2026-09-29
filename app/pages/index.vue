<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import type { ApiDashboard } from '#shared/types/api'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Infrastructure Overview · Billing Infra' })

const format = useFormat()
const { companyName, companyEmail } = useRuntimeConfig().public

const { data, status, error, refresh } = await useFetch<{ data: ApiDashboard }>('/api/dashboard')

const overview = computed(() => data.value?.data)

const stats = computed(() => {
  const value = overview.value
  return [
    {
      label: 'Monthly recurring',
      value: value ? format.money(value.revenue.monthlyRecurring, value.revenue.currency) : '—',
      detail: 'Active recurring services',
      tone: 'success' as const,
    },
    {
      label: 'Active customers',
      value: value ? format.count(value.customers.active) : '—',
      detail: value ? `${format.count(value.customers.total)} total customers` : '',
    },
    {
      label: 'Unpaid balance',
      value: value ? format.money(value.invoices.unpaidBalance) : '—',
      detail: value ? `${format.count(value.invoices.open)} open invoices` : '',
      tone: 'warning' as const,
    },
    {
      label: 'Coolify apps',
      value: value ? format.count(value.resources.total) : '—',
      detail: value ? `${format.count(value.resources.running)} running` : '',
    },
  ]
})
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Control plane / overview
        </p>
        <h1 class="text-2xl font-semibold tracking-tight">Infrastructure Overview</h1>
        <p class="mt-2 text-sm text-muted">Commercial health and the last known Coolify state.</p>
      </div>
      <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
        <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
        Refresh
      </UiButton>
    </header>

    <div
      v-if="error"
      class="mb-5 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger"
    >
      Gagal memuat ringkasan dashboard. Angka di bawah dapat tidak akurat.
    </div>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
      <UiStat
        v-for="stat in stats"
        :key="stat.label"
        :label="stat.label"
        :value="status === 'pending' ? '—' : stat.value"
        :detail="stat.detail"
        :tone="stat.tone"
      />
    </div>

    <div class="mt-5 grid gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <UiCard :padded="false" class="overflow-hidden">
        <div class="flex h-12 items-center justify-between border-b px-5">
          <div>
            <h2 class="text-sm font-semibold">Coolify resources</h2>
            <p class="text-[11px] text-muted">Cached infrastructure state</p>
          </div>
          <UiBadge :tone="overview?.resources.lastSyncedAt ? 'success' : 'neutral'" dot>
            {{ overview?.resources.lastSyncedAt ? 'Synced' : 'Not synced' }}
          </UiBadge>
        </div>

        <dl class="grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0">
          <div class="px-5 py-4">
            <dt class="text-[11px] tracking-wide text-muted uppercase">Total</dt>
            <dd class="mt-2 font-mono text-xl text-ink">
              {{ overview ? format.count(overview.resources.total) : '—' }}
            </dd>
          </div>
          <div class="px-5 py-4">
            <dt class="text-[11px] tracking-wide text-muted uppercase">Running</dt>
            <dd class="mt-2 font-mono text-xl text-ink">
              {{ overview ? format.count(overview.resources.running) : '—' }}
            </dd>
          </div>
          <div class="px-5 py-4">
            <dt class="text-[11px] tracking-wide text-muted uppercase">Billable</dt>
            <dd class="mt-2 font-mono text-xl text-ink">
              {{ overview ? format.count(overview.resources.billable) : '—' }}
            </dd>
          </div>
          <div class="px-5 py-4">
            <dt class="text-[11px] tracking-wide text-muted uppercase">Not billed</dt>
            <dd
              class="mt-2 font-mono text-xl"
              :class="overview && overview.resources.notBilled > 0 ? 'text-warning' : 'text-ink'"
            >
              {{ overview ? format.count(overview.resources.notBilled) : '—' }}
            </dd>
          </div>
        </dl>

        <div class="border-t px-5 py-4">
          <p class="text-[11px] text-muted">
            Last synced:
            <span class="font-mono">{{ format.dateTime(overview?.resources.lastSyncedAt) }}</span>
          </p>
          <NuxtLink
            to="/resources"
            class="focus-ring mt-3 inline-flex text-xs font-semibold text-brand hover:underline"
          >
            Lihat resource inventory →
          </NuxtLink>
        </div>
      </UiCard>

      <div class="space-y-4 sm:space-y-6">
        <UiCard>
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">Server capacity</h2>
            <span class="font-mono text-[10px] text-muted">LAST KNOWN</span>
          </div>
          <div class="mt-5 space-y-5">
            <div>
              <div class="mb-2 flex justify-between text-xs">
                <span class="text-muted">Allocated CPU</span>
                <span class="font-mono">{{ format.cpu(overview?.capacity.cpuCores ?? null) }}</span>
              </div>
              <UiProgress :value="0" />
            </div>
            <div>
              <div class="mb-2 flex justify-between text-xs">
                <span class="text-muted">Allocated memory</span>
                <span class="font-mono">{{
                  format.bytes(overview?.capacity.memoryBytes ?? null)
                }}</span>
              </div>
              <UiProgress :value="0" />
            </div>
          </div>
          <p class="mt-4 text-[11px] text-muted">
            “Unlimited” berarti aplikasi belum memiliki limit CPU/memory di Coolify.
          </p>
        </UiCard>

        <UiCard>
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">Attention</h2>
            <UiBadge :tone="overview && overview.invoices.overdue > 0 ? 'warning' : 'success'">
              {{ overview && overview.invoices.overdue > 0 ? 'Perlu tindakan' : 'Clear' }}
            </UiBadge>
          </div>
          <div class="mt-5 grid grid-cols-2 gap-3 text-center">
            <div class="rounded-md border bg-canvas p-3">
              <strong class="block font-mono text-xl">{{
                overview ? format.count(overview.resources.notBilled) : '—'
              }}</strong
              ><span class="text-[11px] text-muted">Not billed</span>
            </div>
            <div class="rounded-md border bg-canvas p-3">
              <strong class="block font-mono text-xl">{{
                overview ? format.count(overview.invoices.overdue) : '—'
              }}</strong
              ><span class="text-[11px] text-muted">Overdue</span>
            </div>
          </div>
        </UiCard>
      </div>
    </div>

    <footer class="mt-8 border-t pt-4 font-mono text-[10px] tracking-wider text-muted uppercase">
      {{ companyName }}<span v-if="companyEmail"> · {{ companyEmail }}</span>
    </footer>
  </div>
</template>
