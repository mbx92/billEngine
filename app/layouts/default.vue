<script setup lang="ts">
import {
  Activity as ActivityIcon,
  Boxes,
  CreditCard,
  FileText,
  GalleryVerticalEnd,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Server as ServerIcon,
  Settings as SettingsIcon,
  Users,
} from '@lucide/vue'
import { authClient } from '~/lib/auth-client'

const route = useRoute()
const mobileOpen = ref(false)
const appSettings = useAppSettings()
const { data: settingsResponse } = await useFetch<{ data: typeof appSettings.value }>(
  '/api/settings',
)

watchEffect(() => {
  if (settingsResponse.value?.data) appSettings.value = settingsResponse.value.data
})

const primaryNavigation = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Plans', to: '/plans', icon: GalleryVerticalEnd },
  { label: 'Services', to: '/services', icon: Layers3 },
  { label: 'Invoices', to: '/invoices', icon: FileText },
  { label: 'Payments', to: '/payments', icon: CreditCard },
] as const
const infrastructureNavigation = [
  { label: 'Resources', to: '/resources', icon: Boxes },
  { label: 'Servers', to: '/servers', icon: ServerIcon },
  { label: 'Activity', to: '/activity', icon: ActivityIcon },
] as const

function isActive(path: string) {
  return path === '/' ? route.path === '/' : route.path.startsWith(path)
}

async function signOut() {
  await authClient.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <button
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/60 lg:hidden"
      aria-label="Close navigation"
      @click="mobileOpen = false"
    />

    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-sidebar transition-transform lg:translate-x-0"
      :class="mobileOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 items-center border-b px-5">
        <NuxtLink to="/" class="flex items-center gap-3" @click="mobileOpen = false">
          <span
            class="flex size-8 items-center justify-center rounded-md border border-brand/30 bg-brand/10 font-mono text-sm font-bold text-brand"
            >B_</span
          >
          <span>
            <strong class="block max-w-40 truncate text-sm leading-tight">{{
              appSettings.companyName
            }}</strong>
            <span class="font-mono text-[10px] tracking-wider text-muted uppercase"
              >control plane</span
            >
          </span>
        </NuxtLink>
      </div>

      <nav class="flex-1 overflow-y-auto p-3">
        <p class="px-3 pb-2 pt-3 text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
          Commercial
        </p>
        <NuxtLink
          v-for="item in primaryNavigation"
          :key="item.to"
          :to="item.to"
          class="focus-ring mb-1 flex h-9 items-center gap-3 rounded-md px-3 text-sm transition"
          :class="
            isActive(item.to)
              ? 'bg-surface-raised text-ink'
              : 'text-muted hover:bg-surface hover:text-ink'
          "
          @click="mobileOpen = false"
        >
          <span
            class="flex size-5 shrink-0 items-center justify-center"
            :class="isActive(item.to) ? 'text-brand' : ''"
          >
            <component :is="item.icon" :size="17" :stroke-width="1.8" aria-hidden="true" />
          </span>
          {{ item.label }}
        </NuxtLink>

        <p class="px-3 pb-2 pt-6 text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
          Infrastructure
        </p>
        <NuxtLink
          v-for="item in infrastructureNavigation"
          :key="item.to"
          :to="item.to"
          class="focus-ring mb-1 flex h-9 items-center gap-3 rounded-md px-3 text-sm transition"
          :class="
            isActive(item.to)
              ? 'bg-surface-raised text-ink'
              : 'text-muted hover:bg-surface hover:text-ink'
          "
          @click="mobileOpen = false"
        >
          <span
            class="flex size-5 shrink-0 items-center justify-center"
            :class="isActive(item.to) ? 'text-brand' : ''"
          >
            <component :is="item.icon" :size="17" :stroke-width="1.8" aria-hidden="true" />
          </span>
          {{ item.label }}
        </NuxtLink>
      </nav>

      <div class="border-t p-3">
        <NuxtLink
          to="/settings"
          class="focus-ring flex h-9 items-center gap-3 rounded-md px-3 text-sm transition"
          :class="
            isActive('/settings')
              ? 'bg-surface-raised text-ink'
              : 'text-muted hover:bg-surface hover:text-ink'
          "
        >
          <span
            class="flex size-5 shrink-0 items-center justify-center"
            :class="isActive('/settings') ? 'text-brand' : ''"
          >
            <SettingsIcon :size="17" :stroke-width="1.8" aria-hidden="true" />
          </span>
          Settings
        </NuxtLink>
        <button
          class="focus-ring mt-1 flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-muted hover:bg-surface hover:text-ink"
          @click="signOut"
        >
          <span class="flex size-5 shrink-0 items-center justify-center">
            <LogOut :size="17" :stroke-width="1.8" aria-hidden="true" />
          </span>
          Sign out
        </button>
      </div>
    </aside>

    <div class="lg:pl-64">
      <header
        class="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-canvas/90 px-4 backdrop-blur md:px-6 lg:px-8"
      >
        <div class="flex items-center gap-3">
          <button
            class="focus-ring flex size-9 items-center justify-center rounded-md border bg-surface lg:hidden"
            aria-label="Open navigation"
            @click="mobileOpen = true"
          >
            <MenuIcon :size="18" :stroke-width="1.8" aria-hidden="true" />
          </button>
          <div class="hidden items-center gap-2 text-xs text-muted sm:flex">
            <span class="size-1.5 rounded-full bg-brand" />
            Platform operational
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="hidden font-mono text-[11px] text-muted sm:block">{{
            appSettings.billingTimezone
          }}</span>
          <UiThemeToggle />
          <span
            class="flex size-8 items-center justify-center rounded-full border bg-surface-raised text-xs font-semibold"
            >AD</span
          >
        </div>
      </header>

      <main
        class="technical-grid min-h-[calc(100vh-4rem)] px-4 py-5 md:px-6 md:py-7 lg:px-8 lg:py-8"
      >
        <slot />
      </main>
    </div>
  </div>
</template>
