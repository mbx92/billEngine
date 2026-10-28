<script setup lang="ts">
import {
  Activity as ActivityIcon,
  Archive,
  BarChart3,
  Boxes,
  CreditCard,
  Database,
  FileCode2,
  FileText,
  GalleryVerticalEnd,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Network,
  Package,
  Search,
  Server as ServerIcon,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  X,
} from '@lucide/vue'
import type { ApiCurrentUser } from '#shared/types/api'
import type { Component } from 'vue'
import { authClient } from '~/lib/auth-client'

const route = useRoute()
const mobileOpen = ref(false)
const desktop = ref(false)
const searchOpen = ref(false)
const searchQuery = ref('')
const sidebar = useTemplateRef<HTMLElement>('sidebar')
const menuButton = useTemplateRef<HTMLButtonElement>('menuButton')
const appSettings = useAppSettings()
const appVersion = useAppVersion()
const { data: currentUserResponse } = await useFetch<{ data: ApiCurrentUser }>('/api/me')
const currentUser = computed(() => currentUserResponse.value?.data)
const isCustomer = computed(() => currentUser.value?.role === 'customer')
const isSuperAdmin = computed(() => currentUser.value?.role === 'super_admin')
const { data: settingsResponse } = await useFetch<{ data: typeof appSettings.value }>(
  '/api/settings',
)

watchEffect(() => {
  if (settingsResponse.value?.data) appSettings.value = settingsResponse.value.data
})

const commercialNavigation = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Plans', to: '/plans', icon: GalleryVerticalEnd },
  { label: 'Services', to: '/services', icon: Layers3 },
  { label: 'Invoices', to: '/invoices', icon: FileText },
  { label: 'Payments', to: '/payments', icon: CreditCard },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
] as const
const infrastructureNavigation = [
  { label: 'Aplikasi', to: '/applications', icon: Package },
  { label: 'Server', to: '/servers', icon: ServerIcon },
  { label: 'Aktivitas', to: '/deployments', icon: ActivityIcon },
] as const
const advancedNavigation = [
  { label: 'Repository & registry', to: '/applications/catalog', icon: Package },
  { label: 'Resources', to: '/resources', icon: Boxes },
  { label: 'Templates', to: '/templates', icon: FileCode2 },
  { label: 'Database Clusters', to: '/database-clusters', icon: Database },
  { label: 'Backups', to: '/backups', icon: Archive },
  { label: 'Tunnels', to: '/tunnels', icon: Network },
  { label: 'Audit log', to: '/activity', icon: ActivityIcon },
] as const
const customerNavigation = [
  { label: 'Ringkasan', to: '/portal', icon: LayoutDashboard },
  { label: 'Invoice', to: '/portal/invoices', icon: FileText },
  { label: 'Layanan', to: '/portal/services', icon: Layers3 },
  { label: 'Akun', to: '/portal/account', icon: Users },
] as const
const navigationGroups = computed<
  { label: string; items: readonly { label: string; to: string; icon: Component }[] }[]
>(() =>
  isCustomer.value
    ? [{ label: 'Customer portal', items: customerNavigation }]
    : [
        { label: 'Billing', items: commercialNavigation },
        { label: 'Infrastructure', items: infrastructureNavigation },
      ],
)
const settingsNavigation = computed(() => [
  ...(isSuperAdmin.value ? [{ label: 'Users & access', to: '/users', icon: ShieldCheck }] : []),
  ...(!isCustomer.value ? [{ label: 'Settings', to: '/settings', icon: SettingsIcon }] : []),
])
const navigationItems = computed(() => [
  ...(!isCustomer.value ? advancedNavigation : []),
  ...navigationGroups.value.flatMap((group) => [...group.items]),
  ...settingsNavigation.value,
])
const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return navigationItems.value.filter((item) => item.label.toLowerCase().includes(query))
})
const currentPage = computed(
  () => navigationItems.value.find((item) => isActive(item.to))?.label || 'Halaman',
)
const currentSection = computed(
  () =>
    (!isCustomer.value && advancedNavigation.some((item) => isActive(item.to))
      ? 'Infrastructure'
      : undefined) ||
    navigationGroups.value.find((group) => group.items.some((item) => isActive(item.to)))?.label ||
    'Administration',
)
const userRole = computed(() =>
  isCustomer.value ? 'Customer' : isSuperAdmin.value ? 'Super administrator' : 'Administrator',
)
const initials = computed(
  () =>
    currentUser.value?.name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'US',
)

