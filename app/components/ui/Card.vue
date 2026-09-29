<script setup lang="ts">
withDefaults(defineProps<{ padded?: boolean }>(), { padded: true })
</script>

<template>
  <section
    class="rounded-lg border bg-surface p-4 shadow-sm shadow-black/[0.025] transition-colors sm:p-5 dark:shadow-black/10"
    :class="{ '!p-0': !padded }"
  >
    <slot />
  </section>
</template>
