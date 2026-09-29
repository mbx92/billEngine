<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in · Billing Infra' })

const route = useRoute()
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const pending = ref(false)

async function submit() {
  pending.value = true
  errorMessage.value = ''
  const { error } = await authClient.signIn.email({ email: email.value, password: password.value })
  pending.value = false

  if (error) {
    errorMessage.value = error.message || 'Sign in gagal.'
    return
  }

  await navigateTo(typeof route.query.redirect === 'string' ? route.query.redirect : '/')
}
</script>

<template>
  <div class="w-full max-w-sm">
    <div class="mb-7 flex items-center gap-3">
      <span
        class="flex size-10 items-center justify-center rounded-md border border-brand/30 bg-brand/10 font-mono text-sm font-bold text-brand"
        >B_</span
      >
      <div>
        <strong class="block text-sm">Billing Infra</strong
        ><span class="font-mono text-[10px] tracking-wider text-muted uppercase"
          >secure control plane</span
        >
      </div>
    </div>
    <UiCard>
      <h1 class="text-xl font-semibold tracking-tight">Administrator sign in</h1>
      <p class="mt-2 text-sm leading-6 text-muted">
        Use your billing platform credentials. Coolify credentials are never accepted here.
      </p>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <UiInput
          v-model="email"
          label="Email"
          type="email"
          autocomplete="email"
          placeholder="admin@example.test"
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
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {{ errorMessage }}
        </div>
        <UiButton class="w-full" type="submit" :disabled="pending">{{
          pending ? 'Signing in…' : 'Sign in'
        }}</UiButton>
      </form>
    </UiCard>
    <p class="mt-4 text-center font-mono text-[10px] text-muted">SESSION AUTH · HTTP-ONLY COOKIE</p>
  </div>
</template>
