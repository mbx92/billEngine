<script setup lang="ts">
import { X } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    size?: 'md' | 'lg' | 'xl'
    closeDisabled?: boolean
  }>(),
  { description: undefined, size: 'lg', closeDisabled: false },
)

const emit = defineEmits<{ close: [] }>()
const panel = useTemplateRef<HTMLElement>('panel')
const titleId = useId()
const descriptionId = useId()
let previousFocus: HTMLElement | null = null
let previousBodyOverflow = ''

const sizeClass = computed(() => ({ md: 'max-w-xl', lg: 'max-w-2xl', xl: 'max-w-4xl' })[props.size])

function close() {
  if (!props.closeDisabled) emit('close')
}

function focusableElements() {
  return Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  )
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return

  const elements = focusableElements()
  if (elements.length === 0) return
  const first = elements[0]!
  const last = elements[elements.length - 1]!

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previousFocus = document.activeElement as HTMLElement | null
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  await nextTick()
  const preferred = panel.value?.querySelector<HTMLElement>('[autofocus]')
  ;(preferred ?? focusableElements()[0] ?? panel.value)?.focus()
})

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow
  document.removeEventListener('keydown', onKeydown)
  previousFocus?.focus()
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      @mousedown.self="close"
    >
      <section
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="description ? descriptionId : undefined"
        tabindex="-1"
        class="flex max-h-[calc(100dvh-1rem)] w-full flex-col rounded-t-xl border border-line-strong bg-surface shadow-2xl shadow-black/40 outline-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl"
        :class="sizeClass"
      >
        <header class="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 :id="titleId" class="text-base font-semibold text-ink">{{ title }}</h2>
            <p v-if="description" :id="descriptionId" class="mt-1 text-xs leading-5 text-muted">
              {{ description }}
            </p>
          </div>
          <button
            type="button"
            class="focus-ring flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-40"
            :disabled="closeDisabled"
            aria-label="Tutup dialog"
            @click="close"
          >
            <X :size="17" aria-hidden="true" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="shrink-0 border-t bg-canvas/40 px-5 py-4">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>
