<script setup lang="ts">
import type { ApiDashboard } from '#shared/types/api'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Ringkasan · Billing Infra' })

const format = useFormat()
const { data, status, error, refresh } = await useFetch<{ data: ApiDashboard }>('/api/dashboard')
const overview = computed(() => data.value?.data)
const stats = computed(() => {
  const value = overview.value
  return [
    {
      label: 'Pendapatan bulanan',
      value: value ? format.money(value.revenue.monthlyRecurring, value.revenue.currency) : '—',
      detail: 'Dari layanan berulang',
    },
    {
      label: 'Customer aktif',
      value: value ? format.count(value.customers.active) : '—',
      detail: value ? `${format.count(value.customers.total)} customer terdaftar` : '',
    },
    {
      label: 'Belum dibayar',
      value: value ? format.money(value.invoices.unpaidBalance) : '—',
      detail: value ? `${format.count(value.invoices.open)} invoice terbuka` : '',
    },
    {
      label: 'Resource',
      value: value ? format.count(value.resources.total) : '—',
      detail: value ? `${format.count(value.resources.running)} sedang berjalan` : '',
    },
  ]
})
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Ringkasan</h1>
        <p class="mt-1.5 text-sm text-muted">Billing dan infrastruktur yang dikelola.</p>
      </div>
      <div class="flex items-center gap-4">
        <NuxtLink to="/reports" class="focus-ring rounded text-xs text-brand hover:underline"
          >Lihat laporan</NuxtLink
        >
        <UiRefreshButton :action="refresh" :pending="status === 'pending'" size="sm" />
      </div>
    </header>

    <div v-if="error" class="rounded-md border p-5" role="alert">
      <h2 class="text-sm font-medium">Ringkasan tidak dapat dimuat</h2>
      <p class="mt-1 mb-4 text-sm text-muted">Coba muat ulang untuk mengambil data terbaru.</p>
      <UiRefreshButton
        :action="refresh"
        :pending="status === 'pending'"
        label="Coba lagi"
        size="sm"
      />
    </div>
    <div
      v-else-if="status === 'pending'"
      role="status"
      aria-label="Memuat ringkasan"
      class="space-y-6"
    >
      <UiSkeleton height="7rem" />
      <UiSkeleton height="18rem" />
      <span class="sr-only">Memuat ringkasan...</span>
    </div>
    <template v-else-if="overview">
      <dl class="grid gap-px border-y bg-line sm:grid-cols-2 xl:grid-cols-4">
        <div v-for="stat in stats" :key="stat.label" class="min-w-0 bg-canvas px-4 py-5">
          <dt class="text-xs text-muted">{{ stat.label }}</dt>
          <dd class="mt-2 break-words text-2xl font-medium tracking-tight tabular-nums">
            {{ stat.value }}
          </dd>
          <dd class="mt-1 text-xs text-muted">{{ stat.detail }}</dd>
        </div>
      </dl>

      <div class="mt-9 grid items-start gap-9 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section>
          <div class="mb-4 flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold">Resource</h2>
            <NuxtLink to="/resources" class="focus-ring rounded text-xs text-brand hover:underline"
              >Lihat semua</NuxtLink
            >
          </div>
          <div v-if="overview.resources.total" class="overflow-hidden rounded-md border">
            <table class="w-full text-left text-sm">
              <caption class="sr-only">
                Status dan billing resource
              </caption>
              <thead>
                <tr>
                  <th scope="col" class="px-4">Status</th>
                  <th scope="col" class="px-4 text-right">Jumlah</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                <tr>
                  <th scope="row" class="px-4 py-3 font-normal">Berjalan</th>
                  <td class="px-4 text-right text-success tabular-nums">
                    {{ format.count(overview.resources.running) }}
                  </td>
                </tr>
                <tr>
                  <th scope="row" class="px-4 py-3 font-normal">Status lainnya</th>
                  <td class="px-4 text-right tabular-nums">
                    {{
                      format.count(
                        Math.max(0, overview.resources.total - overview.resources.running),
                      )
                    }}
                  </td>
                </tr>
                <tr>
                  <th scope="row" class="px-4 py-3 font-normal">Billable</th>
                  <td class="px-4 text-right tabular-nums">
                    {{ format.count(overview.resources.billable) }}
                  </td>
                </tr>
                <tr>
                  <th scope="row" class="px-4 py-3 font-normal">Billable, terhubung ke layanan</th>
                  <td class="px-4 text-right tabular-nums">
                    {{
                      format.count(
                        Math.max(0, overview.resources.billable - overview.resources.notBilled),
                      )
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="rounded-md border px-4 py-8">
            <p class="text-sm">Belum ada resource.</p>
            <NuxtLink
              to="/resources"
              class="focus-ring mt-2 inline-block rounded text-xs text-brand hover:underline"
              >Tambahkan resource</NuxtLink
            >
          </div>
          <p class="mt-3 text-xs text-muted">
            {{
              overview.resources.lastSyncedAt
                ? `Sinkronisasi terakhir: ${format.dateTime(overview.resources.lastSyncedAt)}`
                : 'Belum ada data sinkronisasi.'
            }}
          </p>

          <div class="mt-8 border-t pt-5">
            <h2 class="text-sm font-semibold">Alokasi kapasitas</h2>
            <dl class="mt-4 flex flex-wrap gap-x-12 gap-y-4">
              <div>
                <dt class="text-xs text-muted">CPU</dt>
                <dd class="mt-1 text-sm font-medium tabular-nums">
                  {{ format.cpu(overview.capacity.cpuCores) }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">Memory</dt>
                <dd class="mt-1 text-sm font-medium tabular-nums">
                  {{ format.bytes(overview.capacity.memoryBytes) }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-muted">Resource</dt>
                <dd class="mt-1 text-sm font-medium tabular-nums">
                  {{ format.count(overview.capacity.resourceCount) }}
                </dd>
              </div>
            </dl>
            <p class="mt-4 text-xs leading-5 text-muted">
              Berdasarkan limit resource, bukan pemakaian saat ini.
            </p>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-sm font-semibold">Perlu ditinjau</h2>
          <div class="border-t">
            <NuxtLink
              to="/invoices"
              class="focus-ring flex items-start justify-between gap-4 border-b py-4 hover:bg-surface-raised/60"
            >
              <div>
                <p class="text-sm">Invoice jatuh tempo</p>
                <p class="mt-1 text-xs text-muted">
                  {{
                    overview.invoices.overdue
                      ? 'Lihat tagihan yang belum dilunasi.'
                      : 'Tidak ada invoice jatuh tempo.'
                  }}
                </p>
              </div>
              <span
                class="text-sm font-medium tabular-nums"
                :class="overview.invoices.overdue ? 'text-warning' : 'text-muted'"
                >{{ format.count(overview.invoices.overdue) }}</span
              >
            </NuxtLink>
            <NuxtLink
              to="/resources"
              class="focus-ring flex items-start justify-between gap-4 border-b py-4 hover:bg-surface-raised/60"
            >
              <div>
                <p class="text-sm">Resource belum ditagih</p>
                <p class="mt-1 text-xs text-muted">
                  {{
                    overview.resources.notBilled
                      ? 'Resource billable tanpa layanan.'
                      : 'Tidak ada resource billable tanpa layanan.'
                  }}
                </p>
              </div>
              <span
                class="text-sm font-medium tabular-nums"
                :class="overview.resources.notBilled ? 'text-warning' : 'text-muted'"
                >{{ format.count(overview.resources.notBilled) }}</span
              >
            </NuxtLink>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
