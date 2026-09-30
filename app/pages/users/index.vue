<script setup lang="ts">
import { Plus, RefreshCw, Save } from '@lucide/vue'
import type { ApiCustomer, ApiUser, Paginated } from '#shared/types/api'
import { apiErrorMessage } from '~/lib/api-error'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Users & access · Billing Infra' })

const showForm = ref(false)
const saving = ref(false)
const savingAccess = ref<string | null>(null)
const actionError = ref<string | null>(null)
const actionMessage = ref<string | null>(null)
const form = reactive({ name: '', email: '', password: '', role: 'customer', customerId: '' })
const { data, status, refresh } = await useFetch<{ data: ApiUser[] }>('/api/users')
const { data: customersResponse } = await useFetch<Paginated<ApiCustomer>>('/api/customers', {
  query: { page: 1, perPage: 100 },
})
const users = computed(() => data.value?.data ?? [])
const accessDrafts = reactive<Record<string, { role: ApiUser['role']; customerId: string | null }>>(
  {},
)
const customers = computed(() =>
  (customersResponse.value?.data ?? []).filter((customer) => customer.status === 'active'),
)

watch(
  users,
  (currentUsers) => {
    for (const user of currentUsers) {
      accessDrafts[user.id] = { role: user.role, customerId: user.customerId }
    }
  },
  { immediate: true },
)

async function createUser() {
  saving.value = true
  actionError.value = null
  try {
    await $fetch('/api/users', {
      method: 'POST',
      body: {
        ...form,
        customerId: form.role === 'customer' ? form.customerId : null,
      },
    })
    actionMessage.value = `Akun ${form.email} berhasil dibuat.`
    showForm.value = false
    Object.assign(form, { name: '', email: '', password: '', role: 'customer', customerId: '' })
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal membuat user.')
  } finally {
    saving.value = false
  }
}

async function updateAccess(user: ApiUser) {
  const draft = accessDrafts[user.id]
  if (!draft) return
  savingAccess.value = user.id
  actionError.value = null
  try {
    await $fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: {
        role: draft.role,
        customerId: draft.role === 'customer' ? draft.customerId : null,
      },
    })
    actionMessage.value = `Akses ${user.email} diperbarui. Semua sesi user tersebut telah dicabut.`
    await refresh()
  } catch (caught) {
    actionError.value = apiErrorMessage(caught, 'Gagal memperbarui akses.')
  } finally {
    savingAccess.value = null
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <header class="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Security / access
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Users & access</h1>
        <p class="mt-2 text-sm text-muted">Kelola admin dan akun portal customer.</p>
      </div>
      <div class="flex gap-2">
        <UiButton variant="secondary" @click="refresh()"><RefreshCw :size="15" /> Refresh</UiButton>
        <UiButton @click="showForm = true"><Plus :size="15" /> Tambah user</UiButton>
      </div>
    </header>

    <p
      v-if="actionMessage"
      class="mb-4 rounded-md border border-brand/30 bg-brand/10 px-3 py-2 text-sm text-brand"
    >
      {{ actionMessage }}
    </p>
    <p
      v-if="actionError"
      class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {{ actionError }}
    </p>

    <UiDialog
      v-if="showForm"
      title="Tambah user"
      description="Password awal minimal 12 karakter."
      @close="showForm = false"
    >
      <form id="create-user-form" class="grid gap-4" @submit.prevent="createUser">
        <UiInput v-model="form.name" label="Nama" required />
        <UiInput v-model="form.email" label="Email" type="email" required />
        <UiInput v-model="form.password" label="Password awal" type="password" required />
        <label>
          <span class="mb-2 block text-xs font-semibold text-muted">Role</span>
          <select
            v-model="form.role"
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="customer">Customer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label v-if="form.role === 'customer'">
          <span class="mb-2 block text-xs font-semibold text-muted">Customer</span>
          <select
            v-model="form.customerId"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-ink"
          >
            <option value="" disabled>Pilih customer</option>
            <option v-for="customer in customers" :key="customer.id" :value="customer.id">
              {{ customer.companyName || customer.name }} · {{ customer.customerNumber }}
            </option>
          </select>
        </label>
      </form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UiButton variant="secondary" :disabled="saving" @click="showForm = false"
            >Batal</UiButton
          >
          <UiButton type="submit" form="create-user-form" :disabled="saving">{{
            saving ? 'Menyimpan…' : 'Buat user'
          }}</UiButton>
        </div>
      </template>
    </UiDialog>

    <UiCard :padded="false">
      <div v-if="status === 'pending'" class="space-y-3 p-4">
        <UiSkeleton v-for="n in 4" :key="n" height="2.5rem" />
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[780px] text-left text-sm">
          <thead class="border-b bg-canvas/60 text-[10px] tracking-wider text-muted uppercase">
            <tr>
              <th class="px-4 py-3">User</th>
              <th class="px-4 py-3">Role</th>
              <th class="px-4 py-3">Customer</th>
              <th class="px-4 py-3">Dibuat</th>
              <th class="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id" class="border-b last:border-0">
              <td class="px-4 py-3">
                <span class="block font-medium text-ink">{{ user.name }}</span
                ><span class="text-xs text-muted">{{ user.email }}</span>
              </td>
              <td class="px-4 py-3">
                <select
                  v-model="accessDrafts[user.id]!.role"
                  class="focus-ring h-8 rounded-md border bg-canvas px-2 text-xs text-ink"
                >
                  <option value="super_admin">Super admin</option>
                  <option value="admin">Admin</option>
                  <option value="customer">Customer</option>
                </select>
              </td>
              <td class="px-4 py-3 text-xs text-muted">
                <select
                  v-if="accessDrafts[user.id]?.role === 'customer'"
                  v-model="accessDrafts[user.id]!.customerId"
                  class="focus-ring h-8 max-w-64 rounded-md border bg-canvas px-2 text-xs text-ink"
                >
                  <option :value="null" disabled>Pilih customer</option>
                  <option v-for="customer in customers" :key="customer.id" :value="customer.id">
                    {{ customer.companyName || customer.name }}
                  </option>
                </select>
                <span v-else>—</span>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-muted">
                {{ new Date(user.createdAt).toLocaleDateString('id-ID') }}
              </td>
              <td class="px-4 py-3 text-right">
                <UiButton
                  variant="secondary"
                  size="sm"
                  :disabled="savingAccess === user.id || !accessDrafts[user.id]"
                  @click="updateAccess(user)"
                >
                  <Save :size="14" />
                  {{ savingAccess === user.id ? 'Menyimpan…' : 'Simpan' }}
                </UiButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>
  </div>
</template>
