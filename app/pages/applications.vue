<script setup lang="ts">
import { FileCode2, GitBranch, Hammer, Package, Plus, Rocket, ShieldCheck } from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Applications & Releases · OC Infrastructure' })

interface Registry {
  id: string
  name: string
  host: string
  username: string
  isActive: boolean
}

interface DeployableApplication {
  id: string
  name: string
  slug: string
  repositoryUrl: string
  defaultBranch: string
  dockerfilePath: string
  buildContext: string
  imageRepository: string
  registryId: string
  autoDeploy: boolean
}

interface Release {
  id: string
  applicationId: string
  version: string
  commitSha: string
  imageDigest: string
  imageReference: string
  createdAt: string
}

interface Resource {
  id: string
  name: string
  nodeName: string
  applicationId: string | null
  releaseId: string | null
  releasePolicy: 'manual' | 'track_latest'
  imageReference: string | null
  observedState: string
}

interface ApplicationBuild {
  id: string
  applicationId: string
  nodeName: string
  releaseId: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  version: string
  commitSha: string | null
  imageDigest: string | null
  logExcerpt: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

interface Catalog {
  registries: Registry[]
  applications: DeployableApplication[]
  releases: Release[]
  resources: Resource[]
  builds: ApplicationBuild[]
  builderAvailable: boolean
}

const format = useFormat()
const { data, status, error, refresh } = await useFetch<{ data: Catalog }>(
  '/api/infrastructure/applications',
)
const catalog = computed(() => data.value?.data)
const registries = computed(() => catalog.value?.registries ?? [])
const activeRegistries = computed(() => registries.value.filter((registry) => registry.isActive))
const applications = computed(() => catalog.value?.applications ?? [])
const resources = computed(() => catalog.value?.resources ?? [])
const builds = computed(() => catalog.value?.builds ?? [])

const showRegistryForm = ref(false)
const showApplicationForm = ref(false)
const releaseApplication = ref<DeployableApplication | null>(null)
const templateApplication = ref<DeployableApplication | null>(null)
const rolloutRelease = ref<Release | null>(null)
const selectedResourceIds = ref<string[]>([])
const trackLatest = ref(false)
const saving = ref(false)
const buildingApplicationId = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)

const registryForm = reactive({
  registryId: '',
  name: 'GitHub Container Registry',
  host: 'ghcr.io',
  username: '',
  token: '',
})
watch(
  () => registryForm.registryId,
  (registryId) => {
    const registry = registries.value.find((item) => item.id === registryId)
    if (!registry) {
      Object.assign(registryForm, {
        name: 'GitHub Container Registry',
        host: 'ghcr.io',
        username: '',
        token: '',
      })
      return
    }
    Object.assign(registryForm, {
      name: registry.name,
      host: registry.host,
      username: registry.username,
      token: '',
    })
  },
)
const applicationForm = reactive({
  name: '',
  slug: '',
  repositoryUrl: '',
  defaultBranch: 'main',
  dockerfilePath: 'Dockerfile',
  buildContext: '.',
  imageRepository: '',
  registryId: '',
  autoDeploy: false,
})
const releaseForm = reactive({ version: '', commitSha: '', imageDigest: '' })
const templateForm = reactive({
  name: '',
  slug: '',
  description: '',
  cpuMilli: '500',
  memoryMiB: '512',
  containerPort: '3000',
  healthcheckPath: '',
  environmentKeysText: '',
  secretKeysText: '',
  volumeName: '',
  volumeMountTarget: '',
  trackLatest: true,
})

watch(
  activeRegistries,
  (items) => {
    if (!items.some((registry) => registry.id === applicationForm.registryId)) {
      applicationForm.registryId = items[0]?.id ?? ''
    }
  },
  { immediate: true },
)

const selectedRegistry = computed(() =>
  activeRegistries.value.find((registry) => registry.id === applicationForm.registryId),
)
const imageRepositoryHint = computed(() => {
  const registry = selectedRegistry.value
  if (!registry) return 'Daftarkan registry aktif terlebih dahulu.'
  return `Contoh: ${registry.host}/${registry.username.toLowerCase()}/my-app · tanpa https:// atau tag.`
})

