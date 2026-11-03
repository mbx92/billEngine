<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
const props = defineProps<{
  serverId: string
  serverName: string
  baseUrl: string
  resourceCount: number
}>()
const emit = defineEmits<{ close: []; deleted: [] }>()
const busy = ref(false)
const failure = ref('')
async function remove() {
  busy.value = true
  failure.value = ''
  try {
    await $fetch(`/api/resources/servers/${props.serverId}`, { method: 'DELETE' })
    emit('deleted')
  } catch (error) {
    failure.value = apiErrorMessage(error, 'Gagal menghapus koneksi server.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiDialog :title="`Hapus koneksi · ${serverName}`" :close-disabled="busy" @close="emit('close')">
    <p class="break-all text-sm font-semibold">{{ baseUrl }}</p>
    <p class="mt-3 text-sm text-muted">
      Koneksi, token tersimpan, serta inventori {{ resourceCount }} resource akan dihapus dari
      BillEngine. Server, aplikasi, dan konfigurasi gate di Coolify tetap berjalan.
    </p>
    <p class="mt-3 text-sm text-muted">
      Penghapusan ditolak jika resource masih terhubung ke layanan billing atau data lain. Koneksi
      dapat ditambahkan kembali kemudian.
    </p>
    <p v-if="failure" class="mt-3 text-sm text-danger" role="alert">{{ failure }}</p>
    <template #footer>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="busy" @click="emit('close')">Batal</UiButton>
        <UiButton variant="danger" :disabled="busy" @click="remove">{{
          busy ? 'Menghapus…' : 'Hapus koneksi'
        }}</UiButton>
      </div>
    </template>
  </UiDialog>
</template>
