<script setup lang="ts">
import type { ApiResourceListItem } from '#shared/types/api'
import type { ApiResourceGate, ApiGateVerification } from '#shared/schemas/gateway'
import { apiErrorMessage } from '~/lib/api-error'

const props = defineProps<{ resource: ApiResourceListItem }>()
const emit = defineEmits<{ close: [] }>()
const { data, error, status, refresh } = useFetch<{ data: ApiResourceGate }>(
  `/api/resources/${props.resource.id}/gateway`,
)
const ready = ref(false)
const busy = ref(false)
const failure = ref('')
const message = ref('')
const verification = ref<ApiGateVerification | null>(null)
const preview = computed(() => data.value?.data)

async function save() {
  if (!preview.value || !ready.value) return
  busy.value = true
  failure.value = ''
  verification.value = null
  message.value = ''
  try {
    data.value = await $fetch<{ data: ApiResourceGate }>(
      `/api/resources/${props.resource.id}/gateway`,
      {
        method: 'POST',
        body: { revision: preview.value.revision, middlewareReady: ready.value },
      },
    )
    message.value =
      'Tersimpan di Coolify. Redeploy aplikasi melalui Coolify, lalu klik Periksa gate.'
  } catch (caught) {
    failure.value = apiErrorMessage(caught, 'Gagal menyimpan gate.')
  } finally {
    busy.value = false
  }
}

async function verify() {
  busy.value = true
  failure.value = ''
  message.value = ''
  verification.value = null
  try {
    const response = await $fetch<{ data: ApiGateVerification }>(
      `/api/resources/${props.resource.id}/gateway-verify`,
      { method: 'POST' },
    )
    verification.value = response.data
    await refresh()
  } catch (caught) {
    failure.value = apiErrorMessage(caught, 'Gagal memeriksa gate.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiDialog
    :title="`Billing gate · ${resource.name}`"
    :close-disabled="busy"
    @close="emit('close')"
  >
    <p v-if="preview?.mode !== 'proxy'" class="text-sm leading-6 text-muted">
      BillEngine menambahkan billing-gate@file ke router aplikasi. Pasang file middleware secara
      manual dari petunjuk Settings. Penyimpanan ini membuat pengelolaan label menjadi manual;
      perubahan domain berikutnya perlu disesuaikan di Coolify.
    </p>
    <p v-else class="text-sm leading-6 text-muted">
      Aplikasi Docker Compose didukung melalui gate proxy per server. Buka
      <NuxtLink
        :to="preview.nodeUuid ? `/servers#node-${preview.nodeUuid}` : '/servers'"
        class="font-semibold text-brand underline"
        >Servers → Gate proxy</NuxtLink
      >, simpan konfigurasi entrypoint, lalu restart proxy di Coolify. Setelah itu, periksa gate di
      sini.
    </p>
    <p v-if="status === 'pending'" role="status" class="mt-4 text-sm text-muted">
      Membaca konfigurasi Coolify…
    </p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-danger">
      {{ apiErrorMessage(error, 'Gagal membaca konfigurasi gate.') }}
    </p>
    <div v-if="preview" class="mt-4 space-y-4">
      <UiBadge :tone="preview.verifiedAt ? 'success' : 'warning'">{{
        preview.verifiedAt
          ? 'Pernah terverifikasi'
          : preview.mode === 'proxy'
            ? 'Mode proxy · perlu verifikasi'
            : preview.configured
              ? 'Label tersimpan · perlu verifikasi setelah redeploy'
              : 'Gate belum dipasang'
      }}</UiBadge>
      <p v-if="preview.verifiedAt" class="text-xs text-muted">
        Terakhir terverifikasi: {{ new Date(preview.verifiedAt).toLocaleString('id-ID') }}. Periksa
        lagi untuk mengetahui kondisi saat ini.
      </p>
      <ul class="space-y-1 text-sm">
        <li v-for="url in preview.urls" :key="url" class="break-all">{{ url }}</li>
      </ul>
      <div
        v-for="change in preview.changes"
        :key="change.router"
        class="rounded-md border bg-canvas p-3 text-xs"
      >
        <p class="font-semibold break-all">{{ change.router }}</p>
        <p class="mt-2 break-all text-muted">Sebelum: {{ change.before || '(kosong)' }}</p>
        <p class="mt-1 break-all text-ink">Sesudah: {{ change.after }}</p>
      </div>
      <label
        v-if="!preview.configured && preview.mode !== 'proxy'"
        class="flex items-start gap-2 text-sm"
      >
        <input v-model="ready" type="checkbox" class="mt-1 accent-brand" :disabled="busy" />
        billing-gate.yaml sudah dipasang pada server aplikasi dan URL gate dapat dijangkau dari
        proxy.
      </label>
      <p class="text-xs text-muted">
        Deploy tetap dilakukan di Coolify. Pemeriksaan akan mengirim permintaan khusus ke domain
        aplikasi untuk memastikan proxy mencapai BillEngine.
      </p>
    </div>
    <p v-if="message" role="status" class="mt-4 text-sm text-brand">{{ message }}</p>
    <p v-if="failure" role="alert" class="mt-4 text-sm text-danger">{{ failure }}</p>
    <div v-if="verification" class="mt-4 space-y-2 text-sm" role="status">
      <p :class="verification.reachable ? 'text-brand' : 'text-warning'">
        {{
          verification.reachable
            ? 'Proxy berhasil mencapai gate BillEngine.'
            : 'Gate belum terverifikasi. Lihat hasil pemeriksaan setiap domain di bawah.'
        }}
      </p>
      <p v-if="!verification.enabled" class="text-warning">
        Billing access gateway masih nonaktif di Settings; pembatasan billing belum berlaku.
      </p>
      <div
        v-for="result in verification.results"
        :key="result.url"
        class="rounded-md border p-3 break-all"
      >
        <p>
          {{ result.url }} ·
          {{ result.verified ? `Terverifikasi (${result.state})` : 'Belum terverifikasi'
          }}<span v-if="result.status"> · HTTP {{ result.status }}</span>
        </p>
        <p v-if="result.message" class="mt-1 text-xs leading-5 text-muted">{{ result.message }}</p>
      </div>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <UiButton variant="secondary" :disabled="busy" @click="refresh()">Muat ulang</UiButton>
        <UiButton v-if="preview" :disabled="busy || status === 'pending'" @click="verify">{{
          busy ? 'Memproses…' : 'Periksa gate'
        }}</UiButton>
        <UiButton
          v-if="preview?.mode !== 'proxy' && !preview?.configured"
          :disabled="busy || !preview || !ready || status === 'pending'"
          @click="save"
          >{{ busy ? 'Menyimpan…' : 'Simpan ke Coolify' }}</UiButton
        >
      </div>
    </template>
  </UiDialog>
</template>
