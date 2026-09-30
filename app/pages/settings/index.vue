<script setup lang="ts">
import { RefreshCw, Save } from '@lucide/vue'
import type { ApiBillingSettings } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Settings · Billing Infra' })

const appSettings = useAppSettings()
const saving = ref(false)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const form = reactive({
  companyName: appSettings.value.companyName,
  companyEmail: appSettings.value.companyEmail ?? '',
  companyAddress: appSettings.value.companyAddress ?? '',
  companyTaxId: appSettings.value.companyTaxId ?? '',
  billingTimezone: appSettings.value.billingTimezone,
  billingCurrency: appSettings.value.billingCurrency,
  defaultTaxRate: appSettings.value.defaultTaxRate ?? '',
  billingAutomationEnabled: appSettings.value.billingAutomationEnabled,
  billingAccessControlEnabled: appSettings.value.billingAccessControlEnabled,
  overdueGraceDays: String(appSettings.value.overdueGraceDays),
  graceNoticeIntervalHours: String(appSettings.value.graceNoticeIntervalHours),
})

const { data, status, error, refresh } = await useFetch<{ data: ApiBillingSettings }>(
  '/api/settings',
)

watch(
  () => data.value?.data,
  (settings) => {
    if (!settings) return
    applySettings(settings)
  },
  { immediate: true },
)

function applySettings(settings: ApiBillingSettings) {
  appSettings.value = settings
  Object.assign(form, {
    companyName: settings.companyName,
    companyEmail: settings.companyEmail ?? '',
    companyAddress: settings.companyAddress ?? '',
    companyTaxId: settings.companyTaxId ?? '',
    billingTimezone: settings.billingTimezone,
    billingCurrency: settings.billingCurrency,
    defaultTaxRate: settings.defaultTaxRate ?? '',
    billingAutomationEnabled: settings.billingAutomationEnabled,
    billingAccessControlEnabled: settings.billingAccessControlEnabled,
    overdueGraceDays: String(settings.overdueGraceDays),
    graceNoticeIntervalHours: String(settings.graceNoticeIntervalHours),
  })
}

async function saveSettings() {
  saving.value = true
  actionError.value = null
  actionMessage.value = null

  try {
    const response = await $fetch<{ data: ApiBillingSettings }>('/api/settings', {
      method: 'PUT',
      body: form,
    })
    applySettings(response.data)
    actionMessage.value = 'Settings berhasil disimpan dan akan digunakan pada invoice berikutnya.'
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal menyimpan settings.')
  } finally {
    saving.value = false
  }
}

