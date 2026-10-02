<script setup lang="ts">
import { Check, Pencil, Plus, RefreshCw, Trash2 } from '@lucide/vue'
import type { BillingCycle } from '#shared/constants/domain'
import type { ApiPlan, DatabaseMode, Paginated } from '#shared/types/api'
import { billingCycleUnit } from '#shared/utils/billing-display'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Plans · Billing Infra' })

const format = useFormat()
const appSettings = useAppSettings()
const page = ref(1)
const perPage = 25
const showForm = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const changingStatusId = ref<string | null>(null)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const form = reactive({
  name: '',
  description: '',
  currency: appSettings.value.billingCurrency,
  priceAmount: '',
  billingCycle: 'monthly' as BillingCycle,
  includedResourceCount: '',
  includedCpuCores: '',
  includedMemoryMb: '',
  databaseMode: 'none' as DatabaseMode,
  inclusions: [''],
})

const billingCycles: Array<{ value: BillingCycle; label: string }> = [
  { value: 'one_time', label: 'Sekali bayar' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'quarterly', label: 'Tiga bulanan' },
  { value: 'semi_annually', label: 'Enam bulanan' },
  { value: 'annually', label: 'Tahunan' },
]

const { data, status, error, refresh } = await useFetch<Paginated<ApiPlan>>('/api/plans', {
  query: { page, perPage },
})

const plans = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta)
const dialogTitle = computed(() => (editingId.value ? 'Edit plan' : 'Tambah plan'))

function resetForm() {
  editingId.value = null
  Object.assign(form, {
    name: '',
    description: '',
    currency: appSettings.value.billingCurrency,
    priceAmount: '',
    billingCycle: 'monthly',
    includedResourceCount: '',
    includedCpuCores: '',
    includedMemoryMb: '',
    databaseMode: 'none',
    inclusions: [''],
  })
  actionError.value = null
}

function openCreate() {
  resetForm()
  showForm.value = true
}

function openEdit(plan: ApiPlan) {
  editingId.value = plan.id
  Object.assign(form, {
    name: plan.name,
    description: plan.description ?? '',
    currency: plan.currency,
    priceAmount: plan.priceAmount,
    billingCycle: plan.billingCycle,
    includedResourceCount: plan.includedResourceCount?.toString() ?? '',
    includedCpuCores: plan.includedCpuCores ?? '',
    includedMemoryMb: plan.includedMemoryBytes
      ? (BigInt(plan.includedMemoryBytes) / (1024n * 1024n)).toString()
      : '',
    databaseMode: plan.databaseMode,
    inclusions: [...plan.inclusions],
  })
  actionError.value = null
  showForm.value = true
}

function closeForm() {
  if (saving.value) return
  showForm.value = false
  resetForm()
}

function addInclusion() {
  if (form.inclusions.length < 30) form.inclusions.push('')
}

function removeInclusion(index: number) {
  if (form.inclusions.length === 1) {
    form.inclusions[0] = ''
    return
  }
  form.inclusions.splice(index, 1)
}

