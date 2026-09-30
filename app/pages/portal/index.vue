<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import type { ApiPortalSummary } from '#shared/types/api'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Customer portal · Billing Infra' })

const format = useFormat()
const { data, status, error, refresh } = await useFetch<{ data: ApiPortalSummary }>(
  '/api/portal/summary',
)
const portal = computed(() => data.value?.data)
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Customer portal
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">
          {{ portal?.customer.companyName || portal?.customer.name || 'Billing account' }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          Service aktif, invoice, pembayaran, dan dokumen billing Anda.
        </p>
      </div>
      <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
        <RefreshCw :size="15" aria-hidden="true" /> Refresh
      </UiButton>
    </header>

    <UiEmptyState
      v-if="error"
      title="Portal tidak dapat dimuat"
      description="Akun ini belum terhubung ke customer atau server tidak tersedia."
    />
    <div v-else-if="status === 'pending'" class="space-y-4">
      <UiSkeleton height="7rem" /><UiSkeleton height="18rem" />
    </div>
    <template v-else-if="portal">
      <div class="mb-5 grid gap-4 md:grid-cols-3">
        <UiCard>
          <p class="text-xs font-semibold text-muted">Customer number</p>
          <p class="mt-2 font-mono text-lg font-semibold text-ink">
            {{ portal.customer.customerNumber }}
          </p>
        </UiCard>
        <UiCard>
          <p class="text-xs font-semibold text-muted">Service aktif</p>
          <p class="mt-2 font-mono text-2xl font-semibold text-ink">
            {{ portal.services.filter((service) => service.status === 'active').length }}
          </p>
        </UiCard>
        <UiCard>
          <p class="text-xs font-semibold text-muted">Saldo terbuka</p>
          <p
            v-for="balance in portal.openBalance"
            :key="balance.currency"
            class="mt-2 font-mono text-lg font-semibold text-warning"
          >
            {{ format.money(balance.amount, balance.currency) }}
          </p>
          <p v-if="!portal.openBalance.length" class="mt-2 text-sm text-brand">Tidak ada saldo.</p>
        </UiCard>
      </div>

      <div class="mb-5 grid gap-4 lg:grid-cols-2">
        <UiCard :padded="false">
          <div class="border-b px-4 py-3 text-xs font-semibold text-muted">Services</div>
          <UiEmptyState
            v-if="!portal.services.length"
            title="Belum ada service"
            description="Tidak ada service yang terhubung ke akun ini."
          />
          <div v-else class="divide-y">
            <div
              v-for="service in portal.services"
              :key="service.id"
              class="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p class="text-sm font-medium text-ink">{{ service.name }}</p>
                <p class="font-mono text-xs text-muted">
                  {{ service.serviceNumber }} · {{ service.planName }}
                </p>
              </div>
              <ResourceStatusBadge :status="service.status" />
            </div>
          </div>
        </UiCard>

        <UiCard :padded="false">
          <div class="border-b px-4 py-3 text-xs font-semibold text-muted">Invoice terbaru</div>
          <UiEmptyState
            v-if="!portal.invoices.length"
            title="Belum ada invoice"
            description="Invoice baru akan tampil di sini."
          />
          <div v-else class="divide-y">
            <NuxtLink
              v-for="invoice in portal.invoices"
              :key="invoice.id"
              :to="`/portal/invoices/${invoice.id}`"
              class="focus-ring flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-raised"
            >
              <div>
                <p class="font-mono text-xs font-semibold text-brand">
                  {{ invoice.invoiceNumber }}
                </p>
                <p class="mt-1 text-xs text-muted">
                  {{ format.date(invoice.issueDate) }} ·
                  {{ format.money(invoice.totalAmount, invoice.currency) }}
                </p>
              </div>
              <BillingStatusBadge kind="invoice" :status="invoice.status" />
            </NuxtLink>
          </div>
        </UiCard>
      </div>
    </template>
  </div>
</template>
