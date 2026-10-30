<script setup lang="ts" generic="T extends string | number | null">
import { Check, ChevronDown, Search } from '@lucide/vue'
import type { StyleValue } from 'vue'

defineOptions({ inheritAttrs: false })

const model = defineModel<T>()
const props = withDefaults(
  defineProps<{
    options: readonly { value: string | number | null; label: string; disabled?: boolean }[]
    placeholder?: string
    searchPlaceholder?: string
    emptyText?: string
    disabled?: boolean
    required?: boolean
    name?: string
    form?: string
    size?: 'sm' | 'md' | 'lg'
  }>(),
  {
    placeholder: 'Pilih opsi',
    searchPlaceholder: 'Cari pilihan...',
    emptyText: 'Tidak ada pilihan yang cocok.',
    disabled: false,
    required: false,
    name: undefined,
    form: undefined,
    size: 'lg',
  },
)
const emit = defineEmits<{ change: [value: T] }>()
const attrs = useAttrs()
const id = useId()
const root = useTemplateRef<HTMLElement>('root')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const panel = useTemplateRef<HTMLElement>('panel')
const search = useTemplateRef<HTMLInputElement>('search')
const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)
const position = ref<Record<string, string>>({})

const selected = computed(() => props.options.find((option) => option.value === model.value))
const filtered = computed(() => {
  const words = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return props.options.filter((option) =>
    words.every((word) => option.label.toLocaleLowerCase().includes(word)),
  )
})
const activeId = computed(() =>
  activeIndex.value >= 0 ? `${id}-option-${activeIndex.value}` : undefined,
)

function positionPanel() {
  if (!open.value || !trigger.value || !panel.value) return
  const rect = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const viewportTop = viewport?.offsetTop ?? 0
  const viewportLeft = viewport?.offsetLeft ?? 0
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const below = viewportTop + height - rect.bottom - 12
  const above = rect.top - viewportTop - 12
  const placeAbove = below < 240 && above > below
  const availableHeight = Math.max(0, placeAbove ? above : below)
  const panelHeight = Math.min(320, availableHeight)
  const panelWidth = Math.min(Math.max(rect.width, 240), width - 16)
  position.value = {
    width: `${panelWidth}px`,
    maxHeight: `${panelHeight}px`,
    left: `${Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + width - panelWidth - 8))}px`,
    top: placeAbove ? 'auto' : `${rect.bottom + 6}px`,
    bottom: placeAbove ? `${window.innerHeight - rect.top + 6}px` : 'auto',
  }
}

function revealActive() {
  void nextTick(() => {
    if (!open.value || !activeId.value) return
    const option = document.getElementById(activeId.value)
    const list = option?.parentElement
    if (!option || !list) return
    const optionRect = option.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    // Scroll only the options, leaving the surrounding dialog/page in place.
    if (optionRect.top < listRect.top) list.scrollTop += optionRect.top - listRect.top
    else if (optionRect.bottom > listRect.bottom)
      list.scrollTop += optionRect.bottom - listRect.bottom
  })
}

function resetActive() {
  const selectedIndex = filtered.value.findIndex(
    (option) => option.value === model.value && !option.disabled,
  )
  activeIndex.value =
    selectedIndex >= 0 ? selectedIndex : filtered.value.findIndex((option) => !option.disabled)
  revealActive()
}

async function show(initialQuery = '') {
  if (props.disabled || open.value) return
  query.value = initialQuery
  open.value = true
  resetActive()
  await nextTick()
  if (!open.value || !panel.value) return
  // The top layer avoids clipping inside scrollable dialogs and tables while
  // retaining DOM ownership for the dialog's focus trap.
  panel.value.showPopover?.()
  positionPanel()
  search.value?.focus({ preventScroll: true })
  revealActive()
}

function close(restoreFocus = false) {
  if (!open.value) return
  panel.value?.hidePopover?.()
  open.value = false
  query.value = ''
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}

function choose(index: number) {
  const option = filtered.value[index]
  if (!option || option.disabled || props.disabled) return
  const changed = option.value !== model.value
  model.value = option.value as T
  close(true)
  if (changed) emit('change', option.value as T)
}

function move(direction: number) {
  const count = filtered.value.length
  for (let step = 1; step <= count; step++) {
    const index = (activeIndex.value + direction * step + count) % count
    if (!filtered.value[index]?.disabled) {
      activeIndex.value = index
      revealActive()
      return
    }
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  } else if (event.key === 'Tab' && open.value) {
    // Continue normal tab order from the trigger, including Shift+Tab.
    close(true)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value) void show()
    else move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter' && open.value) {
    event.preventDefault()
    choose(activeIndex.value)
  } else if (open.value && (event.key === 'Home' || event.key === 'End') && event.altKey) {
    event.preventDefault()
    activeIndex.value = event.key === 'Home' ? -1 : 0
    move(event.key === 'Home' ? 1 : -1)
  } else if (
    !open.value &&
    event.target === trigger.value &&
    event.key.length === 1 &&
    event.key !== ' ' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault()
    void show(event.key)
  }
}

