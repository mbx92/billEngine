<script setup lang="ts">
import { AlertTriangle, ArrowRight, CheckCircle2, CreditCard, Server } from '@lucide/vue'

definePageMeta({ layout: false })

type DemoState = 'normal' | 'grace' | 'blocked'

interface DemoCustomer {
  slug: string
  customerName: string
  contactName: string
  serviceNumber: string
  planName: string
  serviceStatus: string
  invoiceNumber: string
  invoiceStatus: string
  balanceDue: string
  daysPastDue: number
  graceEndsAt: string | null
  state: DemoState
  resourceState: string
  portalUrl: string
}

const demoLinks = [
  { slug: 'demo-customer-1', label: 'Running' },
  { slug: 'demo-customer-2', label: 'Grace' },
  { slug: 'demo-customer-3', label: 'Suspend' },
]

const route = useRoute()
const requestedSlug = computed(() => String(route.params.customer || 'demo-customer-1'))
const noticeDismissed = ref(false)
const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<{ data: DemoCustomer }>(() => `/api/demo/customers/${requestedSlug.value}`, {
  watch: [requestedSlug],
})
const customer = computed(() => response.value?.data)
const showApplication = computed(
  () =>
    customer.value?.state === 'normal' ||
    (customer.value?.state === 'grace' && noticeDismissed.value),
)
const accent = computed(() => {
  if (customer.value?.state === 'grace') return '#b45309'
  if (customer.value?.state === 'blocked') return '#b42318'
  return '#16803c'
})

watch(requestedSlug, () => {
  noticeDismissed.value = false
})

let refreshTimer: number | undefined
onMounted(() => {
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, 5_000)
})
onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
})

useHead(() => ({
  title: `${customer.value?.customerName || 'Customer Status Demo'} · Customer Status Demo`,
}))
</script>

