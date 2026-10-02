<script setup lang="ts">
import { Database, Pencil, Plus, RefreshCw, TestTube2 } from '@lucide/vue'
import type { ApiDatabaseCluster, ApiDatabaseClusterOverview } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Database Clusters · Billing Infra' })

const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<{
  data: ApiDatabaseClusterOverview
}>('/api/database-clusters')
const overview = computed(() => response.value?.data)
const showForm = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const testingId = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
const form = reactive({
  coolifyServerId: '',
  name: '',
  host: '',
  port: '5432',
  adminDatabase: 'postgres',
  provisionerUsername: 'billengine_provisioner',
  password: '',
  sslMode: 'prefer' as ApiDatabaseCluster['sslMode'],
  defaultConnectionLimit: '20',
  isActive: true,
})

function resetForm() {
  editingId.value = null
  Object.assign(form, {
    coolifyServerId: overview.value?.servers.find((server) => server.isActive)?.id ?? '',
    name: '',
    host: '',
    port: '5432',
    adminDatabase: 'postgres',
    provisionerUsername: 'billengine_provisioner',
    password: '',
    sslMode: 'prefer',
    defaultConnectionLimit: '20',
    isActive: true,
  })
  actionError.value = null
}

function openCreate() {
  resetForm()
  showForm.value = true
}

function openEdit(cluster: ApiDatabaseCluster) {
  editingId.value = cluster.id
  Object.assign(form, {
    coolifyServerId: cluster.coolifyServerId,
    name: cluster.name,
    host: cluster.host,
    port: String(cluster.port),
    adminDatabase: cluster.adminDatabase,
    provisionerUsername: cluster.provisionerUsername,
    password: '',
    sslMode: cluster.sslMode,
    defaultConnectionLimit: String(cluster.defaultConnectionLimit),
    isActive: cluster.isActive,
  })
  actionError.value = null
  showForm.value = true
}

async function saveCluster() {
  saving.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    const body = {
      ...form,
      password: form.password || undefined,
      port: Number(form.port),
      defaultConnectionLimit: Number(form.defaultConnectionLimit),
    }
    if (editingId.value) {
      await $fetch(`/api/database-clusters/${editingId.value}`, { method: 'PATCH', body })
      actionMessage.value = `Cluster ${form.name} berhasil diperbarui.`
    } else {
      await $fetch('/api/database-clusters', { method: 'POST', body })
      actionMessage.value = `Cluster ${form.name} tersimpan dan koneksi berhasil diuji.`
    }
    showForm.value = false
    resetForm()
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Cluster database gagal disimpan.')
  } finally {
    saving.value = false
  }
}