function releasesFor(applicationId: string) {
  return (catalog.value?.releases ?? [])
    .filter((release) => release.applicationId === applicationId)
    .slice(0, 5)
}

function buildsFor(applicationId: string) {
  return builds.value.filter((build) => build.applicationId === applicationId).slice(0, 3)
}

function activeBuild(applicationId: string) {
  return buildsFor(applicationId).find((build) => ['queued', 'running'].includes(build.status))
}

function buildTone(buildStatus: ApplicationBuild['status']) {
  if (buildStatus === 'succeeded') return 'success' as const
  if (buildStatus === 'failed' || buildStatus === 'cancelled') return 'danger' as const
  return 'warning' as const
}

function registryName(registryId: string) {
  return registries.value.find((registry) => registry.id === registryId)?.name ?? 'Unknown registry'
}

function shortDigest(digest: string) {
  return `${digest.slice(0, 15)}…${digest.slice(-8)}`
}

function clearFeedback() {
  actionMessage.value = null
  actionError.value = null
}

function openRegistryDialog() {
  registryForm.registryId = ''
  showRegistryForm.value = true
}

function closeRegistryDialog() {
  registryForm.registryId = ''
  showRegistryForm.value = false
}

async function createRegistry() {
  saving.value = true
  clearFeedback()
  try {
    if (registryForm.registryId) {
      await $fetch(`/api/infrastructure/registries/${registryForm.registryId}`, {
        method: 'PATCH',
        body: {
          name: registryForm.name,
          username: registryForm.username,
          token: registryForm.token,
        },
      })
      actionMessage.value = `Credential registry ${registryForm.host} berhasil diperbarui.`
    } else {
      await $fetch('/api/infrastructure/registries', { method: 'POST', body: registryForm })
      actionMessage.value = `Registry ${registryForm.host} berhasil disimpan.`
    }
    showRegistryForm.value = false
    Object.assign(registryForm, {
      registryId: '',
      name: 'GitHub Container Registry',
      host: 'ghcr.io',
      username: '',
      token: '',
    })
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal menyimpan registry.')
  } finally {
    saving.value = false
  }
}

async function createApplication() {
  saving.value = true
  clearFeedback()
  try {
    applicationForm.imageRepository = applicationForm.imageRepository
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
    await $fetch('/api/infrastructure/applications', { method: 'POST', body: applicationForm })
    actionMessage.value = `Application ${applicationForm.name} berhasil dibuat.`
    showApplicationForm.value = false
    Object.assign(applicationForm, {
      name: '',
      slug: '',
      repositoryUrl: '',
      defaultBranch: 'main',
      dockerfilePath: 'Dockerfile',
      buildContext: '.',
      imageRepository: '',
      registryId: activeRegistries.value[0]?.id ?? '',
      autoDeploy: false,
    })
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal membuat application.')
  } finally {
    saving.value = false
  }
}

function openRelease(application: DeployableApplication) {
  releaseApplication.value = application
  Object.assign(releaseForm, { version: '', commitSha: '', imageDigest: '' })
}

function openTemplate(application: DeployableApplication) {
  templateApplication.value = application
  Object.assign(templateForm, {
    name: `${application.name} Web`,
    slug: `${application.slug}-web`,
    description: `Deployment template untuk ${application.name}.`,
    cpuMilli: '500',
    memoryMiB: '512',
    containerPort: '3000',
    healthcheckPath: '',
    environmentKeysText: '',
    secretKeysText: '',
    volumeName: '',
    volumeMountTarget: '',
    trackLatest: true,
  })
}

function parseEnvironmentKeys(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n|,/)
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ]
}