function onOutside(event: Event) {
  if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) close()
}

function onScroll(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) return
  positionPanel()
}

function onInvalid(event: Event) {
  event.preventDefault()
  const select = event.target as HTMLSelectElement
  // A submit validates every field; focus only the first invalid one.
  const firstInvalid = Array.from(select.form?.elements ?? []).find((element) =>
    element.matches('input:invalid, select:invalid, textarea:invalid'),
  )
  if (!select.form || firstInvalid === select) void show()
}

watch(filtered, () => {
  if (!open.value) return
  resetActive()
  void nextTick(positionPanel)
})
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close()
  },
)

// Attach global listeners only while a select is open.
watch(open, (isOpen, _previous, onCleanup) => {
  if (!isOpen) return
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('focusin', onOutside)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', positionPanel)
  window.visualViewport?.addEventListener('resize', positionPanel)
  window.visualViewport?.addEventListener('scroll', positionPanel)
  onCleanup(() => {
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('focusin', onOutside)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', positionPanel)
    window.visualViewport?.removeEventListener('resize', positionPanel)
    window.visualViewport?.removeEventListener('scroll', positionPanel)
  })
})
</script>

<template>
  <span
    ref="root"
    class="relative inline-flex min-w-0 align-middle"
    :class="attrs.class"
    :style="attrs.style as StyleValue"
    @keydown="onKeydown"
  >
    <button
      :id="id"
      ref="trigger"
      v-bind="
        Object.fromEntries(
          Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style'),
        )
      "
      type="button"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="`${id}-listbox`"
      class="focus-ring flex w-full min-w-0 items-center justify-between gap-3 rounded-md border border-line-strong bg-surface px-3 text-left text-ink transition-colors hover:border-muted/60 disabled:cursor-not-allowed disabled:bg-surface-raised disabled:opacity-60"
      :class="{
        'h-8 text-xs': size === 'sm',
        'h-9 text-sm': size === 'md',
        'h-10 text-sm': size === 'lg',
      }"
      @click="open ? close(true) : show()"
    >
      <span class="truncate" :class="!selected || selected.disabled ? 'text-muted' : undefined">
        {{ selected?.label ?? placeholder }}
      </span>
      <ChevronDown
        :size="15"
        class="shrink-0 text-muted transition-transform"
        :class="{ 'rotate-180': open }"
        aria-hidden="true"
      />
    </button>

    <!-- Preserve native required validation, form submission and typed values. -->
    <select
      v-model="model"
      :name="name"
      :form="form"
      :required="required"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
      class="pointer-events-none sr-only"
      @invalid="onInvalid"
      @change="emit('change', model as T)"
    >
      <option v-if="!selected" value="" disabled>{{ placeholder }}</option>
      <option
        v-for="(option, index) in options"
        :key="index"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>

    <span
      v-show="open"
      ref="panel"
      popover="manual"
      class="select-popover fixed inset-auto z-[100] m-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface text-sm text-ink shadow-xl"
      :style="position"
      @click.prevent
    >
      <span class="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Search :size="16" class="shrink-0 text-muted" aria-hidden="true" />
        <input
          ref="search"
          v-model="query"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          :aria-controls="`${id}-listbox`"
          :aria-activedescendant="activeId"
          :aria-label="searchPlaceholder"
          :placeholder="searchPlaceholder"
          autocomplete="off"
          class="h-8 min-w-0 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none"
        />
      </span>
      <span
        :id="`${id}-listbox`"
        role="listbox"
        :aria-label="String(attrs['aria-label'] || placeholder)"
        class="min-h-0 overflow-y-auto overscroll-contain p-1"
      >
        <span
          v-for="(option, index) in filtered"
          :id="`${id}-option-${index}`"
          :key="index"
          role="option"
          :aria-selected="option.value === model"
          :aria-disabled="option.disabled || undefined"
          class="flex items-center gap-2 rounded px-3 py-2 text-left leading-5"
          :class="[
            option.disabled ? 'cursor-not-allowed text-muted opacity-50' : 'cursor-pointer',
            index === activeIndex ? 'bg-brand/10 text-brand' : '',
            option.value === model ? 'font-medium' : '',
          ]"
          @pointermove="!option.disabled && (activeIndex = index)"
          @mousedown.prevent
          @click.stop.prevent="choose(index)"
        >
          <span class="min-w-0 flex-1 break-words">{{ option.label }}</span>
          <Check
            v-if="option.value === model"
            :size="15"
            class="shrink-0 text-brand"
            aria-hidden="true"
          />
        </span>
        <span
          v-if="!filtered.length"
          role="status"
          class="block px-3 py-6 text-center text-muted"
          >{{ emptyText }}</span
        >
      </span>
    </span>
  </span>
</template>

<style scoped>
.select-popover:popover-open {
  display: flex;
}

@supports not selector(:popover-open) {
  .select-popover {
    display: flex;
  }
}
</style>