async function testCluster(cluster: ApiDatabaseCluster) {
  testingId.value = cluster.id
  actionError.value = null
  actionMessage.value = null
  try {
    const response = await $fetch<{
      data: { connected: boolean; database: string; user: string; databaseCount: number }
    }>(`/api/database-clusters/${cluster.id}/test`, { method: 'POST' })
    actionMessage.value = `Koneksi ${cluster.name} berhasil ke ${response.data.database} sebagai ${response.data.user}; ${response.data.databaseCount} database terlihat.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Test koneksi PostgreSQL gagal.')
  } finally {
    testingId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / PostgreSQL
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Database Clusters</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Kelola cluster PostgreSQL shared. Password provisioner dienkripsi dan tidak pernah
          dikembalikan oleh API.
        </p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" /> Refresh
        </UiButton>
        <UiButton @click="openCreate"><Plus :size="15" /> Tambah cluster</UiButton>
      </div>
    </header>

    <p
      v-if="actionMessage"
      class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
    >
      {{ actionMessage }}
    </p>
    <p
      v-if="actionError && !showForm"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {{ actionError }}
    </p>

    <UiDialog
      v-if="showForm"
      :title="editingId ? 'Edit database cluster' : 'Tambah database cluster'"
      description="BillEngine harus dapat menjangkau host PostgreSQL dari network tempat aplikasi ini berjalan."
      size="lg"
      :close-disabled="saving"
      @close="showForm = false"
    >
      <form id="cluster-form" class="grid gap-4 md:grid-cols-2" @submit.prevent="saveCluster">
        <p
          v-if="actionError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger md:col-span-2"
        >
          {{ actionError }}
        </p>
        <UiInput
          v-model="form.name"
          label="Nama cluster"
          placeholder="customer-postgres-shared"
          required
        />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Koneksi Coolify</span>
          <select
            v-model="form.coolifyServerId"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            required
          >
            <option value="" disabled>Pilih koneksi</option>
            <option v-for="server in overview?.servers" :key="server.id" :value="server.id">
              {{ server.name }}
            </option>
          </select>
        </label>
        <UiInput
          v-model="form.host"
          label="Host PostgreSQL"
          placeholder="customer-postgres-shared"
          required
        />
        <UiInput v-model="form.port" label="Port" type="number" min="1" max="65535" required />
        <UiInput v-model="form.adminDatabase" label="Admin database" required />
        <UiInput
          v-model="form.provisionerUsername"
          label="Provisioner username"
          autocomplete="off"
          required
        />
        <UiInput
          v-model="form.password"
          :label="editingId ? 'Password baru (kosong = tidak berubah)' : 'Password provisioner'"
          type="password"
          autocomplete="new-password"
          :required="!editingId"
        />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">SSL mode</span>
          <select
            v-model="form.sslMode"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="disable">Disable</option>
            <option value="prefer">Prefer / internal network</option>
            <option value="require">Require TLS</option>
          </select>
        </label>
        <UiInput
          v-model="form.defaultConnectionLimit"
          label="Connection limit per service"
          type="number"
          min="1"
          max="10000"
          required
        />
        <label class="flex items-center gap-3 self-end pb-2 text-sm text-ink">
          <input v-model="form.isActive" type="checkbox" class="size-4 accent-brand" /> Cluster
          aktif
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="showForm = false"
            >Batal</UiButton
          >
          <UiButton type="submit" form="cluster-form" :disabled="saving">
            {{ saving ? 'Menguji dan menyimpan…' : 'Simpan cluster' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <div v-if="status === 'pending' && !overview" class="grid gap-4 md:grid-cols-2">
      <UiSkeleton v-for="item in 2" :key="item" height="12rem" />
    </div>
    <UiEmptyState
      v-else-if="error"
      title="Gagal memuat cluster"
      description="Periksa database BillEngine dan muat ulang halaman."
    />
    <UiEmptyState
      v-else-if="!overview?.clusters.length"
      title="Belum ada cluster database"
      description="Daftarkan PostgreSQL shared sebelum mengaktifkan mode database pada provisioning."
    />
    <div v-else class="grid gap-4 lg:grid-cols-2">
      <UiCard v-for="cluster in overview.clusters" :key="cluster.id">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-start gap-3">
            <span class="rounded-md bg-brand/10 p-2 text-brand"><Database :size="18" /></span>
            <div class="min-w-0">
              <h2 class="truncate text-sm font-semibold text-ink">{{ cluster.name }}</h2>
              <p class="mt-1 truncate font-mono text-xs text-muted">
                {{ cluster.host }}:{{ cluster.port }}/{{ cluster.adminDatabase }}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap justify-end gap-1.5">
            <UiBadge :tone="cluster.isActive ? 'success' : 'neutral'">{{
              cluster.isActive ? 'Enabled' : 'Disabled'
            }}</UiBadge>
            <UiBadge
              :tone="
                cluster.connectionStatus === 'connected'
                  ? 'success'
                  : cluster.connectionStatus === 'unreachable'
                    ? 'danger'
                    : 'neutral'
              "
            >
              {{
                cluster.connectionStatus === 'connected'
                  ? 'Online'
                  : cluster.connectionStatus === 'unreachable'
                    ? 'Unreachable'
                    : 'Unchecked'
              }}
            </UiBadge>
          </div>
        </div>
        <dl class="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
          <div>
            <dt class="text-muted">Provisioner</dt>
            <dd class="mt-1 font-mono text-ink">{{ cluster.provisionerUsername }}</dd>
          </div>
          <div>
            <dt class="text-muted">SSL</dt>
            <dd class="mt-1 text-ink">{{ cluster.sslMode }}</dd>
          </div>
          <div>
            <dt class="text-muted">Database terkelola</dt>
            <dd class="mt-1 text-ink">{{ cluster.activeDatabaseCount }}</dd>
          </div>
          <div>
            <dt class="text-muted">Total database PostgreSQL</dt>
            <dd class="mt-1 text-ink">{{ cluster.totalDatabaseCount ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted">Connection limit / service</dt>
            <dd class="mt-1 text-ink">{{ cluster.defaultConnectionLimit }}</dd>
          </div>
        </dl>
        <div class="mt-4 flex justify-end gap-2 border-t pt-4">
          <UiButton
            variant="secondary"
            size="sm"
            :disabled="testingId === cluster.id"
            @click="testCluster(cluster)"
          >
            <TestTube2 :size="13" /> {{ testingId === cluster.id ? 'Menguji…' : 'Test koneksi' }}
          </UiButton>
          <UiButton variant="secondary" size="sm" @click="openEdit(cluster)"
            ><Pencil :size="13" /> Edit</UiButton
          >
        </div>
      </UiCard>
    </div>
  </div>
</template>
