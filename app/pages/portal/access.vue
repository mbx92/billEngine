<script setup lang="ts">
import { authClient } from '~/lib/auth-client'
definePageMeta({ middleware: 'auth', layout: 'auth' })
useHead({ title: 'Akses portal belum tersedia' })
const pending = ref(false)
const error = ref('')
async function switchAccount() {
  pending.value = true
  error.value = ''
  try {
    const result = await authClient.signOut()
    if (result.error) throw new Error('Sign out failed')
    clearNuxtData()
    await navigateTo('/login?redirect=%2Fportal')
  } catch {
    error.value = 'Gagal keluar. Silakan coba lagi.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UiCard class="w-full max-w-md">
    <h1 class="text-xl font-semibold">Akses portal belum tersedia</h1>
    <p class="mt-3 text-sm leading-6 text-muted">
      Anda sudah masuk, tetapi akun ini belum terhubung ke data customer. Hubungi pengelola layanan
      untuk menghubungkan akun Anda.
    </p>
    <p v-if="error" role="alert" class="mt-3 text-sm text-danger">{{ error }}</p>
    <UiButton class="mt-6 w-full" :disabled="pending" @click="switchAccount">{{
      pending ? 'Keluar…' : 'Gunakan akun lain'
    }}</UiButton>
  </UiCard>
</template>
