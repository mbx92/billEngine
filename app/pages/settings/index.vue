<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Settings · Billing Infra' })

const { companyName, companyEmail, billingTimezone, appUrl } = useRuntimeConfig().public

const entries = computed(() => [
  { label: 'Company name', value: companyName },
  { label: 'Company email', value: companyEmail || '—' },
  { label: 'Billing timezone', value: billingTimezone },
  { label: 'Application URL', value: appUrl },
])
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 sm:mb-6">
      <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
        Platform / configuration
      </p>
      <h1 class="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Company profile, billing defaults, invoice numbering, timezone, and Coolify connection
        settings.
      </p>
    </header>

    <UiCard :padded="false">
      <div class="flex h-11 items-center justify-between border-b px-4">
        <span class="text-xs font-semibold text-muted">Nilai aktif</span>
        <UiBadge tone="neutral">Read-only</UiBadge>
      </div>

      <dl class="divide-y">
        <div
          v-for="entry in entries"
          :key="entry.label"
          class="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <dt class="text-xs font-semibold text-muted">{{ entry.label }}</dt>
          <dd class="font-mono text-xs text-ink">{{ entry.value }}</dd>
        </div>
      </dl>

      <div class="border-t px-4 py-3">
        <p class="text-xs leading-6 text-muted">
          Nilai di atas dibaca dari configuration server-side (environment variable). Tabel
          <code class="font-mono">settings</code>
          dan endpoint penyimpanannya belum diimplementasikan, jadi belum dapat diubah dari UI ini.
        </p>
      </div>
    </UiCard>
  </div>
</template>
