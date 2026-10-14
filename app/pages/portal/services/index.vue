<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import { billingCycleUnit } from '#shared/utils/billing-display'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Layanan · Portal' })

const { format, services, status, error, refresh } = await usePortalSummary()
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Customer portal / layanan
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Layanan</h1>
        <p class="mt-2 text-sm text-muted">
          Langganan, paket, dan jadwal tagihan berikutnya pada akun Anda.
        </p>
      </div>
      <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
        <RefreshCw :size="15" aria-hidden="true" /> Refresh
      </UiButton>
    </header>

    <div v-if="status === 'pending'" class="grid gap-4 md:grid-cols-2">
      <UiSkeleton v-for="card in 4" :key="card" height="12rem" />
    </div>

    <UiEmptyState
      v-else-if="error"
      title="Layanan tidak dapat dimuat"
      description="Server tidak dapat membaca layanan akun ini."
    >
      <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
    </UiEmptyState>

    <UiEmptyState
      v-else-if="services.length === 0"
      title="Belum ada layanan"
      description="Layanan yang terhubung ke akun ini akan tampil di sini."
    />

    <div v-else class="grid gap-4 md:grid-cols-2">
      <UiCard v-for="service in services" :key="service.id">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="font-mono text-[11px] font-semibold tracking-wider text-muted uppercase">
              {{ service.serviceNumber }}
            </p>
            <h2 class="mt-1 truncate text-base font-semibold text-ink">{{ service.name }}</h2>
            <p v-if="service.planName" class="mt-1 text-xs text-muted">{{ service.planName }}</p>
          </div>
          <ResourceStatusBadge :status="service.status" />
        </div>

        <dl class="mt-4 divide-y rounded-md border bg-canvas text-sm">
          <div class="flex justify-between gap-4 px-3 py-2.5">
            <dt class="text-muted">Harga</dt>
            <dd class="font-mono text-ink">
              {{ format.money(service.priceAmount, service.currency) }}
              <span class="text-muted">/ {{ billingCycleUnit(service.billingCycle) }}</span>
            </dd>
          </div>
          <div class="flex justify-between gap-4 px-3 py-2.5">
            <dt class="text-muted">Siklus</dt>
            <dd class="text-ink">{{ format.billingCycle(service.billingCycle) }}</dd>
          </div>
          <div class="flex justify-between gap-4 px-3 py-2.5">
            <dt class="text-muted">Tagihan berikutnya</dt>
            <dd class="text-ink">
              {{ service.nextDueDate ? format.date(service.nextDueDate) : '—' }}
            </dd>
          </div>
        </dl>

        <p v-if="service.description" class="mt-3 text-xs leading-5 text-muted">
          {{ service.description }}
        </p>
        <ul
          v-if="service.planInclusions.length"
          class="mt-3 space-y-1 text-xs leading-5 text-muted"
        >
          <li v-for="item in service.planInclusions" :key="item">{{ item }}</li>
        </ul>
        <p v-if="service.suspensionReason" class="mt-3 text-xs leading-5 text-warning">
          {{ service.suspensionReason }}
        </p>
      </UiCard>
    </div>
  </div>
</template>
