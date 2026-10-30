<script setup lang="ts">
import {
  ArrowRight,
  Cloud,
  Copy,
  ExternalLink,
  Globe,
  Link,
  Network,
  Plus,
  Server,
} from '@lucide/vue'
import type { ApplicationDomains } from '#shared/types/application-domains'
import type { ApiCloudflareTunnel } from '#shared/types/api'
import { connectApplicationDomainSchema } from '#shared/schemas/application-domains'
import { apiErrorMessage } from '~/lib/api-error'
import { copyText } from '~/lib/clipboard'

const props = defineProps<{ resourceId: string }>()
const emit = defineEmits<{ saved: []; activity: [] }>()
const { data, status, error, refresh } = await useFetch<{ data: ApplicationDomains }>(
  `/api/infrastructure/resources/${props.resourceId}/domains`,
  { key: `application-domains:${props.resourceId}` },
)
const overview = computed(() => data.value?.data)
const showConnect = ref(false)
const saving = ref(false)
const formError = ref('')
const message = ref('')
const connectedTunnel = ref<ApiCloudflareTunnel | null>(null)
const connectedHostname = ref('')
const originMode = ref('custom')
const form = reactive({
  hostname: '',
  tunnelId: '',
  origin: '',
  targetPort: '',
  expectedRevision: 1,
})
let attempt: { body: string; key: string } | null = null
const selectedTunnel = computed(() =>
  overview.value?.tunnels.find((tunnel) => tunnel.id === form.tunnelId),
)
const toast = useToast()
type Domain = ApplicationDomains['domains'][number]

