<script setup lang="ts">
import { Box, Database, KeyRound, RefreshCw, Rocket, Server } from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth', alias: ['/templates'] })
useHead({ title: 'Templates · Billing Infra' })

interface TemplateParameter {
  key: string
  label: string
  environmentKey: string
  type: 'string' | 'secret'
  required: boolean
  generated: boolean
  defaultValue?: string
  help?: string
}

interface InfrastructureTemplate {
  id: string
  slug: string
  name: string
  description: string | null
  category: 'application' | 'database' | 'cache'
  version: number
  isBuiltin: boolean
  definition: {
    engine: 'generic' | 'postgresql' | 'mysql' | 'redis'
    resourceKind: 'application' | 'database'
    spec: {
      source: { type: 'image'; reference: string }
      ports: Array<{ containerPort: number; protocol: 'tcp' | 'udp' }>
      volumes: Array<{ name: string; mountTarget: string; kind: 'ephemeral' | 'persistent' }>
    }
    parameters: TemplateParameter[]
  }
}

interface InfrastructureNode {
  id: string
  name: string
  environment: string
  status: 'enrolling' | 'online' | 'degraded' | 'offline' | 'revoked' | 'unknown'
  isActive: boolean
  isDraining: boolean
  agentVersion: string | null
}

const [{ data: templateResponse, status, error, refresh }, { data: nodeResponse }] =
  await Promise.all([
    useFetch<{ data: InfrastructureTemplate[] }>('/api/infrastructure/templates'),
    useFetch<{ data: InfrastructureNode[] }>('/api/infrastructure/nodes'),
  ])

const templates = computed(() => templateResponse.value?.data ?? [])
const nodes = computed(() =>
  (nodeResponse.value?.data ?? []).filter(
    (node) =>
      node.isActive &&
      !node.isDraining &&
      ['online', 'degraded'].includes(node.status) &&
      supportsTemplateSecrets(node.agentVersion),
  ),
)
const selectedTemplate = ref<InfrastructureTemplate | null>(null)
const deploying = ref(false)
const actionMessage = ref<string | null>(null)
const actionError = ref<string | null>(null)
const form = reactive({
  nodeId: '',
  name: '',
  hostPort: '',
  classification: 'internal' as 'billable' | 'internal' | 'ignored',
  values: {} as Record<string, string>,
})

function openDeploy(template: InfrastructureTemplate) {
  actionMessage.value = null
  actionError.value = null
  selectedTemplate.value = template
  form.nodeId = nodes.value[0]?.id ?? ''
  form.name = `${template.slug}-01`
  form.hostPort = String(defaultHostPort(template))
  form.classification = 'internal'
  form.values = Object.fromEntries(
    template.definition.parameters.map((parameter) => [parameter.key, parameter.defaultValue ?? '']),
  )
}

function defaultHostPort(template: InfrastructureTemplate) {
  if (template.definition.engine === 'postgresql') return 5432
  if (template.definition.engine === 'mysql') return 3306
  if (template.definition.engine === 'redis') return 6379
  return template.definition.spec.ports[0]?.containerPort ?? 3000
}

async function deployTemplate() {
  if (!selectedTemplate.value) return
  deploying.value = true
  actionMessage.value = null
  actionError.value = null
  const template = selectedTemplate.value
  try {
    await $fetch(`/api/infrastructure/templates/${template.id}/deploy`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `template:${template.id}:${crypto.randomUUID()}` },
      body: {
        nodeId: form.nodeId,
        name: form.name,
        hostPort: Number(form.hostPort),
        classification: form.classification,
        values: form.values,
      },
    })
    selectedTemplate.value = null
    actionMessage.value = `${template.name} sedang dideploy. Progresnya dapat dilihat di halaman Resources.`
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Template gagal dideploy.')
  } finally {
    deploying.value = false
  }
}

function categoryLabel(category: InfrastructureTemplate['category']) {
  if (category === 'database') return 'Database'
  if (category === 'cache') return 'Cache'
  return 'Application'
}

