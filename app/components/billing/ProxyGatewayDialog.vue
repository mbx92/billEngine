<script setup lang="ts">
import type { ApiProxyGateway, ApiProxyGatewayPlan } from '#shared/schemas/gateway'
import { gatewayMiddlewareYaml } from '#shared/utils/gateway-yaml'
import { apiErrorMessage } from '~/lib/api-error'

const props = defineProps<{ nodeId: string; nodeName: string }>()
const emit = defineEmits<{ close: [] }>()
const endpoint = `/api/resources/nodes/${props.nodeId}/gateway` as const
const { data, error, status, refresh } = useFetch<{ data: ApiProxyGateway }>(endpoint)
const selected = ref<string[]>([])
const checkUrl = ref('')
const middlewareReady = ref(false)
const internalRouteConfirmed = ref(false)
const preview = ref<ApiProxyGatewayPlan | null>(null)
const busy = ref(false)
const message = ref('')
const failure = ref('')
const yaml = computed(() => gatewayMiddlewareYaml(checkUrl.value))

watch(
  () => data.value,
  (response) => {
    if (!response) return
    selected.value = [...response.data.selected]
    checkUrl.value = response.data.checkUrl
  },
  { immediate: true },
)
watch(
  [checkUrl, selected],
  () => {
    preview.value = null
    middlewareReady.value = false
    internalRouteConfirmed.value = false
    message.value = ''
  },
  { deep: true },
)

async function showPreview() {
  busy.value = true
  failure.value = ''
  message.value = ''
  preview.value = null
  try {
    preview.value = (
      await $fetch<{ data: ApiProxyGatewayPlan }>(
        `/api/resources/nodes/${props.nodeId}/gateway-preview`,
        {
          method: 'POST',
          body: { checkUrl: checkUrl.value, entrypoints: selected.value },
        },
      )
    ).data
  } catch (caught) {
    failure.value = apiErrorMessage(caught, 'Gagal menyiapkan pratinjau proxy.')
  } finally {
    busy.value = false
  }
}

async function reload() {
  preview.value = null
  failure.value = ''
  message.value = ''
  await refresh()
}