<template>
  <div class="min-h-screen bg-[#f5f7fa] text-[#17202a]">
    <header class="border-b border-[#dfe3e8] bg-white">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div class="flex items-center gap-3">
          <span class="grid size-9 place-items-center rounded-lg bg-[#17202a] text-white">
            <Server :size="17" aria-hidden="true" />
          </span>
          <div>
            <strong class="block text-sm">Customer Status Demo</strong>
            <span class="font-mono text-[10px] tracking-wider text-[#667085] uppercase">
              satu image · tiga customer
            </span>
          </div>
        </div>

        <nav class="flex flex-wrap gap-2" aria-label="Pilih skenario customer">
          <NuxtLink
            v-for="item in demoLinks"
            :key="item.slug"
            :to="`/demo/${item.slug}`"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="
              item.slug === requestedSlug
                ? 'border-[#17202a] bg-[#17202a] text-white'
                : 'border-[#d0d5dd] bg-white text-[#475467] hover:border-[#98a2b3]'
            "
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
      </div>
    </header>

    <main class="mx-auto grid min-h-[calc(100vh-74px)] max-w-6xl place-items-center px-5 py-12">
      <section
        v-if="status === 'pending' && !customer"
        class="w-full max-w-lg rounded-2xl border border-[#dfe3e8] bg-white p-8 text-center"
      >
        <p class="text-sm text-[#667085]">Memuat status billing terbaru…</p>
      </section>

      <section
        v-else-if="error || !customer"
        class="w-full max-w-lg rounded-2xl border border-[#dfe3e8] bg-white p-8"
      >
        <AlertTriangle :size="24" class="text-[#b42318]" aria-hidden="true" />
        <h1 class="mt-4 text-xl font-semibold">Preview tidak dapat dimuat</h1>
        <p class="mt-2 text-sm text-[#667085]">Pastikan data demo sudah dimasukkan melalui seed.</p>
        <button
          type="button"
          class="mt-5 rounded-md bg-[#17202a] px-4 py-2 text-sm font-semibold text-white"
          @click="refresh()"
        >
          Coba lagi
        </button>
      </section>

      <section
        v-else-if="showApplication"
        class="w-full max-w-2xl rounded-2xl border border-[#dfe3e8] bg-white p-8 shadow-[0_18px_55px_rgb(20_32_50/8%)] sm:p-10"
      >
        <p class="font-mono text-xs font-semibold tracking-wider text-[#667085] uppercase">
          aplikasi customer · instance {{ customer.serviceNumber }}
        </p>
        <h1 class="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          {{ customer.customerName }}
        </h1>
        <p class="mt-3 text-[#667085]">Selamat datang, {{ customer.contactName }}.</p>

        <div
          class="mt-8 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold"
          :style="{ color: accent, backgroundColor: `${accent}12` }"
        >
          <span class="size-2.5 rounded-full bg-current" />
          {{ customer.state === 'grace' ? 'Running dalam grace period' : 'Running normal' }}
        </div>

        <p class="mt-5 max-w-xl text-base leading-7 text-[#475467]">
          <template v-if="customer.state === 'grace'">
            Aplikasi tetap berjalan. Billing notice sudah dilewati untuk sesi ini, tetapi akan
            muncul kembali secara berkala sampai invoice dibayar.
          </template>
          <template v-else-if="customer.invoiceStatus === 'paid'">
            Pembayaran sudah diterima. Billing gate langsung membuka akses kembali tanpa memulai
            ulang container.
          </template>
          <template v-else>
            Layanan aktif, resource berjalan, dan tidak ada pembatasan billing pada customer ini.
          </template>
        </p>

        <dl class="mt-8 grid gap-5 border-t border-[#e4e7ec] pt-6 sm:grid-cols-4">
          <div>
            <dt class="text-xs tracking-wide text-[#667085] uppercase">Service</dt>
            <dd class="mt-1 font-mono text-sm">{{ customer.serviceNumber }}</dd>
          </div>
          <div>
            <dt class="text-xs tracking-wide text-[#667085] uppercase">Plan</dt>
            <dd class="mt-1 text-sm font-medium">{{ customer.planName }}</dd>
          </div>
          <div>
            <dt class="text-xs tracking-wide text-[#667085] uppercase">Invoice</dt>
            <dd class="mt-1 text-sm font-medium">{{ customer.invoiceStatus }}</dd>
          </div>
          <div>
            <dt class="text-xs tracking-wide text-[#667085] uppercase">Container</dt>
            <dd class="mt-1 text-sm font-medium">{{ customer.resourceState }}</dd>
          </div>
        </dl>
      </section>

      <section
        v-else
        class="w-full max-w-lg rounded-2xl border border-[#dfe3e8] bg-white p-8 shadow-[0_18px_55px_rgb(20_32_50/8%)]"
      >
        <div
          class="flex size-11 items-center justify-center rounded-lg bg-[#fef3f2] text-[#b42318]"
        >
          <AlertTriangle :size="22" aria-hidden="true" />
        </div>
        <div
          class="mt-6 inline-flex rounded-full px-3 py-1 text-xs font-bold"
          :class="
            customer.state === 'grace'
              ? 'bg-[#fffaeb] text-[#b54708]'
              : 'bg-[#fef3f2] text-[#b42318]'
          "
        >
          {{ customer.state === 'grace' ? 'Grace period' : 'Access blocked' }}
        </div>
        <h1 class="mt-4 text-2xl font-semibold tracking-tight">
          {{
            customer.state === 'grace'
              ? 'Invoice layanan telah jatuh tempo'
              : 'Akses layanan dibatasi'
          }}
        </h1>
        <p class="mt-3 text-sm leading-6 text-[#667085]">
          <template v-if="customer.state === 'grace'">
            Layanan masih dapat digunakan selama grace period. Selesaikan pembayaran sebelum hari
            ke-7 agar akses tidak dibatasi.
          </template>
          <template v-else>
            Grace period telah berakhir. Container tetap berjalan, tetapi billing gate tidak
            meneruskan request ke aplikasi sampai invoice dilunasi.
          </template>
        </p>

        <dl class="mt-6 divide-y divide-[#e4e7ec] rounded-lg border border-[#e4e7ec] px-4 text-sm">
          <div class="flex justify-between gap-4 py-3">
            <dt class="text-[#667085]">Customer</dt>
            <dd class="text-right font-medium">{{ customer.customerName }}</dd>
          </div>
          <div class="flex justify-between gap-4 py-3">
            <dt class="text-[#667085]">Invoice</dt>
            <dd class="font-mono text-right">{{ customer.invoiceNumber }}</dd>
          </div>
          <div class="flex justify-between gap-4 py-3">
            <dt class="text-[#667085]">Terlambat</dt>
            <dd class="text-right">{{ customer.daysPastDue }} hari</dd>
          </div>
          <div class="flex justify-between gap-4 py-3">
            <dt class="text-[#667085]">Container</dt>
            <dd class="text-right font-semibold">{{ customer.resourceState }}</dd>
          </div>
        </dl>

        <div class="mt-6 grid gap-3" :class="customer.state === 'grace' ? 'sm:grid-cols-2' : ''">
          <NuxtLink
            :to="customer.portalUrl"
            class="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#17202a] px-4 text-sm font-semibold text-white"
          >
            <CreditCard :size="15" aria-hidden="true" /> Buka portal pembayaran
          </NuxtLink>
          <button
            v-if="customer.state === 'grace'"
            type="button"
            class="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[#d0d5dd] px-4 text-sm font-semibold"
            @click="noticeDismissed = true"
          >
            Lanjut ke aplikasi <ArrowRight :size="15" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          class="mt-4 w-full text-center text-xs font-semibold text-[#475467] underline"
          @click="refresh()"
        >
          Saya sudah membayar — cek ulang sekarang
        </button>
      </section>
    </main>

    <div class="fixed right-4 bottom-4">
      <div
        class="flex items-center gap-2 rounded-full border border-[#d0d5dd] bg-white px-3 py-2 text-xs text-[#475467] shadow-sm"
      >
        <CheckCircle2 :size="14" class="text-[#16803c]" aria-hidden="true" /> Status database ·
        refresh 5 detik
      </div>
    </div>
  </div>
</template>