async function savePlan() {
  saving.value = true
  actionError.value = null
  actionMessage.value = null

  try {
    if (form.includedMemoryMb && !/^\d+$/.test(form.includedMemoryMb)) {
      throw new Error('RAM plan harus berupa bilangan MB.')
    }
    const body = {
      ...form,
      includedResourceCount: form.includedResourceCount || null,
      includedCpuCores: form.includedCpuCores || null,
      includedMemoryBytes: form.includedMemoryMb
        ? (BigInt(form.includedMemoryMb) * 1024n * 1024n).toString()
        : null,
      includedMemoryMb: undefined,
      inclusions: form.inclusions.map((item) => item.trim()).filter(Boolean),
    }

    if (editingId.value) {
      const response = await $fetch<{ data: { name: string } }>(`/api/plans/${editingId.value}`, {
        method: 'PATCH',
        body,
      })
      actionMessage.value = `Plan ${response.data.name} berhasil diperbarui.`
    } else {
      const response = await $fetch<{ data: { name: string } }>('/api/plans', {
        method: 'POST',
        body,
      })
      actionMessage.value = `Plan ${response.data.name} berhasil ditambahkan.`
    }
    showForm.value = false
    resetForm()
    page.value = 1
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Plan gagal disimpan.')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(plan: ApiPlan) {
  changingStatusId.value = plan.id
  actionError.value = null
  actionMessage.value = null
  try {
    await $fetch(`/api/plans/${plan.id}`, {
      method: 'PATCH',
      body: { isActive: !plan.isActive },
    })
    actionMessage.value = `Plan ${plan.name} ${plan.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Status plan gagal diperbarui.')
  } finally {
    changingStatusId.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Commercial / plans
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Plans</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Katalog harga dan benefit yang diterima customer sebelum service dibuat.
        </p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
          Refresh
        </UiButton>
        <UiButton @click="openCreate">
          <Plus :size="15" aria-hidden="true" />
          Tambah plan
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
      v-if="actionError && !showForm"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
      role="alert"
    >
      {{ actionError }}
    </p>

    <UiDialog
      v-if="showForm"
      :title="dialogTitle"
      description="Tentukan harga, siklus billing, dan semua benefit yang termasuk dalam plan."
      size="lg"
      :close-disabled="saving"
      @close="closeForm"
    >
      <form id="plan-form" class="grid gap-4 md:grid-cols-2" @submit.prevent="savePlan">
        <p
          v-if="actionError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger md:col-span-2"
          role="alert"
        >
          {{ actionError }}
        </p>
        <UiInput v-model="form.name" label="Nama plan" placeholder="Starter Hosting" required />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Siklus billing</span>
          <select
            v-model="form.billingCycle"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option v-for="cycle in billingCycles" :key="cycle.value" :value="cycle.value">
              {{ cycle.label }}
            </option>
          </select>
        </label>
        <UiMoneyInput
          v-model="form.priceAmount"
          label="Harga plan"
          :currency="form.currency"
          :hint="`Gunakan 0 untuk trial; selain itu ditagihkan ${form.billingCycle === 'one_time' ? 'sekali' : `per ${billingCycleUnit(form.billingCycle)}`}.`"
          placeholder="500000"
          required
        />
        <UiInput v-model="form.currency" label="Mata uang" maxlength="3" required />
        <div class="rounded-md border border-line bg-canvas p-4 md:col-span-2">
          <p class="text-sm font-semibold text-ink">Alokasi infrastructure dalam plan</p>
          <p class="mt-1 text-xs text-muted">
            Nilai ini dibandingkan dengan total limit resource Coolify yang terhubung ke service.
          </p>
          <div class="mt-4 grid gap-4 md:grid-cols-3">
            <UiInput
              v-model="form.includedResourceCount"
              label="Jumlah resource"
              type="number"
              min="1"
              placeholder="2"
            />
            <UiInput
              v-model="form.includedCpuCores"
              label="Total CPU core"
              type="number"
              min="0.001"
              step="0.001"
              placeholder="2"
            />
            <UiInput
              v-model="form.includedMemoryMb"
              label="Total RAM (MB)"
              type="number"
              min="1"
              step="1"
              placeholder="2048"
            />
          </div>
          <label class="mt-4 block">
            <span class="mb-2 block text-xs font-semibold text-muted">Mode database</span>
            <select
              v-model="form.databaseMode"
              class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
            >
              <option value="none">Tanpa database</option>
              <option value="shared">PostgreSQL shared</option>
              <option value="dedicated" disabled>PostgreSQL dedicated (fase lanjutan)</option>
            </select>
          </label>
        </div>
        <label class="block md:col-span-2">
          <span class="mb-2 block text-xs font-semibold text-muted">Deskripsi</span>
          <textarea
            v-model="form.description"
            rows="3"
            placeholder="Cocok untuk website bisnis skala kecil."
            class="focus-ring min-h-10 w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted/60"
          />
        </label>

        <fieldset class="md:col-span-2">
          <div class="mb-2 flex items-center justify-between gap-3">
            <div>
              <legend class="text-xs font-semibold text-muted">Yang termasuk dalam harga</legend>
              <p class="mt-1 text-xs text-muted">
                CPU, RAM, storage, backup, support, atau benefit lain.
              </p>
            </div>
            <UiButton type="button" variant="secondary" size="sm" @click="addInclusion">
              <Plus :size="14" aria-hidden="true" />
              Tambah benefit
            </UiButton>
          </div>
          <div class="space-y-2">
            <div v-for="(_, index) in form.inclusions" :key="index" class="flex gap-2">
              <input
                v-model="form.inclusions[index]"
                :aria-label="`Benefit ${index + 1}`"
                :placeholder="index === 0 ? 'Contoh: RAM 1 GB' : 'Benefit lainnya'"
                required
                class="focus-ring h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink placeholder:text-muted/60"
              />
              <UiButton
                type="button"
                variant="secondary"
                size="sm"
                :aria-label="`Hapus benefit ${index + 1}`"
                @click="removeInclusion(index)"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </UiButton>
            </div>
          </div>
        </fieldset>
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="closeForm">Batal</UiButton>
          <UiButton type="submit" form="plan-form" :disabled="saving">
            {{ saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Simpan plan' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiCard :padded="false">
      <div class="flex h-11 items-center justify-between border-b px-4">
        <span class="text-xs font-semibold text-muted">Plan catalog</span>
        <UiBadge v-if="meta">{{ format.count(meta.total) }} total</UiBadge>
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="3rem" />
      </div>
      <UiEmptyState
        v-else-if="error"
        title="Gagal memuat plans"
        description="Server tidak dapat membaca katalog plan."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>
      <UiEmptyState
        v-else-if="plans.length === 0"
        title="Belum ada plan"
        description="Buat plan beserta harga dan benefit sebelum membuat service."
      >
        <UiButton size="sm" @click="openCreate">
          <Plus :size="14" aria-hidden="true" />
          Tambah plan
        </UiButton>
      </UiEmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[900px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Plan</th>
                <th class="px-4 py-3 font-semibold">Harga</th>
                <th class="px-4 py-3 font-semibold">Termasuk</th>
                <th class="px-4 py-3 text-right font-semibold">Services</th>
                <th class="px-4 py-3 font-semibold">Status</th>
                <th class="px-4 py-3 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="plan in plans" :key="plan.id" class="border-b align-top last:border-0">
                <td class="px-4 py-3">
                  <span class="block font-medium text-ink">{{ plan.name }}</span>
                  <span class="mt-0.5 block max-w-64 text-xs text-muted">{{
                    plan.description || '—'
                  }}</span>
                </td>
                <td class="px-4 py-3">
                  <MoneyDisplay :amount="plan.priceAmount" :currency="plan.currency" />
                  <span class="block text-xs text-muted">
                    {{
                      plan.billingCycle === 'one_time'
                        ? 'sekali bayar'
                        : `/ ${billingCycleUnit(plan.billingCycle)}`
                    }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="mb-2 flex flex-wrap gap-1.5">
                    <UiBadge v-if="plan.includedResourceCount">
                      {{ plan.includedResourceCount }} resource
                    </UiBadge>
                    <UiBadge v-if="plan.includedCpuCores">
                      {{ format.cpu(plan.includedCpuCores) }}
                    </UiBadge>
                    <UiBadge v-if="plan.includedMemoryBytes">
                      {{ format.bytes(plan.includedMemoryBytes) }}
                    </UiBadge>
                    <UiBadge :tone="plan.databaseMode === 'shared' ? 'info' : 'neutral'">
                      DB {{ plan.databaseMode }}
                    </UiBadge>
                    <UiBadge
                      v-if="
                        !plan.includedResourceCount &&
                        !plan.includedCpuCores &&
                        !plan.includedMemoryBytes
                      "
                      tone="warning"
                    >
                      Quota belum diatur
                    </UiBadge>
                  </div>
                  <ul class="space-y-1 text-xs text-ink">
                    <li
                      v-for="item in plan.inclusions"
                      :key="item"
                      class="flex items-start gap-1.5"
                    >
                      <Check class="mt-0.5 shrink-0 text-brand" :size="12" aria-hidden="true" />
                      {{ item }}
                    </li>
                  </ul>
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs">{{ plan.serviceCount }}</td>
                <td class="px-4 py-3">
                  <UiBadge :tone="plan.isActive ? 'success' : 'neutral'">
                    {{ plan.isActive ? 'Active' : 'Inactive' }}
                  </UiBadge>
                </td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-2">
                    <UiButton variant="secondary" size="sm" @click="openEdit(plan)">
                      <Pencil :size="13" aria-hidden="true" /> Edit
                    </UiButton>
                    <UiButton
                      variant="secondary"
                      size="sm"
                      :disabled="changingStatusId === plan.id"
                      @click="toggleStatus(plan)"
                    >
                      {{
                        changingStatusId === plan.id
                          ? 'Menyimpan…'
                          : plan.isActive
                            ? 'Nonaktifkan'
                            : 'Aktifkan'
                      }}
                    </UiButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination
          v-if="meta"
          :page="meta.page"
          :per-page="meta.perPage"
          :total="meta.total"
          :total-pages="meta.totalPages"
          @update:page="page = $event"
        />
      </template>
    </UiCard>
  </div>
</template>