function isActive(path: string) {
  if (path === '/' || path === '/portal') return route.path === path
  if (path === '/applications' && route.path === '/applications/catalog') return false
  return route.path === path || route.path.startsWith(`${path}/`)
}

function openSearch() {
  mobileOpen.value = false
  searchQuery.value = ''
  searchOpen.value = true
}

watch(
  () => route.path,
  () => {
    mobileOpen.value = false
    searchOpen.value = false
  },
)

let previousOverflow = ''
watch(mobileOpen, async (open) => {
  if (open) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    await nextTick()
    sidebar.value?.querySelector<HTMLElement>('button')?.focus()
  } else {
    document.body.style.overflow = previousOverflow
    if (!desktop.value) menuButton.value?.focus()
  }
})

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    if (
      document.querySelector('[role="dialog"]') ||
      (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"]'))
    )
      return
    event.preventDefault()
    openSearch()
  }
  if (!mobileOpen.value) return
  if (event.key === 'Escape') mobileOpen.value = false
  if (event.key !== 'Tab') return
  const elements = Array.from(
    sidebar.value?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary') ?? [],
  ).filter((element) => element.getClientRects().length > 0)
  const first = elements[0]
  const last = elements.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

let media: MediaQueryList | undefined
function syncViewport() {
  desktop.value = media?.matches ?? false
  if (desktop.value) mobileOpen.value = false
}
onMounted(() => {
  media = window.matchMedia('(min-width: 1024px)')
  syncViewport()
  media.addEventListener('change', syncViewport)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  media?.removeEventListener('change', syncViewport)
  document.removeEventListener('keydown', onKeydown)
  if (mobileOpen.value) document.body.style.overflow = previousOverflow
})