function supportsTemplateSecrets(version: string | null) {
  if (!version) return false
  const [major = 0, minor = 0] = version.split('.').map(Number)
  return major > 0 || minor >= 3
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Infrastructure / Templates
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Deployment Templates</h1>
        <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Deploy service yang sama berkali-kali ke Ubuntu node. Setiap deployment memperoleh
          konfigurasi, secret, container, dan volume persisten yang terpisah.
        </p>
      </div>
      <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
        <RefreshCw :size="15" /> Refresh
      </UiButton>
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
    <p
      v-if="status !== 'pending' && !nodes.length"
      class="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      Template database membutuhkan OC Agent 0.3.0 atau lebih baru. Buka halaman Ubuntu Nodes lalu
      jalankan kembali perintah installer pada server; identity node lama tetap digunakan.
    </p>

    <div v-if="status === 'pending'" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <UiSkeleton v-for="item in 3" :key="item" height="17rem" />
    </div>
    <UiCard v-else-if="error" :padded="false">
      <UiEmptyState
        title="Template gagal dimuat"
        description="Pastikan migration database terbaru sudah dijalankan."
      />
    </UiCard>
    <UiCard v-else-if="!templates.length" :padded="false">
      <UiEmptyState title="Belum ada template" description="Jalankan migration database terbaru." />
    </UiCard>
    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <UiCard v-for="template in templates" :key="template.id">
        <div class="flex items-start justify-between gap-4">
          <div class="flex size-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Database v-if="template.category === 'database'" :size="20" />
            <Box v-else :size="20" />
          </div>
          <div class="flex gap-2">
            <UiBadge tone="info">{{ categoryLabel(template.category) }}</UiBadge>
            <UiBadge v-if="template.isBuiltin" tone="neutral">Built-in</UiBadge>
          </div>
        </div>
        <h2 class="mt-4 text-base font-semibold text-ink">{{ template.name }}</h2>
        <p class="mt-1 min-h-10 text-sm leading-5 text-muted">{{ template.description }}</p>
        <dl class="mt-4 space-y-2 border-t pt-4 text-xs">
          <div class="flex justify-between gap-3">
            <dt class="text-muted">Image</dt>
            <dd class="truncate font-mono text-ink">{{ template.definition.spec.source.reference }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">Container port</dt>
            <dd class="font-mono text-ink">
              {{ template.definition.spec.ports[0]?.containerPort ?? '—' }}
            </dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt class="text-muted">Storage</dt>
            <dd class="text-ink">
              {{ template.definition.spec.volumes.length ? 'Persistent volume' : 'Ephemeral' }}
            </dd>
          </div>
        </dl>
        <UiButton class="mt-5 w-full" :disabled="!nodes.length" @click="openDeploy(template)">
          <Rocket :size="15" /> Deploy
        </UiButton>
      </UiCard>
    </div>

    <UiDialog
      v-if="selectedTemplate"
      :title="`Deploy ${selectedTemplate.name}`"
      description="Password dapat diisi sendiri atau dikosongkan agar dibuat otomatis. Nilainya tidak akan ditampilkan kembali."
      size="lg"
      :close-disabled="deploying"
      @close="selectedTemplate = null"
    >
      <form id="template-deploy-form" class="space-y-5" @submit.prevent="deployTemplate">
        <div class="grid gap-4 md:grid-cols-2">
          <label class="block md:col-span-2">
            <span class="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
              <Server :size="13" /> Ubuntu node
            </span>
            <select
              v-model="form.nodeId"
              required
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="" disabled>Pilih node</option>
              <option v-for="node in nodes" :key="node.id" :value="node.id">
                {{ node.name }} · {{ node.environment }} · {{ node.status }}
              </option>
            </select>
          </label>
          <UiInput v-model="form.name" label="Nama resource" required pattern="[a-z0-9][a-z0-9-]*" />
          <UiInput v-model="form.hostPort" label="Host port" type="number" min="1" max="65535" required />
          <label class="block md:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Classification</span>
            <select
              v-model="form.classification"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="internal">Internal</option>
              <option value="billable">Billable</option>
              <option value="ignored">Ignored</option>
            </select>
          </label>
        </div>

        <div class="rounded-md border border-line-strong">
          <div class="border-b px-4 py-3">
            <h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
              <KeyRound :size="15" /> Parameter
            </h3>
            <p class="mt-1 text-xs text-muted">Secret disimpan terenkripsi dan dikirim ke agent saat operasi berjalan.</p>
          </div>
          <div class="grid gap-4 p-4 md:grid-cols-2">
            <UiInput
              v-for="parameter in selectedTemplate.definition.parameters"
              :key="parameter.key"
              v-model="form.values[parameter.key]"
              :label="parameter.label"
              :type="parameter.type === 'secret' ? 'password' : 'text'"
              :required="parameter.required && !parameter.generated"
              :placeholder="parameter.generated ? 'Buat otomatis' : undefined"
              :hint="parameter.help"
              :autocomplete="parameter.type === 'secret' ? 'new-password' : 'off'"
            />
          </div>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="deploying" @click="selectedTemplate = null">
            Batal
          </UiButton>
          <UiButton type="submit" form="template-deploy-form" :disabled="deploying || !nodes.length">
            <Rocket :size="15" /> {{ deploying ? 'Menjadwalkan…' : 'Deploy template' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>
  </div>
</template>
