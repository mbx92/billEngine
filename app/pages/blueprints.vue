<script setup lang="ts">
import { Box, FileCode2, GitBranch, Pencil, Plus, RefreshCw, Server, Trash2, X } from '@lucide/vue'
import type {
  ApiBlueprintCatalog,
  ApiCoolifyProjectOption,
  ApiDeploymentBlueprint,
} from '#shared/types/api'
import {
  addBillingGateTraefikLabel,
  BILLING_GATE_TRAEFIK_MIDDLEWARE,
  removeBillingGateTraefikLabel,
} from '#shared/utils/provisioning-labels'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Blueprints · Billing Infra' })

const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<{ data: ApiBlueprintCatalog }>('/api/provisioning/blueprints')

const catalog = computed(() => response.value?.data)
const showForm = ref(false)
const editingId = ref<string | null>(null)
const deletingBlueprint = ref<ApiDeploymentBlueprint | null>(null)
const activeTab = ref<'identity' | 'source' | 'target' | 'runtime' | 'routing'>('identity')
const saving = ref(false)
const deleting = ref(false)
const loadingProjects = ref(false)
const projectOptions = ref<ApiCoolifyProjectOption[]>([])
const projectError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
let projectRequestId = 0

const form = reactive({
  coolifyServerId: '',
  name: '',
  slug: '',
  description: '',
  repositoryUrl: '',
  branch: 'main',
  buildPack: 'dockercompose' as ApiDeploymentBlueprint['buildPack'],
  projectUuid: '',
  targetServerUuid: '',
  environmentName: 'production',
  destinationUuid: '',
  baseDirectory: '/',
  dockerfileLocation: '/Dockerfile',
  dockerComposeLocation: '/docker-compose.yml',
  composeServiceName: 'app',
  portsExposes: '3000',
  healthcheckPath: '/health',
  healthcheckPort: '3000',
  environmentKeys: [] as string[],
  customLabels: '',
  billingGateEnabled: false,
  databaseClusterId: '',
  databaseEnvironmentKey: 'DATABASE_URL',
  isActive: true,
})

const tabs = [
  { id: 'identity', label: 'Identitas' },
  { id: 'source', label: 'Source & build' },
  { id: 'target', label: 'Target Coolify' },
  { id: 'runtime', label: 'Runtime & env' },
  { id: 'routing', label: 'Routing' },
] as const

const selectedConnection = computed(() =>
  catalog.value?.servers.find((server) => server.id === form.coolifyServerId),
)

watch(
  () => form.name,
  (name) => {
    if (!editingId.value) form.slug = slugify(name)
  },
)

watch(
  () => form.billingGateEnabled,
  (enabled) => {
    form.customLabels = enabled
      ? addBillingGateTraefikLabel(form.customLabels)
      : removeBillingGateTraefikLabel(form.customLabels)
  },
)

function resetForm() {
  const defaultServer = catalog.value?.servers.find((server) => server.isActive)
  editingId.value = null
  activeTab.value = 'identity'
  Object.assign(form, {
    coolifyServerId: defaultServer?.id ?? '',
    name: '',
    slug: '',
    description: '',
    repositoryUrl: '',
    branch: 'main',
    buildPack: 'dockercompose',
    projectUuid: '',
    targetServerUuid: defaultServer?.nodes.find((node) => node.isUsable)?.coolifyUuid ?? '',
    environmentName: 'production',
    destinationUuid: '',
    baseDirectory: '/',
    dockerfileLocation: '/Dockerfile',
    dockerComposeLocation: '/docker-compose.yml',
    composeServiceName: 'app',
    portsExposes: '3000',
    healthcheckPath: '/health',
    healthcheckPort: '3000',
    environmentKeys: [],
    customLabels: '',
    billingGateEnabled: false,
    databaseClusterId: '',
    databaseEnvironmentKey: 'DATABASE_URL',
    isActive: true,
  })
  projectOptions.value = []
  projectError.value = null
  if (form.coolifyServerId) void loadProjects(form.coolifyServerId)
}

function openCreate() {
  clearFeedback()
  resetForm()
  showForm.value = true
}

