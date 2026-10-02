<script setup lang="ts">
import { Cloud, Pencil, Plus, RefreshCw, Route, Trash2 } from '@lucide/vue'
import type {
  ApiCloudflareTunnel,
  ApiCloudflareTunnelDetail,
  ApiCloudflareTunnelOverview,
  ApiCloudflareTunnelRoute,
  CloudflareTunnelStatus,
} from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Cloudflare Tunnels · Billing Infra' })

const format = useFormat()
const {
  data: overviewResponse,
  status,
  error,
  refresh,
} = await useFetch<{ data: ApiCloudflareTunnelOverview }>('/api/cloudflare/tunnels')

const overview = computed(() => overviewResponse.value?.data)
const tunnels = computed(() => overview.value?.tunnels ?? [])
const healthyCount = computed(
  () => tunnels.value.filter((tunnel) => tunnel.status === 'healthy').length,
)

const selectedTunnelId = ref<string | null>(null)
const detail = ref<ApiCloudflareTunnelDetail | null>(null)
const loadingDetail = ref(false)
const showManageDialog = ref(false)
const showRouteDialog = ref(false)
const showDeleteDialog = ref(false)
const routeDialogMode = ref<'create' | 'edit'>('create')
const originalRoute = ref<{ hostname: string; path: string } | null>(null)
const deletingRoute = ref<ApiCloudflareTunnelRoute | null>(null)
const savingRoute = ref(false)
const deleting = ref(false)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
const detailError = ref<string | null>(null)
const dialogError = ref<string | null>(null)

const selectedTunnel = computed(() =>
  tunnels.value.find((tunnel) => tunnel.id === selectedTunnelId.value),
)

const routeForm = reactive({
  hostname: '',
  path: '',
  service: 'https://localhost:443',
  noTlsVerify: true,
  httpHostHeader: '',
  originServerName: '',
})

async function loadTunnel(tunnel: ApiCloudflareTunnel) {
  const changedTunnel = selectedTunnelId.value !== tunnel.id
  selectedTunnelId.value = tunnel.id
  showManageDialog.value = true
  loadingDetail.value = true
  detailError.value = null
  if (changedTunnel) detail.value = null
  try {
    const response = await $fetch<{ data: ApiCloudflareTunnelDetail }>(
      `/api/cloudflare/tunnels/${tunnel.id}`,
    )
    detail.value = response.data
  } catch (requestError) {
    detail.value = null
    detailError.value = apiErrorMessage(requestError, 'Konfigurasi tunnel gagal dimuat.')
  } finally {
    loadingDetail.value = false
  }
}

async function refreshAll() {
  await refresh()
  if (selectedTunnelId.value && showManageDialog.value) {
    const selected = tunnels.value.find((tunnel) => tunnel.id === selectedTunnelId.value)
    if (selected) await loadTunnel(selected)
  }
}

function openCreateRoute() {
  routeDialogMode.value = 'create'
  originalRoute.value = null
  Object.assign(routeForm, {
    hostname: '',
    path: '',
    service: 'https://localhost:443',
    noTlsVerify: true,
    httpHostHeader: '',
    originServerName: '',
  })
  dialogError.value = null
  showManageDialog.value = false
  showRouteDialog.value = true
}

function openEditRoute(route: ApiCloudflareTunnelRoute) {
  if (!route.hostname || route.catchAll) return
  routeDialogMode.value = 'edit'
  originalRoute.value = { hostname: route.hostname, path: route.path ?? '' }
  Object.assign(routeForm, {
    hostname: route.hostname,
    path: route.path ?? '',
    service: route.service,
    noTlsVerify: route.noTlsVerify,
    httpHostHeader: route.httpHostHeader ?? '',
    originServerName: route.originServerName ?? '',
  })
  dialogError.value = null
  showManageDialog.value = false
  showRouteDialog.value = true
}

function closeRouteDialog() {
  showRouteDialog.value = false
  showManageDialog.value = true
}

