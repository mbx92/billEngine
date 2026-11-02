<script setup lang="ts">
import { ref } from 'vue'
import UiSelect from '../../app/components/ui/Select.vue'
import UiDialog from '../../app/components/ui/Dialog.vue'

const value = ref<string | null>('')
const changes = ref(0)
const submitted = ref(0)
const dialog = ref(false)
const disabled = ref(false)
const options = ref([
  { value: '', label: 'Pilih customer', disabled: true },
  { value: 'alpha', label: 'Alpha' },
  { value: 'blocked', label: 'Blocked', disabled: true },
  { value: 'beta', label: 'Beta' },
  { value: null, label: 'Tanpa customer' },
])
</script>

<template>
  <main class="p-6">
    <form class="max-w-sm" @submit.prevent="submitted++">
      <label
        >Customer
        <UiSelect
          v-model="value"
          name="customer"
          required
          :options="options"
          :disabled="disabled"
          @change="changes++"
        />
      </label>
      <button type="submit">Simpan</button>
    </form>
    <button @click="dialog = true">Buka dialog</button>
    <button @click="disabled = !disabled">Toggle disabled</button>
    <button @click="options = []">Kosongkan</button>
    <button @click="value = 'alpha'">Set externally</button>
    <output data-testid="value">{{ String(value) }}</output>
    <output data-testid="changes">{{ changes }}</output>
    <output data-testid="submitted">{{ submitted }}</output>
    <UiDialog v-if="dialog" title="Dialog select" @close="dialog = false">
      <div style="height: 180px; overflow: hidden">
        <UiSelect v-model="value" aria-label="Customer dialog" :options="options" autofocus />
        <button>Sesudah select</button>
      </div>
    </UiDialog>
  </main>
</template>