function openEdit(blueprint: ApiDeploymentBlueprint) {
  clearFeedback()
  editingId.value = blueprint.id
  activeTab.value = 'identity'
  Object.assign(form, {
    coolifyServerId: blueprint.coolifyServerId,
    name: blueprint.name,
    slug: blueprint.slug,
    description: blueprint.description ?? '',
    repositoryUrl: blueprint.repositoryUrl,
    branch: blueprint.branch,
    buildPack: blueprint.buildPack,
    projectUuid: blueprint.projectUuid,
    targetServerUuid: blueprint.targetServerUuid,
    environmentName: blueprint.environmentName,
    destinationUuid: blueprint.destinationUuid ?? '',
    baseDirectory: blueprint.baseDirectory ?? '/',
    dockerfileLocation: blueprint.dockerfileLocation ?? '/Dockerfile',
    dockerComposeLocation: blueprint.dockerComposeLocation ?? '/docker-compose.yml',
    composeServiceName: blueprint.composeServiceName ?? 'app',
    portsExposes: blueprint.portsExposes ?? '',
    healthcheckPath: blueprint.healthcheckPath ?? '',
    healthcheckPort: blueprint.healthcheckPort ?? '',
    environmentKeys: [...blueprint.environmentKeys],
    customLabels: blueprint.customLabels ?? '',
    billingGateEnabled: blueprint.billingGateEnabled,
    databaseClusterId: blueprint.databaseClusterId ?? '',
    databaseEnvironmentKey: blueprint.databaseEnvironmentKey,
    isActive: blueprint.isActive,
  })
  showForm.value = true
  void loadProjects(blueprint.coolifyServerId, blueprint.projectUuid)
}

function handleCoolifyServerChange() {
  form.projectUuid = ''
  form.targetServerUuid =
    selectedConnection.value?.nodes.find((node) => node.isUsable)?.coolifyUuid ?? ''
  projectOptions.value = []
  projectError.value = null
  if (form.coolifyServerId) void loadProjects(form.coolifyServerId)
}

async function loadProjects(serverId: string, preserveProjectUuid = '') {
  const requestId = ++projectRequestId
  loadingProjects.value = true
  projectError.value = null
  try {
    const result = await $fetch<{ data: ApiCoolifyProjectOption[] }>('/api/provisioning/projects', {
      query: { serverId },
    })
    if (requestId !== projectRequestId) return
    projectOptions.value = result.data
    if (
      preserveProjectUuid &&
      result.data.some((project) => project.uuid === preserveProjectUuid)
    ) {
      form.projectUuid = preserveProjectUuid
    }
  } catch (caught) {
    if (requestId !== projectRequestId) return
    projectOptions.value = []
    projectError.value = apiErrorMessage(caught, 'Daftar project Coolify gagal dimuat.')
  } finally {
    if (requestId === projectRequestId) loadingProjects.value = false
  }
}

