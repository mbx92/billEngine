<script setup lang="ts">
import { Plus, RefreshCw, Server as ServerIcon, X } from '@lucide/vue'
import type { ApiCoolifySyncResult, ApiResourceServer } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Servers · Billing Infra' })

const format = useFormat()
const showAddForm = ref(false)
const saving = ref(false)
const syncingServerId = ref<string | null>(null)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const form = reactive({ name: '', baseUrl: '', apiToken: '' })

const { data, status, error, refresh } = await useFetch<{ data: ApiResourceServer[] }>(
  '/api/resources/servers',
)

const servers = computed(() => data.value?.data ?? [])

async function addServer() {
  saving.value = true
  actionError.value = null
  actionMessage.value = null

  try {
    const response = await $fetch<{ data: ApiCoolifySyncResult }>('/api/resources/servers', {
      method: 'POST',
      body: form,
    })
    actionMessage.value = `${form.name} terhubung: ${format.count(response.data.processedCount)} aplikasi dan ${format.count(response.data.nodeCount)} server ditemukan.`
    Object.assign(form, { name: '', baseUrl: '', apiToken: '' })
    showAddForm.value = false
    await refresh()
  } catch (error) {
    actionError.value = apiErrorMessage(error, 'Gagal menambahkan koneksi Coolify.')
  } finally {
    saving.value = false
  }
}

async function syncServer(server: ApiResourceServer) {
  syncingServerId.value = server.id
  actionError.value = null
  actionMessage.value = null

  try {
    const response = await $fetch<{ data: ApiCoolifySyncResult }>(
      `/api/resources/servers/${server.id}/sync`,
      { method: 'POST' },
    )
    actionMessage.value = `${server.name}: ${format.count(response.data.processedCount)} aplikasi dan ${format.count(response.data.nodeCount)} server disinkronkan.`
    await refresh()
  } catch (error) {
    actionError.value = apiErrorMessage(error, 'Sinkronisasi Coolify gagal.')
  } finally {
    syncingServerId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / servers
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Coolify Servers</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Kelola beberapa control-plane Coolify beserta server/node dan resource di masing-masing
          koneksi.
        </p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
          Refresh
        </UiButton>
        <UiButton @click="showAddForm = !showAddForm">
          <X v-if="showAddForm" :size="15" aria-hidden="true" />
          <Plus v-else :size="15" aria-hidden="true" />
          {{ showAddForm ? 'Tutup' : 'Tambah Coolify' }}
        </UiButton>
      </div>
    </header>

    <p
      v-if="actionMessage"
      class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
      role="status"
    >
      {{ actionMessage }}
    </p>
    <p
      v-if="actionError"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <UiCard v-if="showAddForm" class="mb-5">
      <form class="grid gap-4 md:grid-cols-2" @submit.prevent="addServer">
        <UiInput
          v-model="form.name"
          label="Nama koneksi"
          placeholder="Coolify Singapore"
          autocomplete="off"
          required
        />
        <UiInput
          v-model="form.baseUrl"
          label="URL Coolify"
          placeholder="https://coolify.example.com"
          type="url"
          autocomplete="url"
          required
        />
        <div class="md:col-span-2">
          <UiInput
            v-model="form.apiToken"
            label="API token"
            hint="Token dites sebelum disimpan dan dienkripsi di database."
            type="password"
            autocomplete="new-password"
            required
          />
        </div>
        <div class="md:col-span-2 flex justify-end">
          <UiButton type="submit" :disabled="saving">
            {{ saving ? 'Menghubungkan…' : 'Test, simpan & sync' }}
          </UiButton>
        </div>
      </form>
    </UiCard>

    <div v-if="status === 'pending'" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <UiSkeleton v-for="card in 2" :key="card" height="8rem" />
    </div>

    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Gagal memuat servers"
        description="Server tidak dapat membaca daftar Coolify server. Coba muat ulang halaman."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>
    </UiCard>

    <UiCard v-else-if="servers.length === 0" :padded="false">
      <UiEmptyState
        title="Belum ada server"
        description="Tambahkan endpoint Coolify untuk mulai menyinkronkan resource inventory."
      />
    </UiCard>

    <div v-else class="space-y-4">
      <UiCard v-for="server in servers" :key="server.id">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold text-ink">{{ server.name }}</h2>
            <p class="mt-1 truncate font-mono text-[11px] text-muted">{{ server.baseUrl }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <UiBadge
              :tone="
                server.status === 'connected'
                  ? 'success'
                  : server.status === 'error'
                    ? 'danger'
                    : 'neutral'
              "
              dot
            >
              {{ server.status }}
            </UiBadge>
            <UiButton
              variant="secondary"
              size="sm"
              :disabled="syncingServerId === server.id || server.credentialSource === 'missing'"
              @click="syncServer(server)"
            >
              <RefreshCw
                :size="13"
                :class="{ 'animate-spin': syncingServerId === server.id }"
                aria-hidden="true"
              />
              Sync
            </UiButton>
          </div>
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-xs">
          <div>
            <dt class="text-muted">Applications</dt>
            <dd class="mt-1 font-mono text-ink">{{ format.count(server.resourceCount) }}</dd>
          </div>
          <div>
            <dt class="text-muted">Credential</dt>
            <dd class="mt-1 font-mono text-ink">{{ server.credentialSource }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-muted">Last synced</dt>
            <dd class="mt-1 font-mono text-ink">{{ format.dateTime(server.lastSyncedAt) }}</dd>
          </div>
        </dl>

        <div class="mt-4 border-t pt-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-xs font-semibold text-muted">Server / node dari Coolify</h3>
            <UiBadge>{{ format.count(server.nodes.length) }} server</UiBadge>
          </div>

          <div v-if="server.nodes.length" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="node in server.nodes"
              :key="node.id"
              class="rounded-md border bg-canvas/50 p-3"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="flex items-center gap-2 text-sm font-semibold text-ink">
                    <ServerIcon :size="14" aria-hidden="true" />
                    <span class="truncate">{{ node.name }}</span>
                  </p>
                  <p class="mt-1 truncate font-mono text-[11px] text-muted">
                    {{ node.address || 'alamat tidak dilaporkan'
                    }}<template v-if="node.sshPort">:{{ node.sshPort }}</template>
                  </p>
                </div>
                <UiBadge :tone="node.isReachable && node.isUsable ? 'success' : 'danger'" dot>
                  {{ node.status }}
                </UiBadge>
              </div>
              <p class="mt-3 text-xs text-muted">
                {{ format.count(node.resourceCount) }} aplikasi
                <span v-if="node.isCoolifyHost"> · Coolify host</span>
              </p>
            </div>
          </div>
          <p v-else class="text-xs text-muted">
            Belum ada server dari API Coolify. Jalankan sync pada koneksi ini.
          </p>
        </div>

        <p
          v-if="server.lastSyncError"
          class="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {{ server.lastSyncError }}
        </p>
      </UiCard>
    </div>
  </div>
</template>
