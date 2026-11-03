<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'

const props = defineProps<{ checkUrl: string }>()
const yaml = ref('')
const busy = ref(false)
const failure = ref('')
const copied = ref(false)
let generation = 0
watch(
  () => props.checkUrl,
  () => {
    generation++
    yaml.value = ''
    failure.value = ''
    copied.value = false
  },
)
onBeforeUnmount(() => {
  generation++
})

async function generate() {
  const current = ++generation
  busy.value = true
  failure.value = ''
  yaml.value = ''
  copied.value = false
  try {
    const result = await $fetch<{ data: { yaml: string } }>('/api/settings/gateway-yaml', {
      method: 'POST',
      body: props.checkUrl ? { checkUrl: props.checkUrl } : {},
    })
    if (current === generation) yaml.value = result.data.yaml
  } catch (error) {
    if (current === generation)
      failure.value = apiErrorMessage(error, 'Gagal membuat YAML gateway.')
  } finally {
    busy.value = false
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(yaml.value)
    copied.value = true
  } catch {
    failure.value = 'Clipboard tidak tersedia. Salin YAML secara manual.'
  }
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs leading-5 text-muted">
      YAML mengambil shared key langsung dari environment server BillEngine dan URL di atas.
      Hasilnya berisi secret; salin hanya ke Coolify → Proxy → Dynamic Configurations. URL harus
      dapat dijangkau proxy tanpa melewati gate itu sendiri.
    </p>
    <div class="flex flex-wrap gap-2">
      <UiButton type="button" variant="secondary" :disabled="busy" @click="generate">{{
        busy ? 'Membuat…' : 'Generate YAML dari env'
      }}</UiButton>
      <UiButton v-if="yaml" type="button" variant="secondary" @click="copy">{{
        copied ? 'Tersalin' : 'Salin YAML'
      }}</UiButton>
      <UiButton v-if="yaml" type="button" variant="secondary" @click="yaml = ''"
        >Sembunyikan</UiButton
      >
    </div>
    <p v-if="failure" role="alert" class="text-xs text-danger">{{ failure }}</p>
    <pre
      v-if="yaml"
      class="overflow-x-auto rounded bg-canvas p-3 text-xs"
    ><code>{{ yaml }}</code></pre>
  </div>
</template>
