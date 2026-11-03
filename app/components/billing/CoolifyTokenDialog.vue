<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
const props = defineProps<{ serverId: string; serverName: string; baseUrl: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const token = ref('')
const saving = ref(false)
const failure = ref('')
async function save() {
  saving.value = true
  failure.value = ''
  try {
    await $fetch(`/api/resources/servers/${props.serverId}/token`, {
      method: 'PUT',
      body: { apiToken: token.value },
    })
    token.value = ''
    emit('saved')
  } catch (error) {
    failure.value = apiErrorMessage(error, 'Token gagal diperbarui.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiDialog
    :title="`Perbarui token · ${serverName}`"
    :close-disabled="saving"
    @close="emit('close')"
  >
    <p class="mb-4 break-all text-sm text-muted">
      Buat API token pada {{ baseUrl }}. Token harus dapat membaca aplikasi dan server. Tempel token
      tanpa awalan Bearer. Token tersimpan akan dipakai menggantikan token dari env untuk koneksi
      ini.
    </p>
    <form id="coolify-token-form" @submit.prevent="save">
      <UiInput
        v-model="token"
        label="API token baru"
        type="password"
        autocomplete="new-password"
        :disabled="saving"
        required
      />
      <p class="mt-3 text-xs text-muted">
        Token diuji sebelum disimpan terenkripsi. Resource dan hubungan billing tetap dipertahankan.
        Jalankan Sync setelah berhasil.
      </p>
      <p v-if="failure" class="mt-3 text-sm text-danger" role="alert">{{ failure }}</p>
    </form>
    <template #footer
      ><UiButton type="submit" form="coolify-token-form" :disabled="saving || !token.trim()">{{
        saving ? 'Menguji…' : 'Uji & simpan token'
      }}</UiButton></template
    >
  </UiDialog>
</template>
