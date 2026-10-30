<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue'
import { authClient } from '~/lib/auth-client'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in · Billing Infra' })

const route = useRoute()
const appSettings = useAppSettings()
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const errorMessage = ref('')
const pending = ref(false)

async function submit() {
  if (pending.value) return
  pending.value = true
  errorMessage.value = ''
  try {
    const { error } = await authClient.signIn.email({
      email: email.value,
      password: password.value,
    })
    if (error) {
      errorMessage.value = error.message || 'Sign in gagal.'
      return
    }
    await navigateTo(typeof route.query.redirect === 'string' ? route.query.redirect : '/')
  } catch {
    errorMessage.value = 'Tidak dapat terhubung ke server autentikasi. Silakan coba kembali.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-[340px]">
    <p class="mb-9 text-sm font-semibold">{{ appSettings.companyName }}</p>
    <h1 class="text-2xl font-semibold tracking-tight">Masuk</h1>
    <p class="mt-2 text-sm text-muted">Gunakan email dan password akun Anda.</p>
    <form class="mt-7 space-y-5" :aria-busy="pending" @submit.prevent="submit">
      <UiInput
        v-model="email"
        label="Email"
        type="email"
        autocomplete="username"
        placeholder="nama@perusahaan.com"
        :disabled="pending"
        required
      />
      <div>
        <label for="login-password" class="mb-2 block text-xs font-medium">Password</label>
        <div class="relative">
          <input
            id="login-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            :disabled="pending"
            required
            class="focus-ring h-10 w-full rounded-md border border-line-strong bg-surface pr-11 pl-3 text-sm disabled:opacity-60"
          />
          <button
            type="button"
            class="focus-ring absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted hover:text-ink"
            :aria-label="showPassword ? 'Sembunyikan password' : 'Tampilkan password'"
            :aria-pressed="showPassword"
            aria-controls="login-password"
            @click="showPassword = !showPassword"
          >
            <EyeOff v-if="showPassword" :size="16" aria-hidden="true" /><Eye
              v-else
              :size="16"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      <p v-if="errorMessage" role="alert" class="text-xs leading-5 text-danger">
        {{ errorMessage }}
      </p>
      <UiButton class="w-full" type="submit" :disabled="pending">{{
        pending ? 'Memeriksa akun...' : 'Masuk'
      }}</UiButton>
    </form>
    <p class="mt-6 text-xs leading-5 text-muted">Kesulitan masuk? Hubungi administrator.</p>
  </div>
</template>
