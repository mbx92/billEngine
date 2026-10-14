<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Akun · Portal' })

const { portal, status, error, refresh } = await usePortalSummary()
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Customer portal / akun
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Akun billing</h1>
        <p class="mt-2 text-sm text-muted">
          Data yang tercatat pada invoice Anda. Hubungi admin jika ada yang perlu diubah.
        </p>
      </div>
      <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
        <RefreshCw :size="15" aria-hidden="true" /> Refresh
      </UiButton>
    </header>

    <UiEmptyState
      v-if="error"
      title="Akun tidak dapat dimuat"
      description="Akun ini belum terhubung ke customer atau server tidak tersedia."
    >
      <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
    </UiEmptyState>

    <UiSkeleton v-else-if="status === 'pending'" height="20rem" />

    <UiCard v-else-if="portal">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="font-mono text-xs font-semibold text-brand">
            {{ portal.customer.customerNumber }}
          </p>
          <h2 class="mt-1 text-lg font-semibold text-ink">
            {{ portal.customer.companyName || portal.customer.name }}
          </h2>
          <p v-if="portal.customer.companyName" class="mt-1 text-sm text-muted">
            {{ portal.customer.name }}
          </p>
        </div>
        <UiBadge :tone="portal.customer.status === 'active' ? 'success' : 'neutral'" dot>
          {{ portal.customer.status === 'active' ? 'Aktif' : 'Nonaktif' }}
        </UiBadge>
      </div>

      <dl class="mt-5 divide-y rounded-md border bg-canvas text-sm">
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted">Email</dt>
          <dd class="text-right text-ink">{{ portal.customer.email }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted">Telepon</dt>
          <dd class="text-right text-ink">{{ portal.customer.phone || '—' }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted">Alamat</dt>
          <dd class="max-w-72 text-right text-ink">{{ portal.customer.address || '—' }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted">NPWP / Tax ID</dt>
          <dd class="font-mono text-right text-ink">{{ portal.customer.taxId || '—' }}</dd>
        </div>
      </dl>

      <p class="mt-4 text-xs leading-5 text-muted">
        Perubahan nama, alamat, atau NPWP memengaruhi invoice berikutnya. Invoice yang sudah
        terbit tetap memakai snapshot saat diterbitkan.
      </p>
    </UiCard>
  </div>
</template>