function dnsTunnel(domain: Domain) {
  if (domain.dns.type !== 'CNAME') return undefined
  const target = domain.dns.target?.toLowerCase().replace(/\.$/, '')
  return overview.value?.tunnels.find((tunnel) => tunnel.expectedDnsTarget === target)
}
function displayTunnel(domain: Domain) {
  const fromDns = dnsTunnel(domain)
  if (fromDns) return fromDns
  const unique = new Map(domain.matches.map((match) => [match.tunnel.id, match.tunnel]))
  return unique.size === 1 ? [...unique.values()][0] : undefined
}
function tunnelTone(status: string) {
  return status === 'healthy'
    ? ('success' as const)
    : status === 'down'
      ? ('danger' as const)
      : ('warning' as const)
}
function openConnect(domain?: Domain) {
  const preferred = domain ? dnsTunnel(domain) : undefined
  Object.assign(form, {
    hostname: domain?.hostname ?? '',
    tunnelId: preferred?.configSource === 'cloudflare' ? preferred.id : '',
    targetPort: String(domain?.targetPort ?? overview.value?.resource.ports[0] ?? ''),
    origin: '',
    expectedRevision: overview.value?.resource.revision ?? 1,
  })
  originMode.value = 'custom'
  formError.value = ''
  attempt = null
  showConnect.value = true
}
watch(originMode, (mode) => {
  form.origin =
    mode === 'docker' ? 'http://oc-gateway:80' : mode === 'host' ? 'http://localhost:80' : ''
})
async function copy(value: string) {
  try {
    await copyText(value)
    toast.success('Target DNS disalin.')
  } catch {
    toast.error('Nilai belum dapat disalin. Salin target DNS secara manual.')
  }
}
async function connect() {
  if (saving.value) return
  formError.value = ''
  const parsed = connectApplicationDomainSchema.safeParse({
    ...form,
    targetPort: Number(form.targetPort),
  })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Periksa pengaturan domain.'
    return
  }
  const body = JSON.stringify(parsed.data)
  if (attempt?.body !== body) attempt = { body, key: `domain:${crypto.randomUUID()}` }
  saving.value = true
  try {
    const response = await $fetch<{ data: { operationId: string } }>(
      `/api/infrastructure/resources/${props.resourceId}/domains`,
      { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: parsed.data },
    )
    connectedTunnel.value = selectedTunnel.value ?? null
    connectedHostname.value = parsed.data.hostname
    message.value = `Route tunnel tersimpan. Konfigurasi Traefik masuk antrean (${response.data.operationId.slice(0, 8)}). DNS belum diubah.`
    showConnect.value = false
    attempt = null
    emit('saved')
    await refresh()
  } catch (failure) {
    formError.value = apiErrorMessage(
      failure,
      'Domain belum berhasil dihubungkan. Muat ulang untuk memeriksa kondisi terakhir sebelum mencoba lagi.',
    )
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="min-w-0 space-y-4">
    <InfrastructurePageHeader
      :level="2"
      title="Domain & tunnel"
      description="Lihat jalur domain ke aplikasi dan pilih tunnel yang meneruskan trafiknya."
    >
      <UiRefreshButton :action="refresh" :pending="status === 'pending'" />
      <UiButton
        :disabled="!overview?.configured || !overview.resource.ports.length"
        @click="openConnect()"
        ><Plus :size="15" aria-hidden="true" /> Hubungkan domain</UiButton
      >
    </InfrastructurePageHeader>
    <div
      v-if="message"
      role="status"
      class="space-y-3 rounded-md border border-success/25 bg-success/5 p-4 text-sm"
    >
      <p class="text-success">{{ message }}</p>
      <p v-if="connectedTunnel" class="break-all text-xs leading-5 text-muted">
        Atur DNS CNAME <strong>{{ connectedHostname }}</strong> ke
        <strong>{{ connectedTunnel.expectedDnsTarget }}</strong> dengan proxy Cloudflare aktif,
        kemudian muat ulang.
      </p>
      <UiButton variant="secondary" size="sm" @click="emit('activity')"
        >Lihat aktivitas konfigurasi</UiButton
      >
    </div>
    <p
      v-if="error"
      role="alert"
      class="rounded-md border border-danger/25 bg-danger/5 p-3 text-sm text-danger"
    >
      {{
        apiErrorMessage(error, 'Informasi domain dan tunnel belum dapat dimuat. Coba muat ulang.')
      }}
    </p>
    <UiSkeleton v-if="status === 'pending' && !overview" height="20rem" />
    <template v-if="overview">
      <p
        v-if="!overview.configured"
        class="rounded-md border border-warning/25 bg-warning/5 p-4 text-sm text-warning"
      >
        Koneksi akun Cloudflare belum dikonfigurasi. Atur koneksi Cloudflare di server BillEngine
        untuk membaca dan memilih tunnel.
      </p>
      <UiEmptyState
        v-if="!overview.domains.length"
        title="Belum ada domain aplikasi"
        description="Hubungkan domain ke tunnel, lalu arahkan DNS-nya ke tunnel tersebut. Route Traefik akan meneruskan trafik ke container aplikasi."
      >
        <UiButton
          :disabled="!overview.configured || !overview.resource.ports.length"
          @click="openConnect()"
          ><Link :size="15" aria-hidden="true" /> Hubungkan domain pertama</UiButton
        >
      </UiEmptyState>
      <UiCard v-for="domain in overview.domains" :key="domain.hostname" :padded="false">
        <div class="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
          <div class="flex min-w-0 items-start gap-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-brand/20 bg-brand/10 text-brand"
              ><Globe :size="20" aria-hidden="true"
            /></span>
            <div class="min-w-0">
              <h3 class="break-all text-base font-semibold">{{ domain.hostname }}</h3>
              <div class="mt-2 flex flex-wrap gap-2">
                <UiBadge>{{
                  domain.source === 'route'
                    ? 'Domain deployment'
                    : 'Dari APP_URL · belum tertaut ke Traefik'
                }}</UiBadge
                ><UiBadge
                  v-if="domain.routeStatus"
                  :tone="
                    domain.routeStatus === 'active'
                      ? 'success'
                      : domain.routeStatus === 'failed'
                        ? 'danger'
                        : 'warning'
                  "
                  >Traefik: {{ domain.routeStatus }}</UiBadge
                >
              </div>
            </div>
          </div>
          <a
            :href="`https://${domain.hostname}`"
            target="_blank"
            rel="noopener noreferrer"
            class="focus-ring inline-flex items-center gap-2 rounded text-xs text-brand hover:underline"
            ><ExternalLink :size="14" aria-hidden="true" /> Buka domain</a
          >
        </div>
        <div class="space-y-4 border-t p-4 sm:p-5">
          <div
            class="grid min-w-0 gap-3 rounded-md border bg-surface-raised/50 p-4 lg:grid-cols-[1fr_auto_1fr]"
          >
            <div class="min-w-0">
              <p class="mb-2 flex items-center gap-2 text-xs text-muted">
                <Cloud :size="15" aria-hidden="true" />
                {{ dnsTunnel(domain) ? 'Tunnel tujuan DNS' : 'Tunnel dengan route domain' }}
              </p>
              <p class="break-words text-sm font-semibold">
                {{
                  displayTunnel(domain)?.name ??
                  (domain.matches.length ? 'Lebih dari satu tunnel' : 'Belum ditemukan')
                }}
              </p>
              <UiBadge
                v-if="displayTunnel(domain)"
                class="mt-2"
                :tone="tunnelTone(displayTunnel(domain)!.status)"
                dot
                >{{ displayTunnel(domain)!.status }}</UiBadge
              >
              <p v-if="!dnsTunnel(domain)" class="mt-1 text-xs leading-5 text-muted">
                Berdasarkan konfigurasi route; tunnel tujuan DNS belum terverifikasi.
              </p>
            </div>
            <ArrowRight
              :size="17"
              class="self-center text-muted rotate-90 lg:rotate-0"
              aria-hidden="true"
            />
            <div class="min-w-0">
              <p class="mb-2 flex items-center gap-2 text-xs text-muted">
                <Server :size="15" aria-hidden="true" /> Server aplikasi
              </p>
              <p class="break-words text-sm font-semibold">{{ overview.resource.nodeName }}</p>
              <p class="mt-1 break-words text-xs text-muted">
                {{ overview.resource.name
                }}<template v-if="domain.targetPort"> · port {{ domain.targetPort }}</template>
              </p>
              <p class="mt-1 text-xs text-muted">Gateway: {{ overview.resource.gatewayStatus }}</p>
            </div>
          </div>
          <div class="rounded-md border p-3 text-xs leading-5">
            <p class="font-semibold">DNS domain</p>
            <p v-if="domain.dns.status === 'record'" class="mt-1 break-all text-muted">
              {{ domain.dns.type }} → {{ domain.dns.target }} ·
              {{ domain.dns.proxied ? 'Proxy aktif' : 'Proxy tidak aktif' }}
            </p>
            <p v-else class="mt-1 text-muted">
              {{
                domain.dns.status === 'missing'
                  ? 'Record khusus hostname tidak ditemukan pada zona yang dikonfigurasi. Wildcard DNS atau zona lain belum diverifikasi.'
                  : 'DNS belum dapat diperiksa. Akses baca DNS dan zona Cloudflare diperlukan; route tunnel tetap ditampilkan jika tersedia.'
              }}
            </p>
          </div>
          <h4 class="flex items-center gap-2 text-sm font-semibold">
            <Network :size="16" class="text-brand" aria-hidden="true" /> Route tunnel yang cocok
          </h4>
          <p
            v-if="
              dnsTunnel(domain) &&
              !domain.matches.some((match) => match.tunnel.id === dnsTunnel(domain)?.id)
            "
            class="rounded-md border border-warning/25 bg-warning/5 p-3 text-xs leading-5 text-warning"
          >
            DNS menunjuk ke {{ dnsTunnel(domain)?.name }}, tetapi route domain pada tunnel tersebut
            belum ditemukan atau belum dapat dibaca.
          </p>
          <div
            v-for="match in domain.matches"
            :key="`${match.tunnel.id}:${match.route.hostname}:${match.route.path}`"
            class="space-y-3 rounded-md border p-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="inline-flex min-w-0 items-center gap-2 text-sm font-semibold"
                ><Cloud :size="16" class="shrink-0 text-brand" aria-hidden="true" />{{
                  match.tunnel.name
                }}</span
              >
              <div class="flex flex-wrap gap-2">
                <UiBadge :tone="tunnelTone(match.tunnel.status)" dot>{{
                  match.tunnel.status
                }}</UiBadge
                ><UiBadge v-if="dnsTunnel(domain)?.id === match.tunnel.id" tone="info"
                  >Tujuan DNS</UiBadge
                >
              </div>
            </div>
            <dl class="grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt class="text-muted">Hostname / path pada tunnel</dt>
                <dd class="mt-1 break-all font-mono">
                  {{ match.route.hostname || 'Catch-all'
                  }}{{ match.route.path ? ` · ${match.route.path}` : '' }}
                </dd>
              </div>
              <div>
                <dt class="text-muted">Origin dari cloudflared</dt>
                <dd class="mt-1 break-all font-mono">{{ match.route.service }}</dd>
              </div>
            </dl>
            <p
              v-if="!/^https?:\/\//.test(match.route.service)"
              class="text-xs leading-5 text-warning"
            >
              Origin ini bukan gateway HTTP/HTTPS aplikasi. Periksa service pada route tunnel.
            </p>
            <p
              v-if="match.route.path || match.route.httpHostHeader"
              class="text-xs leading-5 text-warning"
            >
              Route memiliki {{ match.route.path ? 'pembatasan path' : ''
              }}{{ match.route.path && match.route.httpHostHeader ? ' dan ' : ''
              }}{{ match.route.httpHostHeader ? `Host Header ${match.route.httpHostHeader}` : '' }}.
              Kecocokan hostname belum menjamin seluruh request sampai ke aplikasi.
            </p>
            <div class="flex items-start gap-2 border-t pt-3">
              <p class="min-w-0 flex-1 break-all font-mono text-xs text-muted">
                CNAME → {{ match.tunnel.expectedDnsTarget }}
              </p>
              <button
                type="button"
                class="focus-ring rounded p-1 text-muted hover:text-brand"
                aria-label="Salin target DNS"
                @click="copy(match.tunnel.expectedDnsTarget)"
              >
                <Copy :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
          <p
            v-if="!domain.matches.length"
            class="rounded-md border border-dashed p-4 text-xs leading-5 text-muted"
          >
            Belum ditemukan route hostname yang cocok pada tunnel yang dapat dibaca. Tunnel dengan
            konfigurasi lokal perlu diperiksa pada server cloudflared.
          </p>
          <p class="text-xs leading-5 text-muted">
            Status tunnel menunjukkan koneksi cloudflared. Keterjangkauan origin dan respons HTTP
            aplikasi belum diperiksa.
          </p>
          <UiButton
            variant="secondary"
            size="sm"
            :disabled="!overview.configured || !overview.resource.ports.length"
            @click="openConnect(domain)"
            ><Link :size="14" aria-hidden="true" /> Hubungkan ke tunnel</UiButton
          >
        </div>
      </UiCard>
      <div
        v-if="overview.warnings.length"
        role="status"
        class="space-y-2 rounded-md border border-warning/25 bg-warning/5 p-4 text-xs text-warning"
      >
        <p v-for="warning in overview.warnings" :key="warning">{{ warning }}</p>
      </div>
      <NuxtLink
        to="/tunnels"
        class="focus-ring inline-flex items-center gap-2 rounded text-sm text-brand hover:underline"
        ><Cloud :size="15" aria-hidden="true" /> Kelola seluruh tunnel</NuxtLink
      >
    </template>
    <UiDialog
      v-if="showConnect"
      title="Hubungkan domain ke tunnel"
      description="Pilih tunnel dan origin gateway yang dapat dijangkau cloudflared. Traefik akan meneruskan hostname ini ke aplikasi."
      size="lg"
      :close-disabled="saving"
      @close="showConnect = false"
    >
      <form id="application-domain-connect" class="space-y-4" @submit.prevent="connect">
        <fieldset :disabled="saving" class="space-y-4">
          <UiInput
            v-model="form.hostname"
            label="Domain aplikasi"
            placeholder="app.example.com"
            autocomplete="off"
            :spellcheck="false"
            required
          />
          <label class="block"
            ><span class="mb-2 block text-xs font-medium">Cloudflare Tunnel</span
            ><UiSelect
              v-model="form.tunnelId"
              required
              placeholder="Pilih tunnel"
              :options="
                (overview?.tunnels ?? []).map((tunnel) => ({
                  value: tunnel.id,
                  label: `${tunnel.name} · ${tunnel.status}${tunnel.configSource === 'local' ? ' · konfigurasi lokal' : ''}`,
                  disabled: tunnel.configSource === 'local',
                }))
              "
          /></label>
          <label class="block"
            ><span class="mb-2 block text-xs font-medium">Lokasi cloudflared terhadap gateway</span
            ><UiSelect
              v-model="originMode"
              :options="[
                { value: 'custom', label: 'Alamat origin manual / server berbeda' },
                { value: 'docker', label: 'Docker, satu network dengan oc-gateway' },
                { value: 'host', label: 'Service pada host yang sama dengan gateway' },
              ]"
          /></label>
          <UiInput
            v-model="form.origin"
            label="Origin gateway Traefik"
            placeholder="http://alamat-server:80"
            :readonly="originMode !== 'custom'"
            hint="Gunakan alamat dari sudut pandang cloudflared. localhost hanya benar jika connector berjalan langsung pada host gateway."
            required
          />
          <label class="block"
            ><span class="mb-2 block text-xs font-medium">Port container aplikasi</span
            ><UiSelect
              v-model="form.targetPort"
              required
              :options="
                (overview?.resource.ports ?? []).map((port) => ({
                  value: String(port),
                  label: `${port}/tcp`,
                }))
              "
          /></label>
          <p class="rounded-md border bg-surface-raised p-3 text-xs leading-5 text-muted">
            Server tujuan: <strong>{{ overview?.resource.nodeName }}</strong
            >. Route tunnel akan dipasang dan konfigurasi Traefik diantrekan. DNS dikelola terpisah;
            arahkan CNAME domain ke
            <span class="break-all font-mono">{{
              selectedTunnel?.expectedDnsTarget ?? 'target tunnel yang dipilih'
            }}</span>
            dengan proxy Cloudflare aktif. Route tunnel lama tidak dihapus.
          </p>
          <p v-if="formError" role="alert" class="text-sm text-danger">{{ formError }}</p>
        </fieldset>
      </form>
      <template #footer
        ><div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="showConnect = false"
            >Batal</UiButton
          ><UiButton
            type="submit"
            form="application-domain-connect"
            :disabled="saving || !selectedTunnel"
            ><Link :size="15" aria-hidden="true" />{{
              saving ? 'Menghubungkan...' : 'Hubungkan domain'
            }}</UiButton
          >
        </div></template
      >
    </UiDialog>
  </section>
</template>