async function saveRoute() {
  if (!detail.value) return
  savingRoute.value = true
  dialogError.value = null
  actionMessage.value = null

  try {
    const endpoint = `/api/cloudflare/tunnels/${detail.value.tunnel.id}/routes`
    const body =
      routeDialogMode.value === 'create'
        ? routeForm
        : { original: originalRoute.value, route: routeForm }
    const response = await $fetch<{ data: ApiCloudflareTunnelDetail }>(endpoint, {
      method: routeDialogMode.value === 'create' ? 'POST' : 'PATCH',
      body,
    })
    detail.value = response.data
    actionMessage.value =
      routeDialogMode.value === 'create'
        ? `Route ${routeForm.hostname} berhasil ditambahkan.`
        : `Route ${routeForm.hostname} berhasil diperbarui.`
    showRouteDialog.value = false
    showManageDialog.value = true
  } catch (requestError) {
    dialogError.value = apiErrorMessage(requestError, 'Route tunnel gagal disimpan.')
  } finally {
    savingRoute.value = false
  }
}

function openDeleteRoute(route: ApiCloudflareTunnelRoute) {
  if (!route.hostname || route.catchAll) return
  deletingRoute.value = route
  dialogError.value = null
  showManageDialog.value = false
  showDeleteDialog.value = true
}

function closeDeleteDialog() {
  showDeleteDialog.value = false
  showManageDialog.value = true
}

async function deleteRoute() {
  if (!detail.value || !deletingRoute.value?.hostname) return
  deleting.value = true
  dialogError.value = null
  actionMessage.value = null

  try {
    const response = await $fetch<{ data: ApiCloudflareTunnelDetail }>(
      `/api/cloudflare/tunnels/${detail.value.tunnel.id}/routes`,
      {
        method: 'DELETE',
        body: {
          hostname: deletingRoute.value.hostname,
          path: deletingRoute.value.path ?? '',
        },
      },
    )
    actionMessage.value = `Route ${deletingRoute.value.hostname} berhasil dihapus.`
    detail.value = response.data
    showDeleteDialog.value = false
    showManageDialog.value = true
    deletingRoute.value = null
  } catch (requestError) {
    dialogError.value = apiErrorMessage(requestError, 'Route tunnel gagal dihapus.')
  } finally {
    deleting.value = false
  }
}

