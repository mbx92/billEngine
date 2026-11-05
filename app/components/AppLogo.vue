<script setup lang="ts">
import { SYSTEM_LOGO as logo } from '#shared/constants/branding'
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="`0 0 ${logo.size} ${logo.size}`"
    role="img"
    :aria-label="logo.label"
  >
    <rect :width="logo.size" :height="logo.size" :rx="logo.radius" :fill="logo.background" />
    <rect
      :x="logo.borderInset"
      :y="logo.borderInset"
      :width="logo.size - 2 * logo.borderInset"
      :height="logo.size - 2 * logo.borderInset"
      :rx="logo.radius - logo.borderInset"
      fill="none"
      :stroke="logo.foreground"
      :stroke-width="logo.borderWidth"
      :stroke-opacity="logo.borderOpacity"
    />
    <text
      :x="logo.size / 2"
      :y="logo.textBaseline"
      text-anchor="middle"
      font-family="Courier New, Courier, monospace"
      :font-size="logo.fontSize"
      font-weight="700"
      :fill="logo.foreground"
    >
      {{ logo.text }}
    </text>
  </svg>
</template>
