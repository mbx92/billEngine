<script setup lang="ts">
import { Plus, RefreshCw } from '@lucide/vue'
import type { ApiCustomer, Paginated } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Customers · Billing Infra' })

const format = useFormat()
const page = ref(1)
const perPage = 25
const showAddForm = ref(false)
const saving = ref(false)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const form = reactive({
  name: '',
  companyName: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  countryCode: 'ID',
  taxId: '',
  notes: '',
})

const { data, status, error, refresh } = await useFetch<Paginated<ApiCustomer>>('/api/customers', {
  query: { page, perPage },
})

const customers = computed(() => data.value?.data ?? [])
const meta = computed(() => data.value?.meta)

async function addCustomer() {
  saving.value = true
  actionError.value = null
  actionMessage.value = null

  try {
    const response = await $fetch<{ data: { customerNumber: string; name: string } }>(
      '/api/customers',
      { method: 'POST', body: form },
    )
    actionMessage.value = `${response.data.customerNumber} · ${response.data.name} berhasil ditambahkan.`
    Object.assign(form, {
      name: '',
      companyName: '',
      email: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      province: '',
      postalCode: '',
      countryCode: 'ID',
      taxId: '',
      notes: '',
    })
    showAddForm.value = false
    page.value = 1
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal menambahkan customer.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Commercial / customers
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Customers</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Customer identity, ownership, billing address, and commercial status.
        </p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
          <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
          Refresh
        </UiButton>
        <UiButton @click="showAddForm = true">
          <Plus :size="15" aria-hidden="true" />
          Tambah customer
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
    <UiDialog
      v-if="showAddForm"
      title="Tambah customer"
      description="Simpan identitas dan alamat billing customer baru."
      size="lg"
      :close-disabled="saving"
      @close="showAddForm = false"
    >
      <form id="add-customer-form" class="grid gap-4 md:grid-cols-2" @submit.prevent="addCustomer">
        <p
          v-if="actionError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger md:col-span-2"
          role="alert"
        >
          {{ actionError }}
        </p>
        <UiInput v-model="form.name" label="Nama customer" autocomplete="name" autofocus required />
        <UiInput v-model="form.companyName" label="Perusahaan" autocomplete="organization" />
        <UiInput
          v-model="form.email"
          label="Email billing"
          type="email"
          autocomplete="email"
          required
        />
        <UiInput v-model="form.phone" label="Telepon" type="tel" autocomplete="tel" />
        <UiInput v-model="form.addressLine1" label="Alamat" autocomplete="address-line1" />
        <UiInput v-model="form.addressLine2" label="Alamat lanjutan" autocomplete="address-line2" />
        <UiInput v-model="form.city" label="Kota" autocomplete="address-level2" />
        <UiInput v-model="form.province" label="Provinsi" autocomplete="address-level1" />
        <UiInput v-model="form.postalCode" label="Kode pos" autocomplete="postal-code" />
        <UiInput
          v-model="form.countryCode"
          label="Kode negara"
          maxlength="2"
          placeholder="ID"
          autocomplete="country"
          required
        />
        <UiInput v-model="form.taxId" label="NPWP / Tax ID" autocomplete="off" />
        <label class="block">
          <span class="mb-2 block text-xs font-semibold text-muted">Catatan</span>
          <textarea
            v-model="form.notes"
            rows="3"
            class="focus-ring min-h-10 w-full rounded-md border border-line-strong bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted/60"
          />
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="showAddForm = false">
            Batal
          </UiButton>
          <UiButton type="submit" form="add-customer-form" :disabled="saving">
            {{ saving ? 'Menyimpan…' : 'Simpan customer' }}
          </UiButton>
        </div>
      </template>
    </UiDialog>

    <UiCard :padded="false">
      <div class="flex h-11 items-center justify-between border-b px-4">
        <span class="text-xs font-semibold text-muted">Inventory</span>
        <UiBadge v-if="meta">{{ format.count(meta.total) }} total</UiBadge>
      </div>

      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="row in 4" :key="row" height="2.25rem" />
      </div>

      <UiEmptyState
        v-else-if="error"
        title="Gagal memuat customers"
        description="Server tidak dapat membaca data customer. Coba muat ulang halaman."
      >
        <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
      </UiEmptyState>

      <UiEmptyState
        v-else-if="customers.length === 0"
        title="Belum ada customer"
        description="Tambahkan customer pertama untuk mulai menghubungkannya dengan service dan invoice."
      >
        <UiButton size="sm" @click="showAddForm = true">
          <Plus :size="14" aria-hidden="true" />
          Tambah customer
        </UiButton>
      </UiEmptyState>

      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-sm">
            <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
              <tr>
                <th class="px-4 py-3 font-semibold">Customer</th>
                <th class="px-4 py-3 font-semibold">Nomor</th>
                <th class="px-4 py-3 font-semibold">Status</th>
                <th class="px-4 py-3 text-right font-semibold">Services</th>
                <th class="px-4 py-3 font-semibold">Terdaftar</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="customer in customers"
                :key="customer.id"
                class="border-b last:border-0 hover:bg-surface-raised/60"
              >
                <td class="px-4 py-3">
                  <span class="block font-medium text-ink">{{
                    customer.companyName || customer.name
                  }}</span>
                  <span class="block text-xs text-muted">{{ customer.email }}</span>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-muted">
                  {{ customer.customerNumber }}
                </td>
                <td class="px-4 py-3">
                  <ResourceStatusBadge :status="customer.status" />
                </td>
                <td class="px-4 py-3 text-right font-mono text-xs">
                  <span class="text-ink">{{ customer.activeServiceCount }}</span>
                  <span class="text-muted"> / {{ customer.totalServiceCount }}</span>
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ format.dateTime(customer.createdAt) }}
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
