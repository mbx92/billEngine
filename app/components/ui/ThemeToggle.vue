<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue'

const isDark = ref(true)

function syncTheme() {
  isDark.value = document.documentElement.classList.contains('dark')
}

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light'
  localStorage.setItem('billing-theme', isDark.value ? 'dark' : 'light')
}

onMounted(syncTheme)
</script>

<template>
  <button
    type="button"
    class="focus-ring flex size-9 items-center justify-center rounded-md border bg-surface text-muted transition hover:border-line-strong hover:bg-surface-raised hover:text-ink"
    :aria-label="isDark ? 'Aktifkan light mode' : 'Aktifkan dark mode'"
    :title="isDark ? 'Aktifkan light mode' : 'Aktifkan dark mode'"
    @click="toggleTheme"
  >
    <Moon v-if="isDark" :size="17" :stroke-width="1.8" aria-hidden="true" />
    <Sun v-else :size="17" :stroke-width="1.8" aria-hidden="true" />
  </button>
</template>