async function saveBlueprint() {
  saving.value = true
  clearFeedback()
  try {
    const body = {
      ...form,
      environmentKeys: normalizeEnvironmentKeys(form.environmentKeys),
    }
    if (editingId.value) {
      await $fetch(`/api/provisioning/blueprints/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      actionMessage.value = `Blueprint ${form.name} berhasil diperbarui.`
    } else {
      await $fetch('/api/provisioning/blueprints', { method: 'POST', body })
      actionMessage.value = `Blueprint ${form.name} berhasil dibuat.`
    }
    showForm.value = false
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Blueprint gagal disimpan.')
  } finally {
    saving.value = false
  }
}

async function deleteBlueprint() {
  if (!deletingBlueprint.value) return
  deleting.value = true
  clearFeedback()
  const blueprint = deletingBlueprint.value
  try {
    await $fetch(`/api/provisioning/blueprints/${blueprint.id}`, { method: 'DELETE' })
    actionMessage.value = `Blueprint ${blueprint.name} berhasil dihapus.`
    deletingBlueprint.value = null
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Blueprint gagal dihapus.')
    deletingBlueprint.value = null
  } finally {
    deleting.value = false
  }
}

function addEnvironmentKey() {
  form.environmentKeys.push('')
}

function removeEnvironmentKey(index: number) {
  form.environmentKeys.splice(index, 1)
}

function normalizeEnvironmentKeys(keys: string[]) {
  return keys
    .flatMap((value) => {
      const normalized = value.trim().replace(/^export\s+/i, '')
      if (!normalized) return []
      const separator = normalized.indexOf('=')
      return [separator >= 0 ? normalized.slice(0, separator).trim() : normalized]
    })
    .filter((value, index, values) => value && values.indexOf(value) === index)
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function clearFeedback() {
  actionMessage.value = null
  actionError.value = null
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / deployment catalog
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Blueprints</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Kelola resep deployment reusable untuk source, build pack, target Coolify, environment,
          database, healthcheck, dan routing.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :class="{ 'animate-spin': status === 'pending' }" />
          Refresh
        </UiButton>
        <UiButton @click="openCreate"><Plus :size="15" /> Tambah blueprint</UiButton>
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
      v-if="actionError && !showForm"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <div v-if="status === 'pending' && !catalog" class="grid gap-4 md:grid-cols-2">
      <UiSkeleton v-for="item in 4" :key="item" height="13rem" />
    </div>
    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Blueprint gagal dimuat"
        description="Periksa koneksi database lalu muat ulang halaman."
      />
    </UiCard>
    <UiCard v-else-if="!catalog?.blueprints.length" :padded="false">
      <UiEmptyState
        title="Belum ada blueprint"
        description="Buat resep deployment pertama untuk mulai melakukan provisioning aplikasi."
      />
    </UiCard>
    <div v-else class="grid gap-4 lg:grid-cols-2">
      <UiCard v-for="blueprint in catalog.blueprints" :key="blueprint.id">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="truncate text-base font-semibold text-ink">{{ blueprint.name }}</h2>
              <UiBadge :tone="blueprint.isActive ? 'success' : 'neutral'" dot>
                {{ blueprint.isActive ? 'active' : 'inactive' }}
              </UiBadge>
              <UiBadge tone="info">{{ blueprint.buildPack }}</UiBadge>
            </div>
            <p class="mt-1 font-mono text-[11px] text-muted">{{ blueprint.slug }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <UiButton variant="ghost" size="sm" @click="openEdit(blueprint)">
              <Pencil :size="14" /> Edit
            </UiButton>
            <UiButton variant="danger" size="sm" @click="deletingBlueprint = blueprint">
              <Trash2 :size="14" />
            </UiButton>
          </div>
        </div>

        <p v-if="blueprint.description" class="mt-3 line-clamp-2 text-sm leading-5 text-muted">
          {{ blueprint.description }}
        </p>
        <dl class="mt-4 grid gap-3 border-t pt-4 text-xs sm:grid-cols-2">
          <div>
            <dt class="flex items-center gap-1.5 text-muted"><GitBranch :size="12" /> Source</dt>
            <dd class="mt-1 truncate text-ink">{{ blueprint.repositoryUrl }}</dd>
            <dd class="font-mono text-[10px] text-muted">{{ blueprint.branch }}</dd>
          </div>
          <div>
            <dt class="flex items-center gap-1.5 text-muted"><Server :size="12" /> Target</dt>
            <dd class="mt-1 text-ink">{{ blueprint.coolifyServerName }}</dd>
            <dd class="truncate font-mono text-[10px] text-muted">
              {{ blueprint.environmentName }} · {{ blueprint.projectUuid }}
            </dd>
          </div>
          <div>
            <dt class="flex items-center gap-1.5 text-muted">
              <FileCode2 :size="12" /> Build file
            </dt>
            <dd class="mt-1 font-mono text-ink">
              {{
                blueprint.buildPack === 'dockercompose'
                  ? blueprint.dockerComposeLocation
                  : blueprint.buildPack === 'dockerfile'
                    ? blueprint.dockerfileLocation
                    : 'Auto detected'
              }}
            </dd>
          </div>
          <div>
            <dt class="flex items-center gap-1.5 text-muted"><Box :size="12" /> Runtime</dt>
            <dd class="mt-1 text-ink">
              Port {{ blueprint.portsExposes || 'auto' }} ·
              {{ blueprint.environmentKeys.length }} env key
            </dd>
          </div>
        </dl>
      </UiCard>
    </div>

    <UiDialog
      v-if="showForm"
      :title="editingId ? 'Edit blueprint' : 'Tambah blueprint'"
      description="Konfigurasi disimpan sebagai resep reusable. Nilai secret environment tetap diisi saat provisioning."
      size="xl"
      fixed-height
      :close-disabled="saving"
      @close="showForm = false"
    >
      <form id="blueprint-form" @submit.prevent="saveBlueprint">
        <p
          v-if="actionError"
          class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {{ actionError }}
        </p>

        <div class="mb-5 overflow-x-auto border-b">
          <div class="flex min-w-max gap-1">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              type="button"
              class="focus-ring border-b-2 px-3 py-2 text-xs font-semibold transition"
              :class="
                activeTab === tab.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted hover:text-ink'
              "
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <div v-if="activeTab === 'identity'" class="grid gap-4 md:grid-cols-2">
          <UiInput v-model="form.name" label="Nama blueprint" required />
          <UiInput v-model="form.slug" label="Slug" required />
          <label class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Deskripsi</span>
            <textarea
              v-model="form.description"
              rows="4"
              class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink"
              placeholder="Kegunaan dan karakteristik aplikasi yang dibuat blueprint ini."
            />
          </label>
          <label v-if="editingId" class="flex items-center gap-3 text-sm text-ink md:col-span-2">
            <input v-model="form.isActive" type="checkbox" class="size-4 accent-brand" />
            Blueprint aktif dan dapat dipilih saat provisioning
          </label>
        </div>

        <div v-else-if="activeTab === 'source'" class="grid gap-4 md:grid-cols-2">
          <UiInput
            v-model="form.repositoryUrl"
            class="md:col-span-2"
            label="Public repository URL"
            type="url"
            required
          />
          <UiInput v-model="form.branch" label="Branch" required />
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Build pack</span>
            <select
              v-model="form.buildPack"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="nixpacks">Nixpacks</option>
              <option value="railpack">Railpack</option>
              <option value="static">Static</option>
              <option value="dockerfile">Dockerfile</option>
              <option value="dockercompose">Docker Compose</option>
            </select>
          </label>
          <UiInput v-model="form.baseDirectory" label="Base directory" required />
          <template v-if="form.buildPack === 'dockercompose'">
            <UiInput
              v-model="form.dockerComposeLocation"
              label="Docker Compose location"
              required
            />
            <UiInput v-model="form.composeServiceName" label="Compose service" required />
          </template>
          <UiInput
            v-if="form.buildPack === 'dockerfile'"
            v-model="form.dockerfileLocation"
            label="Dockerfile location"
            required
          />
          <div class="rounded-md border border-info/30 bg-info/10 px-4 py-3 md:col-span-2">
            <p class="text-sm font-semibold text-ink">File build tetap dikelola di Git</p>
            <p class="mt-1 text-xs leading-5 text-muted">
              Editor ini menentukan file dan service yang digunakan Coolify. Isi Dockerfile atau
              Docker Compose tetap mengikuti repository dan branch di atas agar perubahan memiliki
              version history serta dapat direview.
            </p>
          </div>
        </div>

        <div v-else-if="activeTab === 'target'" class="grid gap-4 md:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Koneksi Coolify</span>
            <select
              v-model="form.coolifyServerId"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
              required
              @change="handleCoolifyServerChange"
            >
              <option value="" disabled>Pilih koneksi</option>
              <option v-for="server in catalog?.servers" :key="server.id" :value="server.id">
                {{ server.name }}
              </option>
            </select>
          </label>
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Server target</span>
            <select
              v-model="form.targetServerUuid"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
              required
            >
              <option value="" disabled>Pilih server</option>
              <option
                v-for="node in selectedConnection?.nodes"
                :key="node.id"
                :value="node.coolifyUuid"
              >
                {{ node.name }} · {{ node.status }}
              </option>
            </select>
          </label>
          <label class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Project Coolify</span>
            <select
              v-model="form.projectUuid"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="!form.coolifyServerId || loadingProjects"
              required
            >
              <option value="" disabled>
                {{ loadingProjects ? 'Memuat project…' : 'Pilih project' }}
              </option>
              <option v-for="project in projectOptions" :key="project.uuid" :value="project.uuid">
                {{ project.name }} · {{ project.uuid }}
              </option>
            </select>
            <span v-if="projectError" class="mt-1 block text-xs text-danger">
              {{ projectError }}
            </span>
          </label>
          <UiInput v-model="form.environmentName" label="Environment" required />
          <UiInput v-model="form.destinationUuid" label="Destination UUID (opsional)" />
        </div>

        <div v-else-if="activeTab === 'runtime'" class="space-y-5">
          <div class="grid gap-4 md:grid-cols-3">
            <UiInput v-model="form.portsExposes" label="Exposed port" />
            <UiInput v-model="form.healthcheckPath" label="Healthcheck path" />
            <UiInput v-model="form.healthcheckPort" label="Healthcheck port" />
          </div>

          <div class="rounded-md border border-line-strong bg-canvas/50">
            <div class="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h3 class="text-sm font-semibold text-ink">Environment keys</h3>
                <p class="mt-0.5 text-xs text-muted">
                  Simpan nama key saja. Nilai dan secret diisi saat provisioning.
                </p>
              </div>
              <UiButton type="button" variant="secondary" size="sm" @click="addEnvironmentKey">
                <Plus :size="13" /> Tambah key
              </UiButton>
            </div>
            <div v-if="form.environmentKeys.length" class="divide-y">
              <div
                v-for="(_key, index) in form.environmentKeys"
                :key="index"
                class="flex items-center gap-3 px-4 py-2"
              >
                <span class="w-6 shrink-0 text-right font-mono text-[10px] text-muted">
                  {{ index + 1 }}
                </span>
                <input
                  v-model="form.environmentKeys[index]"
                  class="focus-ring h-9 min-w-0 flex-1 rounded border border-line-strong bg-surface px-3 font-mono text-sm text-ink"
                  placeholder="APP_SECRET"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="focus-ring flex size-8 shrink-0 items-center justify-center rounded text-muted hover:bg-danger/10 hover:text-danger"
                  aria-label="Hapus environment key"
                  @click="removeEnvironmentKey(index)"
                >
                  <X :size="14" />
                </button>
              </div>
            </div>
            <p v-else class="px-4 py-6 text-center text-xs text-muted">
              Blueprint belum meminta environment variable manual.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="block">
              <span class="mb-2 block text-xs font-semibold text-muted">Database cluster</span>
              <select
                v-model="form.databaseClusterId"
                class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
              >
                <option value="">Tanpa database otomatis</option>
                <option
                  v-for="cluster in catalog?.databaseClusters"
                  :key="cluster.id"
                  :value="cluster.id"
                >
                  {{ cluster.name }}
                </option>
              </select>
            </label>
            <UiInput
              v-model="form.databaseEnvironmentKey"
              label="Database environment key"
              :disabled="!form.databaseClusterId"
              placeholder="DATABASE_URL"
            />
          </div>
        </div>

        <div v-else class="space-y-4">
          <label class="block">
            <span class="mb-2 flex items-center justify-between text-xs font-semibold text-muted">
              <span>Custom Traefik labels</span>
              <span class="font-mono font-normal">LABELS</span>
            </span>
            <textarea
              v-model="form.customLabels"
              rows="12"
              spellcheck="false"
              class="focus-ring w-full resize-y rounded-md border border-line-strong bg-[#080d13] px-4 py-3 font-mono text-[13px] leading-6 text-ink placeholder:text-muted/50"
              :placeholder="`coolify.traefik.middlewares=${BILLING_GATE_TRAEFIK_MIDDLEWARE}`"
            />
          </label>
          <label
            class="flex items-start gap-3 rounded-md border border-line-strong p-4 text-sm text-ink"
          >
            <input
              v-model="form.billingGateEnabled"
              type="checkbox"
              class="mt-0.5 size-4 accent-brand"
            />
            <span>
              <span class="block font-semibold">Aktifkan billing gate</span>
              <span class="mt-1 block text-xs leading-5 text-muted">
                Middleware {{ BILLING_GATE_TRAEFIK_MIDDLEWARE }} otomatis ditambahkan tanpa menimpa
                label lain. Request aplikasi akan melewati billing gate sebelum diteruskan ke
                container.
              </span>
            </span>
          </label>
        </div>
      </form>

      <template #footer>
        <div class="flex items-center justify-between gap-3">
          <p class="hidden text-xs text-muted sm:block">
            Tab {{ tabs.findIndex((tab) => tab.id === activeTab) + 1 }} dari {{ tabs.length }}
          </p>
          <div class="ml-auto flex gap-2">
            <UiButton variant="secondary" :disabled="saving" @click="showForm = false">
              Batal
            </UiButton>
            <UiButton
              type="submit"
              form="blueprint-form"
              :disabled="saving || loadingProjects || !form.projectUuid"
            >
              {{ saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Buat blueprint' }}
            </UiButton>
          </div>
        </div>
      </template>
    </UiDialog>

    <UiDialog
      v-if="deletingBlueprint"
      title="Hapus blueprint"
      description="Blueprint yang sudah memiliki riwayat provisioning tidak dapat dihapus dan harus dinonaktifkan dari menu Edit."
      size="md"
      :close-disabled="deleting"
      @close="deletingBlueprint = null"
    >
      <p class="text-sm leading-6 text-muted">
        Hapus <span class="font-semibold text-ink">{{ deletingBlueprint.name }}</span
        >? Aksi ini tidak dapat dibatalkan.
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="deleting" @click="deletingBlueprint = null">
            Batal
          </UiButton>
          <UiButton variant="danger" :disabled="deleting" @click="deleteBlueprint">
            <Trash2 :size="14" /> {{ deleting ? 'Menghapus…' : 'Hapus blueprint' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>
  </div>
</template>
