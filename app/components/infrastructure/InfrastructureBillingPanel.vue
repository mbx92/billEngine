<script setup lang="ts">
const props = defineProps<{ resourceId: string }>()
const { data, error, refresh } = await useFetch(
  () => `/api/infrastructure/resources/${props.resourceId}/service`,
)
const service = computed(() => data.value?.data)
const format = useFormat()
</script>

<template>
  <section>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">Layanan pelanggan &amp; billing</h2>
        <p class="mt-1 text-sm text-muted">Hubungan billing untuk deployment yang dipilih.</p>
      </div>
      <UiRefreshButton :action="refresh" size="sm" />
    </div>
    <UiEmptyState
      v-if="error"
      title="Informasi billing gagal dimuat"
      description="Coba muat ulang untuk membaca hubungan layanan."
    />
    <UiCard v-else-if="service">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="font-medium">{{ service.name }}</p>
          <p class="mt-1 text-xs text-muted">
            {{ service.serviceNumber }} · {{ service.customerName }}
          </p>
        </div>
        <UiBadge
          :tone="
            service.billingBlocked ? 'danger' : service.status === 'active' ? 'success' : 'neutral'
          "
          >{{ service.billingBlocked ? 'Akses diblokir billing' : service.status }}</UiBadge
        >
      </div>
      <dl class="mt-4 grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
        <div>
          <dt class="text-xs text-muted">Paket</dt>
          <dd class="mt-1">{{ service.planName }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Model billing</dt>
          <dd class="mt-1">{{ service.billingMode === 'postpaid' ? 'Pascabayar' : 'Prabayar' }}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Aktivasi tercatat</dt>
          <dd class="mt-1">
            {{ service.activatedAt ? format.dateTime(service.activatedAt) : 'Belum aktif' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Mulai periode billing</dt>
          <dd class="mt-1">
            {{ service.activatedAt ? service.billingStartDate : 'Menunggu aktivasi' }}
          </dd>
        </div>
      </dl>
      <p v-if="service.infrastructureError" class="mt-4 text-sm text-warning">
        {{ service.infrastructureError }}
      </p>
      <NuxtLink
        to="/services"
        class="focus-ring mt-4 inline-block rounded text-sm font-medium text-brand hover:underline"
        >Kelola layanan billing →</NuxtLink
      >
    </UiCard>
    <UiCard v-else
      ><h3 class="text-sm font-medium">Belum terhubung ke layanan pelanggan</h3>
      <p class="mt-2 text-sm leading-6 text-muted">
        Selesaikan konfigurasi, deployment, dan akses domain sebelum menghubungkan aplikasi ke
        layanan berbayar. Resource internal dapat tetap digunakan tanpa billing.
      </p>
      <NuxtLink
        to="/services"
        class="focus-ring mt-4 inline-block rounded text-sm font-medium text-brand hover:underline"
        >Siapkan customer dan layanan →</NuxtLink
      ></UiCard
    >
  </section>
</template>
