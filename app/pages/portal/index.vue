<script setup lang="ts">
import { AlertTriangle, ArrowRight } from '@lucide/vue'
import { billingCycleUnit } from '#shared/utils/billing-display'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Portal · Billing Infra' })

const {
  format,
  portal,
  openInvoices,
  overdueInvoices,
  activeServices,
  openBalanceLabel,
  status,
  error,
  refresh,
} = await usePortalSummary()

const displayName = computed(
  () => portal.value?.customer.companyName || portal.value?.customer.name || 'Akun billing',
)
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Customer portal / ringkasan
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ displayName }}</h1>
        <p class="mt-2 text-sm text-muted">Lihat invoice, layanan, dan sisa tagihan akun Anda.</p>
      </div>
      <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
    </header>

    <UiEmptyState
      v-if="error"
      title="Portal tidak dapat dimuat"
      description="Akun ini belum terhubung ke customer atau server tidak tersedia."
    >
      <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
    </UiEmptyState>

    <div v-else-if="status === 'pending'" class="space-y-4">
      <UiSkeleton height="6rem" />
      <div class="grid gap-4 md:grid-cols-3">
        <UiSkeleton v-for="card in 3" :key="card" height="7rem" />
      </div>
      <UiSkeleton height="18rem" />
    </div>

    <template v-else-if="portal">
      <div
        v-if="overdueInvoices.length"
        class="mb-5 flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-start gap-3">
          <AlertTriangle class="mt-0.5 shrink-0 text-warning" :size="18" aria-hidden="true" />
          <div>
            <p class="text-sm font-semibold text-warning">Ada invoice jatuh tempo</p>
            <p class="mt-1 text-xs leading-5 text-muted">
              {{ format.count(overdueInvoices.length) }} invoice belum dilunasi. Unduh PDF dan
              selesaikan pembayaran agar layanan tidak dibatasi.
            </p>
          </div>
        </div>
        <UiButton
          size="sm"
          class="shrink-0"
          @click="navigateTo(`/portal/invoices/${overdueInvoices[0]!.id}`)"
        >
          Lihat invoice
          <ArrowRight :size="14" aria-hidden="true" />
        </UiButton>
      </div>

      <div class="mb-5 grid gap-4 sm:grid-cols-3">
        <UiStat
          label="Sisa tagihan"
          :value="openBalanceLabel || 'Lunas'"
          :detail="
            openInvoices.length
              ? `${format.count(openInvoices.length)} invoice terbuka`
              : 'Tidak ada tagihan terbuka'
          "
          :tone="openBalanceLabel ? 'warning' : 'success'"
        />
        <UiStat
          label="Layanan aktif"
          :value="format.count(activeServices.length)"
          :detail="`${format.count(portal.services.length)} total layanan`"
        />
        <UiStat
          label="Nomor akun"
          :value="portal.customer.customerNumber"
          :detail="portal.customer.email"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <UiCard :padded="false">
          <div class="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 class="text-sm font-semibold text-ink">Invoice terbuka</h2>
              <p class="text-[11px] text-muted">Belum dibayar atau jatuh tempo</p>
            </div>
            <NuxtLink
              to="/portal/invoices"
              class="focus-ring rounded text-xs font-semibold text-brand hover:underline"
            >
              Semua invoice
            </NuxtLink>
          </div>
          <UiEmptyState
            v-if="!openInvoices.length"
            title="Tidak ada tagihan terbuka"
            description="Invoice baru akan tampil di sini saat periode billing tiba."
          />
          <div v-else class="divide-y">
            <NuxtLink
              v-for="invoice in openInvoices.slice(0, 6)"
              :key="invoice.id"
              :to="`/portal/invoices/${invoice.id}`"
              class="focus-ring flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-raised"
            >
              <div class="min-w-0">
                <p class="font-mono text-xs font-semibold text-brand">
                  {{ invoice.invoiceNumber }}
                </p>
                <p class="mt-1 text-xs text-muted">
                  Jatuh tempo {{ format.date(invoice.dueDate) }}
                  <span v-if="invoice.daysPastDue > 0" class="text-warning">
                    · +{{ invoice.daysPastDue }} hari
                  </span>
                </p>
              </div>
              <div class="text-right">
                <p class="font-mono text-xs font-semibold text-ink">
                  {{ format.money(invoice.balanceDue, invoice.currency) }}
                </p>
                <div class="mt-1 flex justify-end">
                  <BillingStatusBadge kind="invoice" :status="invoice.status" />
                </div>
              </div>
            </NuxtLink>
          </div>
        </UiCard>

        <UiCard :padded="false">
          <div class="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 class="text-sm font-semibold text-ink">Layanan aktif</h2>
              <p class="text-[11px] text-muted">Langganan yang sedang berjalan</p>
            </div>
            <NuxtLink
              to="/portal/services"
              class="focus-ring rounded text-xs font-semibold text-brand hover:underline"
            >
              Semua layanan
            </NuxtLink>
          </div>
          <UiEmptyState
            v-if="!activeServices.length"
            title="Belum ada layanan aktif"
            description="Layanan yang terhubung ke akun ini akan tampil di sini."
          />
          <div v-else class="divide-y">
            <div
              v-for="service in activeServices.slice(0, 6)"
              :key="service.id"
              class="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-ink">{{ service.name }}</p>
                <p class="mt-1 font-mono text-[11px] text-muted">
                  {{ service.serviceNumber }}
                  <span v-if="service.planName"> · {{ service.planName }}</span>
                </p>
              </div>
              <div class="text-right">
                <p class="font-mono text-xs text-ink">
                  {{ format.money(service.priceAmount, service.currency) }}
                  <span class="text-muted"> / {{ billingCycleUnit(service.billingCycle) }} </span>
                </p>
                <p class="mt-1 text-[11px] text-muted">
                  {{
                    service.nextDueDate
                      ? `Tagihan ${format.date(service.nextDueDate)}`
                      : format.billingCycle(service.billingCycle)
                  }}
                </p>
              </div>
            </div>
          </div>
        </UiCard>
      </div>
    </template>
  </div>
</template>
