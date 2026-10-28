<script setup lang="ts">
withDefaults(defineProps<{ padded?: boolean }>(), { padded: true })
</script>

<template>
  <section class="ui-card rounded-md border bg-surface p-4 sm:p-5" :class="{ '!p-0': !padded }">
    <slot />
  </section>
</template>
