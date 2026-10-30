<template>
  <div class="relative flex min-h-dvh flex-col bg-canvas">
    <div class="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
      <UiThemeToggle />
    </div>
    <main class="flex min-w-0 flex-1 items-center justify-center px-5 py-16 sm:px-8 sm:py-20">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
