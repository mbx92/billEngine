<script setup lang="ts">
import { AlertTriangle, ArrowRight, CheckCircle2, CreditCard } from '@lucide/vue'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Status layanan · Billing Infra' })

type NoticeData =
  | { state: 'normal'; returnUrl: string }
  | {
      state: 'grace' | 'blocked'
      serviceName: string | null
      serviceNumber: string | null
      invoiceNumber: string
      dueDate: string
      daysPastDue: number
      graceEndsAt: string | null
      continueUrl: string | null
      portalUrl: string
    }

const route = useRoute()
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const { data, status, error } = await useFetch<{ data: NoticeData }>('/api/billing-gate/notice', {
  query: { token },
})
const notice = computed(() => data.value?.data)
const format = useFormat()

function leaveFor(url: string) {
  if (import.meta.client) window.location.assign(url)
}
</script>

<template>
  <div class="w-full max-w-lg">
    <div class="mb-6 flex items-center gap-3">
      <span
        class="flex size-10 items-center justify-center rounded-md border border-warning/30 bg-warning/10"
      >
        <AlertTriangle :size="20" class="text-warning" aria-hidden="true" />
      </span>
      <div>
        <strong class="block text-sm">Billing notice</strong>
        <span class="font-mono text-[10px] tracking-wider text-muted uppercase"
          >service access control</span
        >
      </div>
    </div>

    <UiCard v-if="status === 'pending'">
      <UiSkeleton height="12rem" />
    </UiCard>

    <UiCard v-else-if="error || !notice">
      <h1 class="text-xl font-semibold tracking-tight">Tautan tidak valid</h1>
      <p class="mt-2 text-sm leading-6 text-muted">
        Pemberitahuan ini sudah kedaluwarsa atau tidak dapat diverifikasi. Buka kembali alamat
        layanan untuk memperoleh tautan baru.
      </p>
    </UiCard>

    <UiCard v-else-if="notice.state === 'normal'">
      <CheckCircle2 :size="28" class="text-brand" aria-hidden="true" />
      <h1 class="mt-4 text-xl font-semibold tracking-tight">Akses sudah dipulihkan</h1>
      <p class="mt-2 text-sm leading-6 text-muted">
        Tidak ada pembatasan billing aktif untuk layanan ini.
      </p>
      <UiButton class="mt-6 w-full" @click="leaveFor(notice.returnUrl)">
        Kembali ke layanan <ArrowRight :size="15" aria-hidden="true" />
      </UiButton>
    </UiCard>

    <UiCard v-else>
      <UiBadge :tone="notice.state === 'grace' ? 'warning' : 'danger'">
        {{ notice.state === 'grace' ? 'Grace period' : 'Access blocked' }}
      </UiBadge>
      <h1 class="mt-4 text-xl font-semibold tracking-tight">
        {{
          notice.state === 'grace' ? 'Invoice layanan telah jatuh tempo' : 'Akses layanan dibatasi'
        }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-muted">
        <template v-if="notice.state === 'grace'">
          Layanan masih dapat digunakan selama grace period. Selesaikan pembayaran sebelum batas
          waktu agar akses tidak dibatasi.
        </template>
        <template v-else>
          Grace period telah berakhir. Selesaikan invoice melalui customer portal untuk memulihkan
          akses.
        </template>
      </p>

      <dl class="mt-5 divide-y rounded-md border bg-canvas px-4 text-sm">
        <div class="flex justify-between gap-4 py-3">
          <dt class="text-muted">Layanan</dt>
          <dd class="text-right font-medium">{{ notice.serviceName || notice.serviceNumber }}</dd>
        </div>
        <div class="flex justify-between gap-4 py-3">
          <dt class="text-muted">Invoice</dt>
          <dd class="font-mono text-right">{{ notice.invoiceNumber }}</dd>
        </div>
        <div class="flex justify-between gap-4 py-3">
          <dt class="text-muted">Jatuh tempo</dt>
          <dd class="text-right">{{ format.date(notice.dueDate) }}</dd>
        </div>
        <div v-if="notice.graceEndsAt" class="flex justify-between gap-4 py-3">
          <dt class="text-muted">Batas grace</dt>
          <dd class="text-right">{{ format.date(notice.graceEndsAt) }}</dd>
        </div>
      </dl>

      <div class="mt-6 grid gap-3" :class="notice.continueUrl ? 'sm:grid-cols-2' : ''">
        <UiButton @click="leaveFor(notice.portalUrl)">
          <CreditCard :size="15" aria-hidden="true" /> Buka customer portal
        </UiButton>
        <UiButton
          v-if="notice.continueUrl"
          variant="secondary"
          @click="leaveFor(notice.continueUrl)"
        >
          Lanjutkan ke layanan <ArrowRight :size="15" aria-hidden="true" />
        </UiButton>
      </div>

      <p v-if="notice.state === 'grace'" class="mt-4 text-center text-xs leading-5 text-muted">
        Pemberitahuan akan ditampilkan kembali secara berkala sampai invoice dilunasi.
      </p>
    </UiCard>
  </div>
</template>