async function save() {
  if (!preview.value) return
  busy.value = true
  failure.value = ''
  message.value = ''
  try {
    const response = await $fetch<{ data: { message: string } }>(endpoint, {
      method: 'POST',
      body: {
        checkUrl: checkUrl.value,
        entrypoints: selected.value,
        revision: preview.value.revision,
        middlewareReady: middlewareReady.value,
        internalRouteConfirmed: internalRouteConfirmed.value,
      },
    })
    preview.value = null
    await refresh()
    message.value = response.data.message
  } catch (caught) {
    failure.value = apiErrorMessage(caught, 'Gagal menyimpan konfigurasi proxy.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiDialog
    :title="`Gate proxy · ${nodeName}`"
    size="xl"
    :close-disabled="busy"
    @close="emit('close')"
  >
    <p class="text-sm leading-6 text-muted">
      Gate ini berlaku untuk seluruh router HTTP pada entrypoint yang dipilih, termasuk Docker
      Compose. BillEngine menerapkan aturan billing pada domain yang terhubung ke service billable.
      Simpan konfigurasi di sini, lalu restart proxy melalui Coolify.
    </p>
    <p class="mt-3 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
      Jika BillEngine tidak dapat dijangkau, semua aplikasi pada entrypoint ini bisa ikut tidak
      dapat diakses. URL pemeriksaan harus langsung ke BillEngine, tanpa melewati proxy yang
      dipasangi gate.
    </p>
    <p v-if="status === 'pending'" role="status" class="mt-4 text-sm text-muted">
      Membaca konfigurasi proxy…
    </p>
    <p v-if="error" role="alert" class="mt-4 text-sm text-danger">
      {{ apiErrorMessage(error, 'Gagal membaca konfigurasi proxy.') }}
    </p>
    <div v-if="data" class="mt-4 space-y-4">
      <p v-if="data.data.savedAt" class="text-xs text-muted">
        Konfigurasi terakhir disimpan {{ new Date(data.data.savedAt).toLocaleString('id-ID') }}.
        Status tersimpan belum membuktikan proxy sudah direstart.
      </p>
      <UiInput
        v-model="checkUrl"
        :disabled="busy"
        type="url"
        label="URL internal gate pada file middleware"
        placeholder="http://host.docker.internal:8010/api/billing-gate/check"
        hint="Gunakan port langsung BillEngine. Pemeriksaan alamat tidak menggantikan pengecekan konektivitas dari container proxy."
      />
      <fieldset :disabled="busy" class="space-y-2">
        <legend class="mb-2 text-sm font-semibold">Entrypoint aplikasi</legend>
        <label
          v-for="entrypoint in data.data.entrypoints"
          :key="entrypoint.name"
          class="flex items-start gap-3 rounded-md border p-3 text-sm"
        >
          <input
            v-model="selected"
            type="checkbox"
            :value="entrypoint.name"
            class="mt-1 accent-brand"
          />
          <span
            ><span class="font-semibold">{{ entrypoint.name }}</span> · {{ entrypoint.address
            }}<span class="mt-1 block break-all text-xs text-muted"
              >Middleware saat ini: {{ entrypoint.middlewares || '(kosong)' }}</span
            ></span
          >
        </label>
      </fieldset>
      <p class="text-xs text-muted">
        Kosongkan semua pilihan untuk melepas gate dari entrypoint. Middleware lain tetap
        dipertahankan; label gate yang pernah dipasang per aplikasi tidak ikut dihapus.
      </p>
      <details v-if="selected.length" class="rounded-md border p-3">
        <summary class="cursor-pointer text-sm font-semibold">
          billing-gate.yaml untuk node ini
        </summary>
        <p class="my-3 text-xs text-muted">
          Pasang manual di Coolify → server ini → Proxy → Dynamic Configurations. Ganti placeholder
          shared key dengan nilai NUXT_BILLING_GATE_SHARED_KEY pada deployment BillEngine.
          Pengaturan URL di dialog ini tidak mengubah file middleware otomatis.
        </p>
        <pre class="overflow-x-auto rounded bg-canvas p-3 text-xs"><code>{{ yaml }}</code></pre>
      </details>
      <div v-if="preview" class="space-y-3">
        <p class="text-sm font-semibold">
          {{ preview.changed ? 'Pratinjau perubahan' : 'Konfigurasi entrypoint sudah sesuai' }}
        </p>
        <div
          v-for="change in preview.changes"
          :key="change.entrypoint"
          class="rounded-md border bg-canvas p-3 text-xs"
        >
          <p class="font-semibold">{{ change.entrypoint }}</p>
          <p class="mt-2 break-all text-muted">Sebelum: {{ change.before || '(kosong)' }}</p>
          <p class="mt-1 break-all">Sesudah: {{ change.after || '(kosong)' }}</p>
        </div>
        <div v-if="preview.healthcheck" class="rounded-md border bg-canvas p-3 text-xs">
          <p class="font-semibold">Pisahkan healthcheck proxy dari billing gate</p>
          <p class="mt-2">
            Ping dipindahkan ke listener internal {{ preview.healthcheck.address }} tanpa port
            publik baru.
          </p>
          <p class="mt-2 break-all text-muted">Sebelum: {{ preview.healthcheck.before }}</p>
          <p class="mt-1 break-all">Sesudah: {{ preview.healthcheck.after }}</p>
        </div>
        <label class="flex items-start gap-2 text-sm"
          ><input
            v-model="middlewareReady"
            type="checkbox"
            class="mt-1 accent-brand"
            :disabled="busy"
          />{{
            selected.length
              ? 'billing-gate.yaml sudah dipasang pada node ini dengan URL internal di atas.'
              : 'Saya akan restart proxy di Coolify untuk menerapkan pelepasan gate.'
          }}</label
        >
        <label class="flex items-start gap-2 text-sm"
          ><input
            v-model="internalRouteConfirmed"
            type="checkbox"
            class="mt-1 accent-brand"
            :disabled="busy"
          />{{
            selected.length
              ? 'Alamat gate dapat dijangkau dari container proxy dan tidak melewati entrypoint yang dipilih.'
              : 'Saya memahami bahwa label gate per aplikasi tetap berlaku jika masih terpasang.'
          }}</label
        >
      </div>
    </div>
    <p v-if="failure" role="alert" class="mt-4 text-sm text-danger">{{ failure }}</p>
    <p v-if="message" role="status" class="mt-4 text-sm text-brand">{{ message }}</p>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <UiButton variant="secondary" :disabled="busy" @click="reload">Muat ulang</UiButton>
        <UiButton
          variant="secondary"
          :disabled="busy || !data || status === 'pending'"
          @click="showPreview"
          >Pratinjau</UiButton
        >
        <UiButton
          :disabled="
            busy || !preview || !middlewareReady || !internalRouteConfirmed || status === 'pending'
          "
          @click="save"
          >{{ busy ? 'Memproses…' : 'Simpan konfigurasi proxy' }}</UiButton
        >
      </div>
    </template>
  </UiDialog>
</template>