async function reloadSettings() {
  actionError.value = null
  actionMessage.value = null
  await refresh()
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Platform / configuration
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Identitas perusahaan dan default billing untuk invoice yang dibuat setelah perubahan.
        </p>
      </div>
      <UiButton
        variant="secondary"
        :disabled="status === 'pending' || saving"
        @click="reloadSettings"
      >
        <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
        Muat ulang
      </UiButton>
    </header>

    <p
      v-if="actionMessage"
      class="mb-5 rounded-md border border-brand/30 bg-brand/10 px-4 py-3 text-sm text-brand"
      role="status"
    >
      {{ actionMessage }}
    </p>

    <UiEmptyState
      v-if="error"
      title="Gagal memuat settings"
      description="Konfigurasi billing tidak dapat dibaca. Nilai environment tetap digunakan sebagai fallback."
    >
      <UiButton variant="secondary" size="sm" @click="reloadSettings">Coba lagi</UiButton>
    </UiEmptyState>

    <form v-else class="space-y-5" @submit.prevent="saveSettings">
      <UiCard>
        <div class="mb-5 flex items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 class="text-sm font-semibold text-ink">Profil perusahaan</h2>
            <p class="mt-1 text-xs leading-5 text-muted">
              Informasi ini disalin sebagai seller snapshot ketika invoice dibuat.
            </p>
          </div>
          <UiBadge :tone="appSettings.source === 'database' ? 'success' : 'neutral'">
            {{ appSettings.source === 'database' ? 'Database' : 'Environment' }}
          </UiBadge>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="form.companyName"
            label="Nama perusahaan"
            autocomplete="organization"
            required
          />
          <UiInput
            v-model="form.companyEmail"
            label="Email billing"
            type="email"
            autocomplete="email"
          />
          <UiInput v-model="form.companyTaxId" label="NPWP / Tax ID" autocomplete="off" />
          <label class="block sm:col-span-2">
            <span class="mb-2 block text-xs font-semibold text-muted">Alamat perusahaan</span>
            <textarea
              v-model="form.companyAddress"
              rows="3"
              maxlength="5000"
              class="focus-ring min-h-10 w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted/60"
            />
          </label>
        </div>
      </UiCard>

      <UiCard>
        <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold text-ink">Overdue access gate</h2>
              <UiBadge :tone="form.billingAccessControlEnabled ? 'warning' : 'neutral'">
                {{ form.billingAccessControlEnabled ? 'Enabled' : 'Disabled' }}
              </UiBadge>
            </div>
            <p class="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Menampilkan interstitial selama grace period dan memblokir trafik web setelah grace
              berakhir. Resource Coolify tetap berjalan; middleware Traefik harus dipasang terpisah.
            </p>
          </div>
          <label class="inline-flex cursor-pointer items-center gap-3 self-start">
            <input
              v-model="form.billingAccessControlEnabled"
              type="checkbox"
              class="focus-ring size-4 rounded border-line-strong bg-canvas accent-brand"
            />
            <span class="text-sm font-semibold text-ink">Enable access gate</span>
          </label>
        </div>

        <div class="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
          <UiInput
            v-model="form.overdueGraceDays"
            label="Grace period (hari)"
            type="number"
            min="0"
            max="90"
            step="1"
            hint="0 berarti akses diblokir sejak hari pertama overdue."
            required
          />
          <UiInput
            v-model="form.graceNoticeIntervalHours"
            label="Ulangi pemberitahuan (jam)"
            type="number"
            min="1"
            max="168"
            step="1"
            hint="Cookie acknowledgement berlaku selama interval ini."
            required
          />
        </div>
      </UiCard>

      <UiCard>
        <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold text-ink">Billing automation</h2>
              <UiBadge :tone="form.billingAutomationEnabled ? 'success' : 'neutral'">
                {{ form.billingAutomationEnabled ? 'Enabled' : 'Disabled' }}
              </UiBadge>
            </div>
            <p class="mt-1 max-w-2xl text-xs leading-5 text-muted">
              Mengizinkan recurring billing engine membuat invoice dari service yang sudah jatuh
              jadwal dan menandai invoice overdue setiap jam. Manual invoice tetap tersedia ketika
              automation dimatikan.
            </p>
          </div>
          <label class="inline-flex cursor-pointer items-center gap-3 self-start sm:self-center">
            <input
              v-model="form.billingAutomationEnabled"
              type="checkbox"
              class="focus-ring size-4 rounded border-line-strong bg-canvas accent-brand"
            />
            <span class="text-sm font-semibold text-ink">Enable automation</span>
          </label>
        </div>
      </UiCard>

      <UiCard>
        <div class="mb-5 border-b pb-4">
          <h2 class="text-sm font-semibold text-ink">Default billing</h2>
          <p class="mt-1 text-xs leading-5 text-muted">
            Dipakai untuk tanggal billing, mata uang, serta pajak invoice baru.
          </p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UiInput
            v-model="form.billingTimezone"
            label="Billing timezone"
            placeholder="Asia/Makassar"
            hint="Gunakan nama timezone IANA, misalnya Asia/Makassar atau UTC."
            required
          />
          <UiInput
            v-model="form.billingCurrency"
            label="Mata uang default"
            minlength="3"
            maxlength="3"
            placeholder="IDR"
            required
          />
          <UiInput
            v-model="form.defaultTaxRate"
            label="Default tax rate"
            inputmode="decimal"
            placeholder="0.11"
            hint="Gunakan pecahan: 0.11 berarti 11%. Kosong berarti tanpa pajak."
          />
        </div>
      </UiCard>

      <p
        v-if="actionError"
        class="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        role="alert"
      >
        {{ actionError }}
      </p>

      <div class="flex flex-col-reverse justify-between gap-3 sm:flex-row sm:items-center">
        <p class="text-xs text-muted">
          Invoice lama tidak berubah karena menyimpan snapshot seller dan nilai billing.
        </p>
        <UiButton type="submit" :disabled="saving || status === 'pending'">
          <Save :size="15" :stroke-width="1.8" aria-hidden="true" />
          {{ saving ? 'Menyimpan…' : 'Simpan settings' }}
        </UiButton>
      </div>
    </form>
  </div>
</template>