function statusTone(value: CloudflareTunnelStatus) {
  if (value === 'healthy') return 'success' as const
  if (value === 'degraded') return 'warning' as const
  if (value === 'down') return 'danger' as const
  return 'neutral' as const
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / Cloudflare
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Cloudflare Tunnels</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Pantau tunnel dan kelola public hostname yang mengarahkan trafik Cloudflare ke origin
          Coolify.
        </p>
      </div>
      <UiButton variant="secondary" :disabled="status === 'pending'" @click="refreshAll">
        <RefreshCw :size="15" :class="{ 'animate-spin': status === 'pending' }" />
        Refresh
      </UiButton>
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

    <div v-if="status === 'pending' && !overview" class="grid gap-4 sm:grid-cols-3">
      <UiSkeleton v-for="item in 3" :key="item" height="7rem" />
    </div>

    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Cloudflare tidak dapat dihubungi"
        description="Periksa Account ID dan permission API token, lalu coba kembali."
      >
        <UiButton variant="secondary" size="sm" @click="refreshAll">Coba lagi</UiButton>
      </UiEmptyState>
    </UiCard>

    <UiCard v-else-if="overview && !overview.configured" :padded="false">
      <UiEmptyState
        title="Cloudflare Tunnel belum dikonfigurasi"
        description="Isi NUXT_CLOUDFLARE_API_TOKEN dan NUXT_CLOUDFLARE_ACCOUNT_ID. Token memerlukan Cloudflare Tunnel Read untuk melihat dan Write untuk mengubah route."
      />
    </UiCard>

    <template v-else>
      <div class="mb-5 grid gap-4 sm:grid-cols-3">
        <UiStat label="Total tunnel" :value="format.count(tunnels.length)" />
        <UiStat label="Healthy" :value="format.count(healthyCount)" />
        <UiStat label="Perlu perhatian" :value="format.count(tunnels.length - healthyCount)" />
      </div>

      <UiCard v-if="tunnels.length === 0" :padded="false">
        <UiEmptyState
          title="Belum ada Cloudflare Tunnel"
          description="Buat tunnel terlebih dahulu dari Cloudflare Zero Trust, kemudian refresh halaman ini."
        />
      </UiCard>

      <div v-else class="grid gap-4 lg:grid-cols-2">
        <UiCard v-for="tunnel in tunnels" :key="tunnel.id">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="flex items-center gap-2 truncate text-sm font-semibold text-ink">
                <Cloud :size="15" class="shrink-0 text-brand" />
                <span class="truncate">{{ tunnel.name }}</span>
              </h2>
              <p class="mt-1 truncate font-mono text-[11px] text-muted">{{ tunnel.id }}</p>
            </div>
            <UiBadge :tone="statusTone(tunnel.status)" dot>{{ tunnel.status }}</UiBadge>
          </div>

          <dl class="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-2">
            <div>
              <dt class="text-muted">Configuration</dt>
              <dd class="mt-1 font-mono text-ink">{{ tunnel.configSource }}</dd>
            </div>
            <div>
              <dt class="text-muted">Active since</dt>
              <dd class="mt-1 font-mono text-ink">
                {{ format.dateTime(tunnel.connectionsActiveAt) }}
              </dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-muted">DNS target</dt>
              <dd class="mt-1 truncate font-mono text-ink">{{ tunnel.expectedDnsTarget }}</dd>
            </div>
          </dl>

          <div class="mt-4 flex justify-end border-t pt-4">
            <UiButton
              variant="secondary"
              size="sm"
              :disabled="loadingDetail && selectedTunnelId === tunnel.id"
              @click="loadTunnel(tunnel)"
            >
              <Route :size="13" />
              {{ loadingDetail && selectedTunnelId === tunnel.id ? 'Memuat…' : 'Kelola routes' }}
            </UiButton>
          </div>
        </UiCard>
      </div>
    </template>

    <UiDialog
      v-if="showManageDialog"
      :title="`Kelola routes${selectedTunnel ? ` · ${selectedTunnel.name}` : ''}`"
      description="Lihat dan kelola ingress public hostname pada Cloudflare Tunnel."
      size="xl"
      @close="showManageDialog = false"
    >
      <UiSkeleton v-if="loadingDetail" height="12rem" />

      <div v-else-if="detailError">
        <p
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {{ detailError }}
        </p>
        <div class="mt-4 flex justify-end">
          <UiButton
            v-if="selectedTunnel"
            variant="secondary"
            size="sm"
            @click="loadTunnel(selectedTunnel)"
          >
            <RefreshCw :size="13" />
            Coba lagi
          </UiButton>
        </div>
      </div>

      <template v-else-if="detail">
        <div class="flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-start">
          <div>
            <p class="text-xs font-semibold tracking-wide text-muted uppercase">Ingress routes</p>
            <p class="mt-1 text-xs text-muted">
              Perubahan konfigurasi diterapkan langsung ke Cloudflare Tunnel.
            </p>
          </div>
          <UiButton v-if="detail.editable" size="sm" @click="openCreateRoute">
            <Plus :size="13" />
            Tambah route
          </UiButton>
          <UiBadge v-else tone="warning">Local config · read only</UiBadge>
        </div>

        <p
          v-if="!detail.editable"
          class="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          Tunnel ini memakai file konfigurasi lokal. Ubah ingress pada host cloudflared agar tidak
          tertimpa atau berbeda dengan konfigurasi origin.
        </p>

        <div v-if="detail.configuration?.routes.length" class="mt-4 space-y-3">
          <div
            v-for="routeItem in detail.configuration.routes"
            :key="`${routeItem.hostname ?? 'catch-all'}:${routeItem.path ?? ''}`"
            class="rounded-md border bg-canvas/50 p-4"
          >
            <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="break-all font-mono text-sm font-semibold text-ink">
                    {{ routeItem.hostname || 'Catch-all' }}{{ routeItem.path || '' }}
                  </p>
                  <UiBadge v-if="routeItem.catchAll">fallback</UiBadge>
                  <UiBadge v-if="routeItem.noTlsVerify" tone="warning">No TLS Verify</UiBadge>
                </div>
                <p class="mt-2 break-all font-mono text-xs text-muted">→ {{ routeItem.service }}</p>
                <p v-if="routeItem.httpHostHeader" class="mt-1 text-xs text-muted">
                  Host header:
                  <span class="font-mono text-ink">{{ routeItem.httpHostHeader }}</span>
                </p>
                <p v-if="routeItem.originServerName" class="mt-1 text-xs text-muted">
                  TLS server name:
                  <span class="font-mono text-ink">{{ routeItem.originServerName }}</span>
                </p>
              </div>
              <div v-if="detail.editable && !routeItem.catchAll" class="flex shrink-0 gap-2">
                <UiButton variant="secondary" size="sm" @click="openEditRoute(routeItem)">
                  <Pencil :size="13" />
                  Edit
                </UiButton>
                <UiButton variant="danger" size="sm" @click="openDeleteRoute(routeItem)">
                  <Trash2 :size="13" />
                  Hapus
                </UiButton>
              </div>
            </div>
          </div>
        </div>
        <UiEmptyState
          v-else
          title="Konfigurasi ingress kosong"
          description="Belum ada route yang dilaporkan Cloudflare untuk tunnel ini."
        />
      </template>
    </UiDialog>

    <UiDialog
      v-if="showRouteDialog"
      :title="routeDialogMode === 'create' ? 'Tambah tunnel route' : 'Edit tunnel route'"
      description="Hostname akan diarahkan oleh cloudflared ke origin service. Pastikan DNS hostname menunjuk ke target tunnel."
      size="lg"
      :close-disabled="savingRoute"
      @close="closeRouteDialog"
    >
      <p
        v-if="dialogError"
        class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ dialogError }}
      </p>
      <form class="grid gap-4 md:grid-cols-2" @submit.prevent="saveRoute">
        <UiInput
          v-model="routeForm.hostname"
          label="Public hostname"
          placeholder="*.ocnetworks.web.id"
          autocomplete="off"
          required
        />
        <UiInput
          v-model="routeForm.path"
          label="Path (opsional)"
          placeholder="/api/*"
          autocomplete="off"
        />
        <div class="md:col-span-2">
          <UiInput
            v-model="routeForm.service"
            label="Origin service"
            hint="Contoh: https://localhost:443, http://localhost:3000, atau http_status:404."
            placeholder="https://localhost:443"
            autocomplete="off"
            required
          />
        </div>
        <UiInput
          v-model="routeForm.httpHostHeader"
          label="HTTP Host Header (opsional)"
          autocomplete="off"
        />
        <UiInput
          v-model="routeForm.originServerName"
          label="Origin Server Name (opsional)"
          autocomplete="off"
        />
        <label class="flex items-start gap-3 rounded-md border bg-canvas/50 p-3 md:col-span-2">
          <input
            v-model="routeForm.noTlsVerify"
            type="checkbox"
            class="mt-0.5 size-4 accent-brand"
          />
          <span>
            <span class="block text-sm font-semibold text-ink">No TLS Verify</span>
            <span class="mt-1 block text-xs leading-5 text-muted">
              Gunakan hanya jika origin HTTPS memakai sertifikat untuk hostname publik, misalnya
              proxy Coolify di https://localhost:443.
            </span>
          </span>
        </label>
        <div class="flex justify-end gap-2 md:col-span-2">
          <UiButton
            type="button"
            variant="secondary"
            :disabled="savingRoute"
            @click="closeRouteDialog"
          >
            Batal
          </UiButton>
          <UiButton type="submit" :disabled="savingRoute">
            {{ savingRoute ? 'Menyimpan…' : 'Simpan route' }}
          </UiButton>
        </div>
      </form>
    </UiDialog>

    <UiDialog
      v-if="showDeleteDialog && deletingRoute"
      title="Hapus tunnel route"
      description="Cloudflare akan berhenti meneruskan hostname ini melalui konfigurasi tunnel. DNS record tidak ikut dihapus."
      size="md"
      :close-disabled="deleting"
      @close="closeDeleteDialog"
    >
      <p
        v-if="dialogError"
        class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ dialogError }}
      </p>
      <p class="text-sm text-muted">
        Route
        <strong class="break-all font-mono text-ink">
          {{ deletingRoute.hostname }}{{ deletingRoute.path || '' }}
        </strong>
        akan dihapus dari tunnel <strong class="text-ink">{{ detail?.tunnel.name }}</strong
        >.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="deleting" @click="closeDeleteDialog">
            Batal
          </UiButton>
          <UiButton variant="danger" :disabled="deleting" @click="deleteRoute">
            {{ deleting ? 'Menghapus…' : 'Hapus route' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>
  </div>
</template>
