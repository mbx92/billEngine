<script setup lang="ts">
import {
  Eye,
  EyeOff,
  Code,
  FileUp,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from '@lucide/vue'
import type {
  ApplicationEnvironmentSnapshot,
  ApplicationEnvironmentSaveResult,
} from '#shared/types/application-environment'
import {
  environmentVariableSchema,
  updateApplicationEnvironmentSchema,
} from '#shared/schemas/application-environment'
import { parseEnvironmentText, serializeEnvironmentText } from '#shared/utils/environment-text'
import { apiErrorMessage } from '~/lib/api-error'

const props = defineProps<{ resourceId: string; revision: number; observedRevision: number }>()
const emit = defineEmits<{ saved: []; activity: [] }>()
interface VariableRow {
  id: number
  key: string
  value: string
  secret: boolean
  managed: boolean
  storedSecret: boolean
  originalKey: string
  replacing: boolean
  visible: boolean
}
const snapshot = ref<ApplicationEnvironmentSnapshot | null>(null)
const rows = ref<VariableRow[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const message = ref('')
const search = ref('')
const baseline = ref('')
const showImport = ref(false)
const importText = ref('')
const importAsSecret = ref(false)
const importError = ref('')
const showDiscard = ref(false)
const editorMode = ref<'form' | 'raw'>('form')
const rawText = ref('')
const rawBaseline = ref('')
const rawError = ref('')
const protectedRows = computed(() => rows.value.filter((row) => row.managed || row.secret))
let nextRowId = 0
let saveAttempt: { body: string; key: string } | null = null
const abort = new AbortController()

function draft() {
  return rows.value
    .filter((row) => !row.managed)
    .map((row) => ({
      key: row.key,
      secret: row.secret,
      ...(row.secret && row.storedSecret && !row.replacing && row.key === row.originalKey
        ? {}
        : { value: row.value }),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
}
const dirty = computed(
  () =>
    Boolean(snapshot.value) &&
    (JSON.stringify(draft()) !== baseline.value ||
      (editorMode.value === 'raw' && rawText.value !== rawBaseline.value)),
)
const stale = computed(() => Boolean(snapshot.value && props.revision > snapshot.value.revision))
const filteredRows = computed(() =>
  rows.value.filter((row) => row.key.toLowerCase().includes(search.value.trim().toLowerCase())),
)
const secretCount = computed(() => rows.value.filter((row) => row.secret).length)

function makeRow(variable: ApplicationEnvironmentSnapshot['variables'][number]): VariableRow {
  return {
    ...variable,
    id: ++nextRowId,
    value: variable.value ?? '',
    originalKey: variable.key,
    storedSecret: variable.secret,
    replacing: false,
    visible: false,
  }
}

function resetRawEditor() {
  rawText.value = serializeEnvironmentText(rows.value.filter((row) => !row.managed && !row.secret))
  rawBaseline.value = rawText.value
  rawError.value = ''
}

function applyRawEditor(): boolean {
  if (rawText.value === rawBaseline.value) return true
  try {
    const parsed = parseEnvironmentText(rawText.value)
    const protectedKeys = new Set(protectedRows.value.map((row) => row.key))
    for (const variable of parsed) {
      if (protectedKeys.has(variable.key)) {
        throw new Error(
          `${variable.key} merupakan secret atau variabel database. Ubah melalui Form KEY/value.`,
        )
      }
    }
    const variables = parsed.map((variable) => ({ ...variable, secret: false }))
    const validation = updateApplicationEnvironmentSchema.safeParse({
      expectedRevision: snapshot.value?.revision,
      variables: [...draft().filter((variable) => variable.secret), ...variables],
    })
    if (!validation.success)
      throw new Error(validation.error.issues[0]?.message ?? 'Periksa format environment.')
    const ordinaryRows = variables.map((variable) => {
      const existing = rows.value.find(
        (row) => row.key === variable.key && !row.managed && !row.secret,
      )
      return existing
        ? { ...existing, value: variable.value }
        : makeRow({ ...variable, managed: false })
    })
    rows.value = [...ordinaryRows, ...protectedRows.value]
    rawBaseline.value = rawText.value
    rawError.value = ''
    return true
  } catch (failure) {
    rawError.value = failure instanceof Error ? failure.message : 'Format environment tidak valid.'
    return false
  }
}

function switchEditor(mode: 'form' | 'raw') {
  if (mode === editorMode.value || saving.value) return
  if (mode === 'form') {
    if (!applyRawEditor()) return
  } else {
    const validation = updateApplicationEnvironmentSchema.safeParse({
      expectedRevision: snapshot.value?.revision,
      variables: draft(),
    })
    if (!validation.success) {
      error.value =
        validation.error.issues[0]?.message ?? 'Lengkapi variabel sebelum membuka editor .env.'
      return
    }
    // Use the same trimmed keys that will be sent to the API.
    rows.value.forEach((row) => {
      row.key = row.key.trim()
    })
    resetRawEditor()
  }
  error.value = ''
  search.value = ''
  editorMode.value = mode
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: ApplicationEnvironmentSnapshot }>(
      `/api/infrastructure/resources/${props.resourceId}/environment`,
      { signal: abort.signal },
    )
    snapshot.value = response.data
    rows.value = response.data.variables.map(makeRow)
    baseline.value = JSON.stringify(draft())
    resetRawEditor()
    saveAttempt = null
    message.value = ''
  } catch (failure) {
    if (!abort.signal.aborted)
      error.value = apiErrorMessage(failure, 'Environment belum dapat dimuat.')
  } finally {
    loading.value = false
  }
}

function addVariable() {
  search.value = ''
  rows.value.push({
    id: ++nextRowId,
    key: '',
    value: '',
    secret: false,
    managed: false,
    storedSecret: false,
    originalKey: '',
    replacing: true,
    visible: false,
  })
}

function cancelReplacement(row: VariableRow) {
  row.key = row.originalKey
  row.value = ''
  row.secret = true
  row.replacing = false
  row.visible = false
}

function importVariables() {
  importError.value = ''
  try {
    const parsed = parseEnvironmentText(importText.value)
    if (!parsed.length) throw new Error('Masukkan minimal satu KEY=value.')
    const locked = new Set(rows.value.filter((row) => row.managed).map((row) => row.key))
    for (const variable of parsed) {
      if (locked.has(variable.key))
        throw new Error(`${variable.key} dikelola melalui tab Database.`)
      const validation = environmentVariableSchema.safeParse({
        ...variable,
        secret:
          importAsSecret.value || rows.value.some((row) => row.key === variable.key && row.secret),
      })
      if (!validation.success)
        throw new Error(`${variable.key}: ${validation.error.issues[0]?.message}`)
    }
    const keys = new Set([
      ...rows.value.filter((row) => !row.managed).map((row) => row.key),
      ...parsed.map((variable) => variable.key),
    ])
    if (keys.size > 200) throw new Error('Maksimal 200 variable yang dapat diedit.')
    for (const variable of parsed) {
      const existing = rows.value.find((row) => row.key === variable.key)
      if (existing)
        Object.assign(existing, variable, {
          secret: importAsSecret.value || existing.secret,
          replacing: true,
          visible: false,
        })
      else
        rows.value.push({
          ...variable,
          id: ++nextRowId,
          secret: importAsSecret.value,
          managed: false,
          storedSecret: false,
          originalKey: '',
          replacing: true,
          visible: false,
        })
    }
    search.value = ''
    closeImport()
  } catch (failure) {
    importError.value =
      failure instanceof Error ? failure.message : 'Format environment tidak valid.'
  }
}

function closeImport() {
  showImport.value = false
  importText.value = ''
  importError.value = ''
}

async function save() {
  if (!snapshot.value || saving.value || stale.value) return
  if (editorMode.value === 'raw' && !applyRawEditor()) return
  error.value = ''
  message.value = ''
  if (!dirty.value) {
    message.value = 'Tidak ada perubahan nilai environment untuk diterapkan.'
    return
  }
  const parsed = updateApplicationEnvironmentSchema.safeParse({
    expectedRevision: snapshot.value.revision,
    variables: draft(),
  })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Periksa nama dan nilai environment.'
    return
  }
  const body = JSON.stringify(parsed.data)
  if (saveAttempt?.body !== body) saveAttempt = { body, key: `environment:${crypto.randomUUID()}` }
  saving.value = true
  try {
    const response = await $fetch<{ data: ApplicationEnvironmentSaveResult }>(
      `/api/infrastructure/resources/${props.resourceId}/environment`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': saveAttempt.key },
        body: parsed.data,
      },
    )
    snapshot.value = {
      ...snapshot.value,
      revision: response.data.revision,
      variables: rows.value.map((row) => ({
        key: row.key.trim(),
        secret: row.secret,
        managed: row.managed,
        ...(row.secret ? {} : { value: row.value }),
      })),
    }
    // Do not retain newly entered plaintext secrets after a successful save.
    rows.value = snapshot.value.variables.map(makeRow)
    baseline.value = JSON.stringify(draft())
    resetRawEditor()
    saveAttempt = null
    message.value = `Environment tersimpan. Redeploy masuk antrean (${response.data.operation.id.slice(0, 8)}).`
    emit('saved')
  } catch (failure) {
    error.value = apiErrorMessage(
      failure,
      'Environment gagal disimpan. Perubahan Anda masih tersedia di editor.',
    )
  } finally {
    saving.value = false
  }
}

function reload() {
  if (dirty.value) showDiscard.value = true
  else void load()
}

function discardAndReload() {
  showDiscard.value = false
  void load()
}

function canLeave() {
  if (saving.value) return false
  return (
    !(dirty.value || importText.value) ||
    window.confirm('Perubahan environment belum disimpan. Tinggalkan halaman?')
  )
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate((to, from) => {
  if (
    to.query.tab !== from.query.tab ||
    to.query.deployment !== from.query.deployment ||
    to.params.id !== from.params.id
  )
    return canLeave()
})
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || saving.value || importText.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => {
  void load()
  window.addEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => {
  abort.abort()
  window.removeEventListener('beforeunload', onBeforeUnload)
  rows.value = []
  importText.value = ''
  rawText.value = ''
  rawBaseline.value = ''
  saveAttempt = null
})
</script>

<template>
  <section class="min-w-0 space-y-4" aria-labelledby="environment-heading">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="environment-heading" class="flex items-center gap-2 text-base font-semibold">
          <KeyRound :size="18" class="text-brand" aria-hidden="true" /> Environment
        </h2>
        <p class="mt-1 max-w-xl text-sm leading-6 text-muted">
          Atur variable runtime untuk deployment ini. Perubahan diterapkan setelah redeploy
          berhasil.
        </p>
      </div>
      <UiButton variant="secondary" size="sm" :disabled="loading || saving" @click="reload"
        ><RotateCcw :size="14" aria-hidden="true" /> Muat ulang</UiButton
      >
    </header>

    <p
      v-if="error"
      role="alert"
      class="rounded-md border border-danger/25 bg-danger/5 p-3 text-sm text-danger"
    >
      {{ error }}
    </p>
    <div
      v-if="message"
      role="status"
      class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/25 bg-success/5 p-3 text-sm text-success"
    >
      <span>{{ message }}</span
      ><UiButton size="sm" variant="ghost" @click="emit('activity')">Lihat aktivitas</UiButton>
    </div>
    <p
      v-if="stale"
      role="alert"
      class="rounded-md border border-warning/25 bg-warning/5 p-3 text-sm text-warning"
    >
      Konfigurasi telah berubah di tempat lain. Salin perubahan yang diperlukan, lalu muat ulang
      sebelum menyimpan.
    </p>

    <UiSkeleton v-if="loading" height="16rem" />
    <template v-else-if="snapshot">
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
        <UiBadge>{{ rows.length }} variable</UiBadge><UiBadge>{{ secretCount }} secret</UiBadge>
        <UiBadge v-if="dirty" tone="warning">Belum disimpan</UiBadge>
        <UiBadge v-else-if="observedRevision !== snapshot.revision" tone="warning"
          >Menunggu penerapan</UiBadge
        >
        <span>{{ snapshot.name }} · revisi {{ snapshot.revision }}</span>
      </div>
      <p
        v-if="snapshot.secretDelivery === 'files'"
        class="rounded-md border bg-surface-raised p-3 text-xs leading-5 text-muted"
      >
        Deployment ini memakai secret file: secret KEY diteruskan sebagai KEY_FILE berisi lokasi
        file. Variable biasa tetap memakai KEY=value.
      </p>

      <form class="space-y-4" @submit.prevent="save">
        <fieldset :disabled="saving" class="min-w-0 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Mode editor environment"
              class="inline-flex gap-1 rounded-lg border bg-surface-raised p-1"
            >
              <button
                type="button"
                :aria-pressed="editorMode === 'form'"
                class="focus-ring inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
                :class="
                  editorMode === 'form'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                "
                @click="switchEditor('form')"
              >
                <KeyRound :size="15" aria-hidden="true" /> Form KEY/value
              </button>
              <button
                type="button"
                :aria-pressed="editorMode === 'raw'"
                class="focus-ring inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
                :class="
                  editorMode === 'raw'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                "
                @click="switchEditor('raw')"
              >
                <Code :size="15" aria-hidden="true" /> Editor .env
              </button>
            </div>
            <span class="text-xs text-muted">Draft diterapkan setelah Simpan &amp; redeploy</span>
          </div>

          <div v-if="editorMode === 'raw'" class="space-y-3">
            <p id="environment-raw-help" class="text-xs leading-5 text-muted">
              Edit atau tempel KEY=value, satu variabel per baris. Menghapus baris akan menghapus
              variabel biasa tersebut. Secret dan variabel database tetap dipertahankan; ubah
              melalui form. Nilai ${VARIABLE} disimpan tanpa substitusi.
            </p>
            <div class="overflow-hidden rounded-lg border bg-canvas focus-within:border-brand">
              <div
                class="flex items-center justify-between gap-3 border-b bg-surface-raised px-4 py-2.5 text-xs text-muted"
              >
                <span class="inline-flex items-center gap-2 font-mono"
                  ><Code :size="14" aria-hidden="true" /> .env</span
                >
                <span>{{ rawText ? rawText.split('\n').length : 0 }} baris</span>
              </div>
              <textarea
                v-model="rawText"
                aria-label="Editor .env"
                aria-describedby="environment-raw-help"
                :aria-invalid="Boolean(rawError)"
                :aria-errormessage="rawError ? 'environment-raw-error' : undefined"
                rows="18"
                autocomplete="off"
                autocapitalize="off"
                :spellcheck="false"
                wrap="off"
                class="focus-ring block min-h-80 w-full resize-y border-0 bg-canvas p-4 font-mono text-sm leading-7 text-ink"
                placeholder="NODE_ENV=production&#10;APP_URL=https://app.example.com"
                @input="rawError = ''"
              />
            </div>
            <p v-if="rawError" id="environment-raw-error" role="alert" class="text-sm text-danger">
              {{ rawError }}
            </p>
            <div v-if="protectedRows.length" class="rounded-md border bg-surface p-3">
              <p class="mb-2 flex items-center gap-2 text-xs text-muted">
                <LockKeyhole :size="14" aria-hidden="true" /> Tetap dipertahankan (kelola melalui
                form)
              </p>
              <div class="flex flex-wrap gap-2">
                <UiBadge v-for="row in protectedRows" :key="row.id"
                  >{{ row.key }} · {{ row.managed ? 'Database' : 'Secret' }}</UiBadge
                >
              </div>
            </div>
          </div>

          <div v-if="editorMode === 'form'" class="flex flex-wrap items-center gap-2">
            <label class="relative min-w-0 flex-1">
              <Search
                :size="15"
                class="pointer-events-none absolute top-3 left-3 text-muted"
                aria-hidden="true"
              />
              <input
                v-model="search"
                type="search"
                aria-label="Cari nama environment variable"
                placeholder="Cari variable..."
                class="focus-ring h-10 w-full rounded-md border bg-surface pr-3 pl-9 text-sm"
              />
            </label>
            <UiButton
              variant="secondary"
              :disabled="rows.filter((row) => !row.managed).length >= 200"
              @click="addVariable"
              ><Plus :size="15" aria-hidden="true" /> Tambah</UiButton
            >
            <UiButton variant="secondary" @click="showImport = true"
              ><FileUp :size="15" aria-hidden="true" /> Impor .env</UiButton
            >
          </div>

          <div v-if="editorMode === 'form'" class="overflow-hidden rounded-md border bg-surface">
            <div
              v-for="row in filteredRows"
              :key="row.id"
              class="space-y-3 border-b p-4 last:border-b-0"
            >
              <div class="flex flex-wrap items-center gap-2">
                <UiBadge v-if="row.managed"
                  ><LockKeyhole :size="12" aria-hidden="true" /> Database terkelola</UiBadge
                >
                <UiBadge v-else-if="row.secret"
                  ><LockKeyhole :size="12" aria-hidden="true" /> Secret</UiBadge
                >
                <UiBadge v-else>Variable</UiBadge>
                <button
                  v-if="!row.managed"
                  type="button"
                  class="focus-ring ml-auto rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                  :aria-label="`Hapus ${row.key || 'variable baru'}`"
                  @click="rows = rows.filter((item) => item.id !== row.id)"
                >
                  <Trash2 :size="15" aria-hidden="true" />
                </button>
              </div>
              <div class="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <UiInput
                  v-model="row.key"
                  label="Nama"
                  placeholder="APP_URL"
                  autocomplete="off"
                  autocapitalize="characters"
                  :spellcheck="false"
                  :readonly="row.managed || (row.storedSecret && !row.replacing)"
                  maxlength="255"
                  required
                />
                <div class="min-w-0">
                  <template v-if="row.managed || (row.storedSecret && !row.replacing)">
                    <span class="mb-2 block text-xs font-medium">Nilai</span>
                    <div
                      class="flex h-10 min-w-0 items-center gap-2 rounded-md border bg-surface-raised px-3"
                    >
                      <span class="min-w-0 flex-1 truncate text-sm text-muted">{{
                        row.managed ? 'Dikelola otomatis' : 'Tersimpan terenkripsi'
                      }}</span>
                      <button
                        v-if="!row.managed"
                        type="button"
                        class="focus-ring inline-flex shrink-0 items-center gap-1 rounded text-xs text-brand"
                        :aria-label="`Ganti nilai ${row.key}`"
                        @click="row.replacing = true"
                      >
                        <Pencil :size="13" aria-hidden="true" /> Ganti
                      </button>
                    </div>
                  </template>
                  <template v-else>
                    <div class="relative">
                      <UiInput
                        v-if="row.secret"
                        v-model="row.value"
                        label="Nilai baru"
                        :type="row.visible ? 'text' : 'password'"
                        autocomplete="new-password"
                        :spellcheck="false"
                        class="pr-10"
                        maxlength="16384"
                        required
                      />
                      <label v-else class="block">
                        <span class="mb-2 block text-xs font-medium">Nilai</span>
                        <textarea
                          v-model="row.value"
                          rows="1"
                          maxlength="16384"
                          autocomplete="off"
                          :spellcheck="false"
                          class="focus-ring min-h-10 w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm"
                          placeholder="value"
                        />
                      </label>
                      <button
                        v-if="row.secret"
                        type="button"
                        class="focus-ring absolute right-2 bottom-2 rounded p-1 text-muted"
                        :aria-label="
                          row.visible ? `Sembunyikan ${row.key}` : `Tampilkan ${row.key}`
                        "
                        @click="row.visible = !row.visible"
                      >
                        <EyeOff v-if="row.visible" :size="16" aria-hidden="true" /><Eye
                          v-else
                          :size="16"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </template>
                </div>
              </div>
              <div v-if="!row.managed" class="flex flex-wrap items-center justify-between gap-2">
                <label class="flex items-center gap-2 text-xs text-muted"
                  ><input
                    v-model="row.secret"
                    type="checkbox"
                    :disabled="row.storedSecret && !row.replacing"
                    class="size-4 accent-brand"
                  />
                  Simpan sebagai secret terenkripsi</label
                >
                <button
                  v-if="row.storedSecret && row.replacing"
                  type="button"
                  class="focus-ring inline-flex items-center gap-1 rounded text-xs text-muted hover:text-ink"
                  @click="cancelReplacement(row)"
                >
                  <X :size="13" aria-hidden="true" /> Pertahankan secret lama
                </button>
              </div>
            </div>
            <UiEmptyState
              v-if="!rows.length"
              title="Belum ada environment variable"
              description="Tambahkan variable atau impor isi .env untuk deployment ini."
            />
            <p
              v-else-if="!filteredRows.length"
              role="status"
              class="p-8 text-center text-sm text-muted"
            >
              Tidak ada nama variable yang cocok.
            </p>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p class="max-w-md text-xs leading-5 text-muted">
              Password dan token sebaiknya ditandai sebagai secret. Pengaturan ini berlaku saat
              container berjalan, bukan saat build image.
            </p>
            <UiButton type="submit" :disabled="saving || !dirty || stale"
              ><Save :size="15" aria-hidden="true" />
              {{ saving ? 'Menyimpan...' : 'Simpan & redeploy' }}</UiButton
            >
          </div>
        </fieldset>
      </form>
    </template>

    <UiDialog
      v-if="showImport"
      title="Impor environment"
      description="Tempel KEY=value, satu variable per baris. Nama yang sama akan mengganti nilai di editor; variable lain tetap dipertahankan."
      size="lg"
      @close="closeImport"
    >
      <form id="environment-import" class="space-y-4" @submit.prevent="importVariables">
        <label class="block"
          ><span class="mb-2 block text-xs font-medium">Isi .env</span
          ><textarea
            v-model="importText"
            rows="9"
            autofocus
            autocomplete="off"
            :spellcheck="false"
            class="focus-ring w-full rounded-md border bg-canvas p-3 font-mono text-sm"
            placeholder="APP_URL=https://app.example.com&#10;NODE_ENV=production"
            required
          />
        </label>
        <label class="flex items-center gap-2 text-sm"
          ><input v-model="importAsSecret" type="checkbox" class="size-4 accent-brand" /> Simpan
          semua variable impor sebagai secret</label
        >
        <p class="text-xs leading-5 text-muted">
          Baris komentar dan prefix export didukung. Nilai ${VARIABLE} disimpan apa adanya tanpa
          substitusi. Impor hanya mengubah draft sampai Anda memilih Simpan &amp; redeploy.
        </p>
        <p v-if="importError" role="alert" class="text-sm text-danger">{{ importError }}</p>
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" @click="closeImport">Batal</UiButton
          ><UiButton type="submit" form="environment-import">Terapkan ke editor</UiButton>
        </div></template
      >
    </UiDialog>
    <UiConfirmDialog
      v-if="showDiscard"
      title="Buang perubahan environment?"
      description="Draft yang belum disimpan akan diganti dengan konfigurasi terbaru."
      confirm-label="Buang & muat ulang"
      destructive
      @cancel="showDiscard = false"
      @confirm="discardAndReload"
    />
  </section>
</template>