async function createTemplate() {
  if (!templateApplication.value) return
  saving.value = true
  clearFeedback()
  try {
    await $fetch('/api/infrastructure/templates', {
      method: 'POST',
      body: {
        applicationId: templateApplication.value.id,
        name: templateForm.name,
        slug: templateForm.slug,
        description: templateForm.description || undefined,
        cpuMilli: Number(templateForm.cpuMilli),
        memoryMiB: Number(templateForm.memoryMiB),
        containerPort: Number(templateForm.containerPort),
        restartPolicy: 'unless-stopped',
        healthcheckPath: templateForm.healthcheckPath || undefined,
        environmentKeys: parseEnvironmentKeys(templateForm.environmentKeysText),
        secretKeys: parseEnvironmentKeys(templateForm.secretKeysText),
        ...(templateForm.volumeName && templateForm.volumeMountTarget
          ? {
              volume: {
                name: templateForm.volumeName,
                mountTarget: templateForm.volumeMountTarget,
              },
            }
          : {}),
        trackLatest: templateForm.trackLatest,
      },
    })
    actionMessage.value = `Template ${templateForm.name} berhasil dibuat dan siap digunakan dari halaman Templates.`
    templateApplication.value = null
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal membuat deployment template.')
  } finally {
    saving.value = false
  }
}

async function createRelease() {
  if (!releaseApplication.value) return
  saving.value = true
  clearFeedback()
  try {
    await $fetch(`/api/infrastructure/applications/${releaseApplication.value.id}/releases`, {
      method: 'POST',
      body: releaseForm,
    })
    actionMessage.value = `Release ${releaseForm.version} berhasil dicatat.`
    releaseApplication.value = null
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal mencatat release.')
  } finally {
    saving.value = false
  }
}

