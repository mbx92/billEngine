<script setup lang="ts">
import { authClient } from '~/lib/auth-client'
import {
  loginDestination,
  safeLoginRedirect,
  type LoginRole,
} from '#shared/utils/login-destination'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in · Billing Infra' })

const route = useRoute()
const appVersion = useAppVersion()
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const pending = ref(false)

async function submit() {
  if (pending.value) return
  pending.value = true
  errorMessage.value = ''
  try {
    const { error } = await authClient.signIn.email({
      email: email.value.trim(),
      password: password.value,
    })
    if (error) {
      errorMessage.value = error.message || 'Email atau password tidak sesuai.'
      return
    }
    const session = await $fetch<{ user: { role: LoginRole; customerId?: string | null } } | null>(
      '/api/auth/get-session',
    )
    if (!session) {
      errorMessage.value = 'Sesi login belum terbentuk. Coba masuk kembali.'
      return
    }
    clearNuxtData()
    await navigateTo(
      loginDestination(session.user.role, route.query.redirect, session.user.customerId),
    )
  } catch {
    errorMessage.value = 'Tidak dapat terhubung ke layanan login. Silakan coba lagi.'
  } finally {
    pending.value = false
  }
}

const portalLogin = computed(
  () => safeLoginRedirect(route.query.redirect)?.startsWith('/portal') === true,
)
</script>

<template>
  <div class="w-full max-w-sm">
    <div class="mb-7 flex items-center gap-3">
      <AppLogo class="size-10 shrink-0" />
      <div>
        <strong class="block text-sm">Billing Infra</strong
        ><span class="font-mono text-[10px] tracking-wider text-muted uppercase"
          >secure control plane</span
        >
      </div>
    </div>
    <UiCard>
      <h1 class="text-xl font-semibold tracking-tight">Masuk</h1>
      <p class="mt-2 text-sm leading-6 text-muted">
        {{
          portalLogin
            ? 'Masuk dengan akun customer yang terhubung ke layanan Anda untuk melihat invoice dan status layanan.'
            : 'Masuk dengan akun admin atau customer portal.'
        }}
      </p>
      <p v-if="portalLogin" class="mt-2 text-xs leading-5 text-muted">
        Belum memiliki akun? Hubungi pengelola layanan. Email pada invoice belum tentu sudah
        memiliki akun login.
      </p>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <UiInput
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          placeholder="billing@example.test"
          required
        />
        <UiInput
          v-model="password"
          label="Password"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••••••"
          required
        />
        <div
          v-if="errorMessage"
          role="alert"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {{ errorMessage }}
        </div>
        <UiButton class="w-full" type="submit" :disabled="pending">{{
          pending ? 'Masuk…' : 'Masuk'
        }}</UiButton>
      </form>
    </UiCard>
    <p class="mt-4 text-center font-mono text-[10px] text-muted">
      {{ appVersion.label }} · SESSION AUTH
    </p>
  </div>
</template>
