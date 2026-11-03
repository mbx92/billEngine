<script setup lang="ts">
import type { ApiGatewaySettings } from '#shared/schemas/gateway'
import { apiErrorMessage } from '~/lib/api-error'

const { data, error, refresh } = useFetch<{ data: ApiGatewaySettings }>('/api/settings/gateway')
const checkUrl = ref('')
const saving = ref(false)
const message = ref('')
const failure = ref('')
watch(
  () => data.value,
  (value) => {
    if (value) checkUrl.value = value.data.checkUrl
  },
  { immediate: true },
)

async function save() {
  saving.value = true
  failure.value = ''
  message.value = ''
  try {
    data.value = await $fetch<{ data: ApiGatewaySettings }>('/api/settings/gateway', {
      method: 'PUT',
      body: { checkUrl: checkUrl.value },
    })
    message.value = 'URL tersimpan. Salin konfigurasi terbaru ke proxy Coolify secara manual.'
  } catch (caught) {
    failure.value = apiErrorMessage(caught, 'Gagal menyimpan URL gateway.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiCard class="mt-6">
    <h2 class="text-base font-semibold">Koneksi proxy billing gateway</h2>
    <p class="mt-2 text-sm text-muted">
      Pasang billing-gate.yaml sekali pada setiap server Coolify. Gunakan Servers → Gate proxy untuk
      gate per server termasuk Docker Compose, atau Resources → Konfigurasi gate untuk label per
      aplikasi non-Compose.
    </p>
    <p v-if="error" role="alert" class="mt-3 text-sm text-danger">
      {{ apiErrorMessage(error, 'Gagal memuat konfigurasi gateway.') }}
      <button type="button" class="underline" @click="refresh()">Coba lagi</button>
    </p>
    <form v-if="data" class="mt-4 space-y-4" @submit.prevent="save">
      <UiInput
        v-model="checkUrl"
        label="URL pemeriksaan gate dari proxy"
        type="url"
        required
        placeholder="https://billing.example.com/api/billing-gate/check"
        hint="Harus dapat dijangkau dari proxy Coolify. localhost di proxy tidak menunjuk komputer BillEngine."
      />
      <p v-if="!data.data.secretsConfigured" role="alert" class="text-sm text-warning">
        Atur NUXT_BILLING_GATE_SECRET dan NUXT_BILLING_GATE_SHARED_KEY pada deployment BillEngine
        sebelum memasang gate.
      </p>
      <UiButton type="submit" :disabled="saving">{{
        saving ? 'Menyimpan…' : 'Simpan URL gateway'
      }}</UiButton>
    </form>
    <p v-if="message" role="status" class="mt-3 text-sm text-brand">{{ message }}</p>
    <p v-if="failure" role="alert" class="mt-3 text-sm text-danger">{{ failure }}</p>
    <details v-if="data" class="mt-4 rounded-md border p-3">
      <summary class="cursor-pointer text-sm font-semibold">
        Konfigurasi manual billing-gate.yaml
      </summary>
      <p class="my-3 text-xs leading-5 text-muted">
        Di Coolify: Servers → server aplikasi → Proxy → Dynamic Configurations. Buat
        billing-gate.yaml dengan hasil generator berikut. Shared key diisi otomatis dari environment
        server. Simpan perubahan URL sebelum menyalin YAML.
      </p>
      <GatewayYamlTemplate :check-url="data.data.checkUrl" />
    </details>
  </UiCard>
</template>
