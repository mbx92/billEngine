<script setup lang="ts">
import { ArrowLeft, ExternalLink, Globe2, LoaderCircle, RefreshCw, Trash2 } from '@lucide/vue'
import type {
  ApiResourceDomain,
  ApiResourceDomainsResponse,
  ResourceDomainType,
} from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Domains · Billing Infra' })

const route = useRoute()
const resourceId = computed(() => String(route.params.id))
const hostname = ref('')
const type = ref<ResourceDomainType>('platform')
const composeServiceName = ref('')
const isPrimary = ref(false)
const saving = ref(false)
const busyIds = ref<string[]>([])
const message = ref<string | null>(null)
const actionError = ref<string | null>(null)

const { data, status, error, refresh } = await useFetch<ApiResourceDomainsResponse>(
  () => `/api/resources/${resourceId.value}/domains`,
)

const platformSuggestion = computed(() => {
  const name = data.value?.resource.name ?? 'app'
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug}.${data.value?.configuration.platformDomain ?? 'ocnetworks.web.id'}`
})

watch(type, (value) => {
  if (value === 'platform' && !hostname.value) hostname.value = platformSuggestion.value
})

function isBusy(id: string) {
  return busyIds.value.includes(id)
}

async function addDomain() {
  saving.value = true
  message.value = null
  actionError.value = null
  try {
    const response = await $fetch<{ data: ApiResourceDomain }>(
      `/api/resources/${resourceId.value}/domains`,
      {
        method: 'POST',
        body: {
          hostname: hostname.value,
          type: type.value,
          composeServiceName: composeServiceName.value || undefined,
          isPrimary: isPrimary.value,
        },
      },
    )
    await refresh()
    hostname.value = ''
    composeServiceName.value = ''
    message.value = `${response.data.hostname} dikirim ke Coolify untuk diprovisioning.`
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal menambahkan domain.')
  } finally {
    saving.value = false
  }
}

async function refreshDomain(domain: ApiResourceDomain) {
  busyIds.value.push(domain.id)
  message.value = null
  actionError.value = null
  try {
    await $fetch(`/api/resources/${resourceId.value}/domains/${domain.id}/refresh`, {
      method: 'POST',
    })
    await refresh()
    message.value = `Status ${domain.hostname} diperbarui.`
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal memperbarui status domain.')
  } finally {
    busyIds.value = busyIds.value.filter((id) => id !== domain.id)
  }
}

async function removeDomain(domain: ApiResourceDomain) {
  if (!confirm(`Lepas ${domain.hostname} dari Coolify dan BillEngine?`)) return
  busyIds.value.push(domain.id)
  message.value = null
  actionError.value = null
  try {
    await $fetch(`/api/resources/${resourceId.value}/domains/${domain.id}`, { method: 'DELETE' })
    await refresh()
    message.value = `${domain.hostname} telah dilepas.`
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal melepas domain.')
  } finally {
    busyIds.value = busyIds.value.filter((id) => id !== domain.id)
  }
}

function statusTone(status: ApiResourceDomain['status']) {
  if (status === 'active') return 'success'
  if (status === 'failed') return 'danger'
  return 'warning'
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <NuxtLink
      to="/resources"
      class="focus-ring mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-ink"
    >
      <ArrowLeft :size="15" aria-hidden="true" />
      Kembali ke resources
    </NuxtLink>

    <header class="mb-6">
      <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
        Infrastructure / domains
      </p>
      <h1 class="text-2xl font-semibold tracking-tight text-ink">
        {{ data?.resource.name || 'Resource domains' }}
      </h1>
      <p class="mt-2 text-sm text-muted">
        Domain platform dikelola melalui wildcard. Custom domain tetap dikelola customer dan
        diarahkan dengan CNAME.
      </p>
    </header>

    <p
      v-if="message"
      class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
      role="status"
    >
      {{ message }}
    </p>
    <p
      v-if="actionError"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <div v-if="status === 'pending'" class="space-y-4">
      <UiSkeleton height="13rem" />
      <UiSkeleton height="10rem" />
    </div>
    <UiEmptyState
      v-else-if="error || !data"
      title="Gagal memuat domain"
      description="Resource atau konfigurasi domain tidak dapat dibaca."
    />
    <template v-else>
      <UiCard class="mb-5">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 class="font-semibold text-ink">Tambahkan domain</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              Platform: satu level di bawah {{ data.configuration.platformDomain }}. Custom:
              customer memasang CNAME ke {{ data.configuration.cnameTarget }}.
            </p>
          </div>
          <UiBadge :tone="data.configuration.customDomainsEnabled ? 'success' : 'warning'">
            Cloudflare API {{ data.configuration.customDomainsEnabled ? 'ready' : 'belum siap' }}
          </UiBadge>
        </div>

        <form
          class="grid gap-4 lg:grid-cols-[170px_minmax(280px,1fr)_180px_auto]"
          @submit.prevent="addDomain"
        >
          <label>
            <span class="mb-2 block text-xs font-semibold text-muted">Tipe</span>
            <select
              v-model="type"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="platform">Platform</option>
              <option value="custom" :disabled="!data.configuration.customDomainsEnabled">
                Custom customer
              </option>
            </select>
          </label>
          <label>
            <span class="mb-2 block text-xs font-semibold text-muted">Hostname</span>
            <input
              v-model="hostname"
              required
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm text-ink"
              :placeholder="platformSuggestion"
            />
          </label>
          <label>
            <span class="mb-2 block text-xs font-semibold text-muted">Compose service</span>
            <input
              v-model="composeServiceName"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm text-ink"
              placeholder="Otomatis / app"
            />
          </label>
          <div class="flex items-end">
            <UiButton type="submit" :disabled="saving">
              <LoaderCircle v-if="saving" class="animate-spin" :size="15" aria-hidden="true" />
              <Globe2 v-else :size="15" aria-hidden="true" />
              {{ saving ? 'Provisioning…' : 'Tambahkan' }}
            </UiButton>
          </div>
          <label class="flex items-center gap-2 text-xs text-muted lg:col-span-4">
            <input v-model="isPrimary" type="checkbox" class="size-4 accent-brand" />
            Jadikan domain utama resource
          </label>
        </form>
      </UiCard>

      <UiCard :padded="false">
        <div class="border-b px-4 py-3">
          <h2 class="text-sm font-semibold text-ink">Managed domains</h2>
        </div>
        <UiEmptyState
          v-if="data.data.length === 0"
          title="Belum ada managed domain"
          description="Domain yang sudah ada di Coolify tidak diubah sampai didaftarkan dari halaman ini."
        />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[900px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Hostname</th>
                <th class="px-4 py-3 font-semibold">Tipe</th>
                <th class="px-4 py-3 font-semibold">Status</th>
                <th class="px-4 py-3 font-semibold">DNS / SSL</th>
                <th class="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="domain in data.data" :key="domain.id" class="border-b last:border-0">
                <td class="px-4 py-3">
                  <a
                    :href="`https://${domain.hostname}`"
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-ink hover:text-brand"
                  >
                    {{ domain.hostname }}
                    <ExternalLink :size="12" aria-hidden="true" />
                  </a>
                  <span v-if="domain.isPrimary" class="ml-2 text-[10px] text-brand">PRIMARY</span>
                  <p v-if="domain.cnameTarget" class="mt-1 font-mono text-[11px] text-muted">
                    CNAME → {{ domain.cnameTarget }}
                  </p>
                </td>
                <td class="px-4 py-3 text-xs text-muted">{{ domain.type }}</td>
                <td class="px-4 py-3">
                  <UiBadge :tone="statusTone(domain.status)">{{ domain.status }}</UiBadge>
                  <p v-if="domain.lastError" class="mt-1 text-[11px] text-danger">
                    {{ domain.lastError }}
                  </p>
                </td>
                <td class="px-4 py-3 font-mono text-[11px] text-muted">
                  <span v-if="domain.type === 'custom'">
                    host={{ domain.providerHostnameStatus || 'pending' }} · ssl={{
                      domain.providerSslStatus || 'pending'
                    }}
                  </span>
                  <span v-else>Wildcard platform</span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-2">
                    <UiButton
                      size="sm"
                      variant="secondary"
                      :disabled="isBusy(domain.id)"
                      @click="refreshDomain(domain)"
                    >
                      <RefreshCw
                        :class="{ 'animate-spin': isBusy(domain.id) }"
                        :size="14"
                        aria-hidden="true"
                      />
                      Refresh
                    </UiButton>
                    <UiButton
                      size="sm"
                      variant="ghost"
                      :disabled="isBusy(domain.id)"
                      @click="removeDomain(domain)"
                    >
                      <Trash2 :size="14" aria-hidden="true" />
                      Lepas
                    </UiButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </template>
  </div>
</template>