async function signOut() {
  await authClient.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <a
      href="#main-content"
      class="focus-ring fixed top-3 left-3 z-50 -translate-y-24 rounded bg-surface px-4 py-3 text-sm focus:translate-y-0"
      >Lewati ke konten</a
    >
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/30 lg:hidden"
      aria-hidden="true"
      @click="mobileOpen = false"
    />

    <aside
      id="app-sidebar"
      ref="sidebar"
      :inert="!desktop && !mobileOpen"
      aria-label="Navigasi utama"
      class="fixed inset-y-0 left-0 z-40 flex w-56 flex-col border-r bg-sidebar transition-transform duration-200 lg:translate-x-0"
      :class="mobileOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <NuxtLink
          :to="isCustomer ? '/portal' : '/'"
          class="focus-ring min-w-0 rounded text-sm font-semibold"
          @click="mobileOpen = false"
          ><span class="block truncate">{{ appSettings.companyName }}</span></NuxtLink
        >
        <button
          type="button"
          class="focus-ring flex size-8 shrink-0 items-center justify-center rounded text-muted hover:text-ink lg:hidden"
          aria-label="Tutup navigasi"
          @click="mobileOpen = false"
        >
          <X :size="17" aria-hidden="true" />
        </button>
      </div>
      <nav
        class="sidebar-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pt-2 pb-4"
        aria-label="Menu aplikasi"
      >
        <div v-for="group in navigationGroups" :key="group.label">
          <p class="mb-2 px-2.5 text-[11px] font-medium text-muted">{{ group.label }}</p>
          <div class="space-y-0.5">
            <NuxtLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="focus-ring nav-link"
              :data-active="isActive(item.to)"
              :aria-current="isActive(item.to) ? 'page' : undefined"
              @click="mobileOpen = false"
              ><component
                :is="item.icon"
                :size="15"
                :stroke-width="1.6"
                class="shrink-0"
                aria-hidden="true"
              />{{ item.label }}</NuxtLink
            >
          </div>
        </div>
        <details
          v-if="!isCustomer"
          :open="advancedNavigation.some((item) => isActive(item.to))"
          class="mt-4"
        >
          <summary
            class="focus-ring cursor-pointer rounded px-3 py-2 text-xs text-muted hover:text-ink"
          >
            Pengaturan lanjutan
          </summary>
          <div class="mt-1 space-y-1">
            <NuxtLink
              v-for="item in advancedNavigation"
              :key="item.to"
              :to="item.to"
              class="focus-ring nav-link"
              :data-active="isActive(item.to)"
              :aria-current="isActive(item.to) ? 'page' : undefined"
              @click="mobileOpen = false"
            >
              <component
                :is="item.icon"
                :size="15"
                :stroke-width="1.6"
                class="shrink-0"
                aria-hidden="true"
              />{{ item.label }}
            </NuxtLink>
          </div>
        </details>
      </nav>
      <div class="shrink-0 border-t px-3 py-2">
        <NuxtLink
          v-for="item in settingsNavigation"
          :key="item.to"
          :to="item.to"
          class="focus-ring nav-link"
          :data-active="isActive(item.to)"
          :aria-current="isActive(item.to) ? 'page' : undefined"
          @click="mobileOpen = false"
          ><component :is="item.icon" :size="15" :stroke-width="1.6" aria-hidden="true" />{{
            item.label
          }}</NuxtLink
        >
        <div class="mt-2 flex items-center gap-2.5 border-t px-2 py-3">
          <span
            class="flex size-7 shrink-0 items-center justify-center rounded border text-[10px] text-muted"
            >{{ initials }}</span
          >
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs">{{ currentUser?.name || 'Akun pengguna' }}</p>
            <p class="mt-0.5 text-[10px] text-muted">{{ userRole }}</p>
          </div>
          <button
            type="button"
            class="focus-ring flex size-8 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-raised hover:text-ink"
            aria-label="Sign out"
            title="Sign out"
            @click="signOut"
          >
            <LogOut :size="15" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>

    <div :inert="mobileOpen" class="min-w-0 lg:pl-56">
      <header
        class="flex h-14 items-center justify-between gap-3 border-b bg-canvas px-4 md:px-6 lg:px-8"
      >
        <div class="flex min-w-0 items-center gap-3">
          <button
            ref="menuButton"
            type="button"
            class="focus-ring flex size-8 shrink-0 items-center justify-center rounded border text-muted lg:hidden"
            aria-label="Buka navigasi"
            aria-controls="app-sidebar"
            :aria-expanded="mobileOpen"
            @click="mobileOpen = true"
          >
            <MenuIcon :size="17" aria-hidden="true" />
          </button>
          <div class="flex min-w-0 items-center gap-2 text-xs">
            <span class="hidden text-muted md:inline">{{ currentSection }}</span
            ><span class="hidden text-line-strong md:inline" aria-hidden="true">/</span
            ><span class="truncate">{{ currentPage }}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <button
            type="button"
            class="focus-ring flex h-8 items-center gap-2 rounded px-2 text-muted hover:bg-surface-raised hover:text-ink"
            aria-label="Cari halaman"
            aria-haspopup="dialog"
            @click="openSearch"
          >
            <Search :size="15" aria-hidden="true" /><span class="hidden text-xs sm:block">Cari</span
            ><kbd class="ml-3 hidden rounded border px-1 py-0.5 text-[10px] lg:block">Ctrl K</kbd>
          </button>
          <UiThemeToggle />
        </div>
      </header>
      <main
        id="main-content"
        tabindex="-1"
        class="app-content min-h-[calc(100vh-3.5rem)] px-4 py-6 outline-none md:px-6 lg:px-8 lg:py-8"
      >
        <slot />
        <footer
          class="mx-auto mt-12 flex max-w-7xl flex-wrap items-center justify-between gap-3 border-t pt-4 text-[10px] text-muted"
        >
          <span>{{ appSettings.billingTimezone }}</span
          ><span>{{ appVersion.label }}</span>
        </footer>
      </main>
    </div>

    <UiDialog v-if="searchOpen" title="Cari halaman" size="md" @close="searchOpen = false">
      <div class="relative">
        <Search
          :size="16"
          class="pointer-events-none absolute top-3 left-3 text-muted"
          aria-hidden="true"
        /><input
          v-model="searchQuery"
          type="search"
          autofocus
          aria-label="Nama halaman"
          aria-controls="navigation-results"
          placeholder="Nama halaman"
          class="focus-ring h-10 w-full rounded-md border bg-canvas pr-3 pl-10 text-sm"
        />
      </div>
      <div id="navigation-results" class="mt-3 max-h-[50vh] overflow-y-auto">
        <NuxtLink
          v-for="item in searchResults"
          :key="item.to"
          :to="item.to"
          class="focus-ring flex items-center gap-3 rounded px-3 py-2 text-sm hover:bg-surface-raised"
          @click="searchOpen = false"
          ><component :is="item.icon" :size="16" class="text-muted" aria-hidden="true" />{{
            item.label
          }}</NuxtLink
        >
        <p v-if="!searchResults.length" role="status" class="px-3 py-6 text-sm text-muted">
          Halaman “{{ searchQuery }}” tidak ditemukan.
        </p>
      </div>
    </UiDialog>
  </div>
</template>