async function queueBuild(application: DeployableApplication) {
  buildingApplicationId.value = application.id
  clearFeedback()
  try {
    const response = await $fetch<{ data: { build: ApplicationBuild } }>(
      `/api/infrastructure/applications/${application.id}/builds`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': `application-build:${application.id}:${crypto.randomUUID()}`,
        },
        body: {},
      },
    )
    actionMessage.value = `Build ${response.data.build.version} masuk antrean pada builder node.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal mengantrekan build image.')
  } finally {
    buildingApplicationId.value = null
  }
}

function openRollout(release: Release) {
  rolloutRelease.value = release
  selectedResourceIds.value = resources.value
    .filter((resource) => resource.applicationId === release.applicationId)
    .map((resource) => resource.id)
  trackLatest.value = false
}

async function rollout() {
  if (!rolloutRelease.value) return
  saving.value = true
  clearFeedback()
  try {
    const response = await $fetch<{ data: { operationsQueued: number } }>(
      `/api/infrastructure/releases/${rolloutRelease.value.id}/rollout`,
      {
        method: 'POST',
        body: { resourceIds: selectedResourceIds.value, trackLatest: trackLatest.value },
      },
    )
    actionMessage.value = `${response.data.operationsQueued} redeploy masuk antrean untuk release ${rolloutRelease.value.version}.`
    rolloutRelease.value = null
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Rollout release gagal.')
  } finally {
    saving.value = false
  }
}

let buildRefreshTimer: number | undefined
onMounted(() => {
  buildRefreshTimer = window.setInterval(() => {
    if (
      document.visibilityState === 'visible' &&
      builds.value.some((build) => ['queued', 'running'].includes(build.status))
    ) {
      void refresh()
    }
  }, 5000)
})
onBeforeUnmount(() => {
  if (buildRefreshTimer) window.clearInterval(buildRefreshTimer)
})
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / Delivery
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Applications & Releases</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Build satu image per commit, lalu gunakan digest yang sama untuk banyak client.
          Konfigurasi dan data setiap client tetap terpisah pada resource masing-masing.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
        <UiButton variant="secondary" @click="openRegistryDialog"
          ><ShieldCheck :size="15" /> Registry</UiButton
        >
        <UiButton :disabled="!registries.length" @click="showApplicationForm = true"
          ><Plus :size="15" /> Application</UiButton
        >
      </div>
    </header>

    <p
      v-if="actionMessage"
      class="mb-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
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

    <UiCard v-if="status !== 'pending' && !registries.length" class="mb-4">
      <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 class="font-semibold text-ink">Hubungkan container registry terlebih dahulu</h2>
          <p class="mt-1 text-sm text-muted">
            Untuk native build ke GHCR, gunakan personal access token (classic) dengan scope
            <code>write:packages</code>. Jika registry hanya digunakan untuk deploy,
            <code>read:packages</code> sudah cukup.
          </p>
        </div>
        <UiButton @click="openRegistryDialog"><ShieldCheck :size="15" /> Tambah registry</UiButton>
      </div>
    </UiCard>

    <UiCard v-if="status === 'pending'" :padded="false"><UiSkeleton height="18rem" /></UiCard>
    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Catalog gagal dimuat"
        description="Pastikan migration database terbaru sudah dijalankan."
      />
    </UiCard>
    <UiCard v-else-if="!applications.length" :padded="false">
      <UiEmptyState
        title="Belum ada application"
        description="Tambahkan registry, lalu daftarkan repository dan lokasi image hasil build."
      />
    </UiCard>
    <div v-else class="grid gap-4 lg:grid-cols-2">
      <UiCard v-for="application in applications" :key="application.id">
        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 items-start gap-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
              ><Package :size="20"
            /></span>
            <div class="min-w-0">
              <h2 class="truncate font-semibold text-ink">{{ application.name }}</h2>
              <a
                :href="application.repositoryUrl"
                target="_blank"
                rel="noreferrer"
                class="mt-1 block truncate text-xs text-brand hover:underline"
                >{{ application.repositoryUrl }}</a
              >
            </div>
          </div>
          <UiBadge :tone="application.autoDeploy ? 'success' : 'neutral'">{{
            application.autoDeploy ? 'Auto rollout' : 'Manual rollout'
          }}</UiBadge>
        </div>
        <dl class="mt-4 space-y-2 border-t pt-4 text-xs">
          <div class="flex justify-between gap-4">
            <dt class="text-muted">Image</dt>
            <dd class="truncate font-mono text-ink">{{ application.imageRepository }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted">Build</dt>
            <dd class="font-mono text-ink">
              {{ application.defaultBranch }} · {{ application.dockerfilePath }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted">Registry</dt>
            <dd class="text-ink">{{ registryName(application.registryId) }}</dd>
          </div>
        </dl>
        <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">Native build</h3>
            <p class="mt-1 text-[11px] text-muted">
              GitHub source → builder node → {{ registryName(application.registryId) }}
            </p>
          </div>
          <UiButton
            size="sm"
            :disabled="
              !catalog?.builderAvailable ||
              !!activeBuild(application.id) ||
              buildingApplicationId === application.id
            "
            :title="
              !catalog?.builderAvailable
                ? 'Enroll builder node yang online terlebih dahulu'
                : activeBuild(application.id)
                  ? 'Build masih berjalan'
                  : 'Clone repository dan build image pada worker terpisah'
            "
            @click="queueBuild(application)"
          >
            <Hammer :size="13" />
            {{ buildingApplicationId === application.id ? 'Mengantrekan…' : 'Build image' }}
          </UiButton>
        </div>
        <div v-if="buildsFor(application.id).length" class="mt-2 space-y-2">
          <div
            v-for="build in buildsFor(application.id)"
            :key="build.id"
            class="rounded-md border border-line-strong px-3 py-2.5"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate font-mono text-xs font-semibold text-ink">
                  {{ build.version }}
                </p>
                <p class="mt-0.5 truncate text-[10px] text-muted">
                  {{ build.nodeName }} · {{ format.dateTime(build.createdAt) }}
                </p>
              </div>
              <UiBadge :tone="buildTone(build.status)" dot>{{ build.status }}</UiBadge>
            </div>
            <p v-if="build.errorMessage" class="mt-2 text-xs leading-5 text-danger">
              {{ build.errorMessage }}
            </p>
            <details v-if="build.logExcerpt" class="mt-2 text-xs">
              <summary class="cursor-pointer text-brand">Log build</summary>
              <pre
                class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-[10px] leading-4 text-muted"
                >{{ build.logExcerpt }}</pre>
            </details>
          </div>
        </div>
        <p
          v-else-if="!catalog?.builderAvailable"
          class="mt-2 rounded-md border border-dashed px-3 py-3 text-center text-xs text-muted"
        >
          Belum ada builder node online.
        </p>
        <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">Release terbaru</h3>
          <div class="flex gap-2">
            <UiButton
              size="sm"
              variant="secondary"
              :disabled="!releasesFor(application.id).length"
              @click="openTemplate(application)"
            >
              <FileCode2 :size="13" /> Buat template
            </UiButton>
            <UiButton size="sm" variant="secondary" @click="openRelease(application)">
              <Plus :size="13" /> Catat release
            </UiButton>
          </div>
        </div>
        <div
          v-if="releasesFor(application.id).length"
          class="mt-2 divide-y rounded-md border border-line-strong"
        >
          <div
            v-for="release in releasesFor(application.id)"
            :key="release.id"
            class="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <div class="min-w-0">
              <p class="font-mono text-xs font-semibold text-ink">{{ release.version }}</p>
              <p class="mt-0.5 truncate font-mono text-[10px] text-muted">
                {{ release.commitSha.slice(0, 12) }} · {{ shortDigest(release.imageDigest) }}
              </p>
            </div>
            <UiButton size="sm" variant="ghost" @click="openRollout(release)"
              ><Rocket :size="13" /> Rollout</UiButton
            >
          </div>
        </div>
        <p
          v-else
          class="mt-2 rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted"
        >
          Belum ada release. Jalankan native build atau kirim release dari CI.
        </p>
      </UiCard>
    </div>

    <UiCard class="mt-4">
      <div class="flex items-start gap-3">
        <GitBranch :size="19" class="mt-0.5 shrink-0 text-brand" />
        <div>
          <h2 class="text-sm font-semibold text-ink">Native builder dan CI eksternal</h2>
          <p class="mt-1 text-xs leading-5 text-muted">
            Tombol <strong>Build image</strong> menjalankan build pada node role builder. CI
            eksternal tetap dapat melakukan build + push, lalu POST ke
            <code class="text-ink">/api/infrastructure/releases/callback</code> menggunakan secret
            <code class="text-ink">NUXT_RELEASE_WEBHOOK_SECRET</code>. Contoh lengkap tersedia di
            <code class="text-ink">docs/APPLICATION-RELEASES.md</code>.
          </p>
        </div>
      </div>
    </UiCard>

    <UiDialog
      v-if="templateApplication"
      :title="`Template ${templateApplication.name}`"
      description="Template menyimpan profil runtime. Image diselesaikan dari release Application saat deployment dibuat."
      size="lg"
      :close-disabled="saving"
      @close="templateApplication = null"
    >
      <form id="template-create-form" class="space-y-5" @submit.prevent="createTemplate">
        <div class="grid gap-4 md:grid-cols-2">
          <UiInput v-model="templateForm.name" label="Nama template" required />
          <UiInput
            v-model="templateForm.slug"
            label="Slug template"
            required
            pattern="[a-z0-9][a-z0-9-]*"
          />
          <UiInput v-model="templateForm.description" class="md:col-span-2" label="Deskripsi" />
          <UiInput
            v-model="templateForm.cpuMilli"
            label="CPU (millicore)"
            type="number"
            min="50"
            required
          />
          <UiInput
            v-model="templateForm.memoryMiB"
            label="Memory (MiB)"
            type="number"
            min="16"
            required
          />
          <UiInput
            v-model="templateForm.containerPort"
            label="Container port"
            type="number"
            min="1"
            max="65535"
            required
          />
          <UiInput
            v-model="templateForm.healthcheckPath"
            label="Healthcheck path"
            placeholder="/health"
          />
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Environment keys</span>
            <textarea
              v-model="templateForm.environmentKeysText"
              rows="4"
              placeholder="APP_URL&#10;PUBLIC_NAME"
              class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-sm text-ink"
            />
            <span class="mt-1.5 block text-xs text-muted">
              Satu key per baris; nilainya diminta saat deploy.
            </span>
          </label>
          <label class="block">
            <span class="mb-2 block text-xs font-semibold text-muted">Secret keys</span>
            <textarea
              v-model="templateForm.secretKeysText"
              rows="4"
              placeholder="DATABASE_URL&#10;API_SECRET"
              class="focus-ring w-full rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-sm text-ink"
            />
            <span class="mt-1.5 block text-xs text-muted">
              Disimpan terenkripsi dan dikirim sebagai secret file.
            </span>
          </label>
          <UiInput
            v-model="templateForm.volumeName"
            label="Persistent volume name"
            placeholder="data"
          />
          <UiInput
            v-model="templateForm.volumeMountTarget"
            label="Volume mount target"
            placeholder="/app/data"
          />
        </div>
        <label class="flex items-start gap-3 rounded-md border border-line-strong p-3">
          <input
            v-model="templateForm.trackLatest"
            type="checkbox"
            class="mt-0.5 size-4 accent-current"
          />
          <span>
            <strong class="block text-sm text-ink">Track release berikutnya</strong>
            <span class="mt-1 block text-xs text-muted">
              Resource dari template ditautkan ke Application dan dapat ikut auto deploy release
              baru.
            </span>
          </span>
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="templateApplication = null">
            Batal
          </UiButton>
          <UiButton type="submit" form="template-create-form" :disabled="saving">
            <FileCode2 :size="14" /> {{ saving ? 'Menyimpan…' : 'Buat template' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiDialog
      v-if="showRegistryForm"
      title="Registry credential"
      description="Token dienkripsi di database dan hanya dikirim ke agent saat image pull atau build push."
      :close-disabled="saving"
      @close="closeRegistryDialog"
    >
      <form id="registry-form" class="grid gap-4" @submit.prevent="createRegistry">
        <label v-if="registries.length" class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Mode</span>
          <select
            v-model="registryForm.registryId"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="">Tambah registry baru</option>
            <option v-for="registry in registries" :key="registry.id" :value="registry.id">
              Perbarui {{ registry.name }} · {{ registry.host }}
            </option>
          </select>
        </label>
        <UiInput v-model="registryForm.name" label="Nama" required />
        <UiInput
          v-model="registryForm.host"
          label="Registry host"
          required
          placeholder="ghcr.io"
          :disabled="!!registryForm.registryId"
        />
        <UiInput
          v-model="registryForm.username"
          label="Username / owner"
          required
          autocomplete="username"
        />
        <UiInput
          v-model="registryForm.token"
          label="Access token"
          type="password"
          required
          autocomplete="new-password"
        />
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="closeRegistryDialog"
            >Batal</UiButton
          ><UiButton type="submit" form="registry-form" :disabled="saving">{{
            saving
              ? 'Menyimpan…'
              : registryForm.registryId
                ? 'Perbarui credential'
                : 'Simpan registry'
          }}</UiButton>
        </div></template
      >
    </UiDialog>

    <UiDialog
      v-if="showApplicationForm"
      title="Tambah application"
      description="Satu definisi source dan image dapat dipakai oleh banyak resource/client."
      size="lg"
      :close-disabled="saving"
      @close="showApplicationForm = false"
    >
      <form
        id="application-form"
        class="grid gap-4 md:grid-cols-2"
        @submit.prevent="createApplication"
      >
        <UiInput v-model="applicationForm.name" label="Nama" required />
        <UiInput
          v-model="applicationForm.slug"
          label="Slug untuk callback"
          required
          pattern="[a-z0-9][a-z0-9-]*"
        />
        <UiInput
          v-model="applicationForm.repositoryUrl"
          class="md:col-span-2"
          label="Git repository URL"
          type="url"
          hint="Native builder mendukung repository public HTTPS github.com."
          required
        />
        <UiInput v-model="applicationForm.defaultBranch" label="Default branch" required />
        <UiInput v-model="applicationForm.dockerfilePath" label="Dockerfile" required />
        <UiInput v-model="applicationForm.buildContext" label="Build context" required />
        <label class="block"
          ><span class="mb-2 block text-xs font-semibold text-muted">Registry</span
          ><select
            v-model="applicationForm.registryId"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option v-for="registry in activeRegistries" :key="registry.id" :value="registry.id">
              {{ registry.name }} · {{ registry.host }}
            </option>
          </select></label
        >
        <UiInput
          v-model="applicationForm.imageRepository"
          class="md:col-span-2"
          label="Image repository tanpa tag"
          :hint="imageRepositoryHint"
          required
          placeholder="ghcr.io/owner/my-app"
        />
        <label class="flex items-start gap-3 rounded-md border border-line-strong p-3 md:col-span-2"
          ><input
            v-model="applicationForm.autoDeploy"
            type="checkbox"
            class="mt-0.5 size-4 accent-current"
          /><span
            ><strong class="block text-sm text-ink">Auto deploy tracked resources</strong
            ><span class="mt-1 block text-xs text-muted"
              >Release callback otomatis meredeploy resource yang sudah memilih track latest.</span
            ></span
          ></label
        >
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="showApplicationForm = false"
            >Batal</UiButton
          ><UiButton type="submit" form="application-form" :disabled="saving">{{
            saving ? 'Menyimpan…' : 'Buat application'
          }}</UiButton>
        </div></template
      >
    </UiDialog>

    <UiDialog
      v-if="releaseApplication"
      :title="`Catat release ${releaseApplication.name}`"
      description="Biasanya data ini dikirim otomatis oleh GitHub Actions setelah image berhasil di-push."
      :close-disabled="saving"
      @close="releaseApplication = null"
    >
      <form id="release-form" class="grid gap-4" @submit.prevent="createRelease">
        <UiInput
          v-model="releaseForm.version"
          label="Version"
          required
          placeholder="v1.4.0 atau build-123"
        />
        <UiInput
          v-model="releaseForm.commitSha"
          label="Git commit SHA"
          required
          pattern="[a-fA-F0-9]{7,64}"
        />
        <UiInput
          v-model="releaseForm.imageDigest"
          label="Image digest"
          required
          placeholder="sha256:…"
        />
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="releaseApplication = null"
            >Batal</UiButton
          ><UiButton type="submit" form="release-form" :disabled="saving">{{
            saving ? 'Menyimpan…' : 'Catat release'
          }}</UiButton>
        </div></template
      >
    </UiDialog>

    <UiDialog
      v-if="rolloutRelease"
      :title="`Rollout ${rolloutRelease.version}`"
      description="Pilih instance client yang akan memakai image digest ini."
      :close-disabled="saving"
      @close="rolloutRelease = null"
    >
      <form id="rollout-form" class="space-y-4" @submit.prevent="rollout">
        <div class="max-h-64 divide-y overflow-y-auto rounded-md border border-line-strong">
          <label
            v-for="resource in resources"
            :key="resource.id"
            class="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-surface-raised"
          >
            <input
              v-model="selectedResourceIds"
              type="checkbox"
              :value="resource.id"
              class="size-4 accent-current"
            />
            <span class="min-w-0 flex-1"
              ><strong class="block truncate text-sm text-ink">{{ resource.name }}</strong
              ><span class="block truncate text-xs text-muted"
                >{{ resource.nodeName }} · {{ resource.observedState }}</span
              ></span
            >
            <UiBadge v-if="resource.applicationId === rolloutRelease.applicationId" tone="info"
              >Linked</UiBadge
            >
          </label>
        </div>
        <label class="flex items-start gap-3 rounded-md border border-line-strong p-3"
          ><input v-model="trackLatest" type="checkbox" class="mt-0.5 size-4 accent-current" /><span
            ><strong class="block text-sm text-ink">Track release berikutnya</strong
            ><span class="mt-1 block text-xs text-muted"
              >Resource terpilih otomatis ikut release baru jika auto deploy aktif pada
              application.</span
            ></span
          ></label
        >
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="rolloutRelease = null"
            >Batal</UiButton
          ><UiButton
            type="submit"
            form="rollout-form"
            :disabled="saving || !selectedResourceIds.length"
            ><Rocket :size="14" /> {{ saving ? 'Menjadwalkan…' : 'Rollout' }}</UiButton
          >
        </div></template
      >
    </UiDialog>
  </div>
</template>
