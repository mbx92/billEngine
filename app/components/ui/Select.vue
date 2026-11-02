<script setup lang="ts" generic="T extends string | null">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    modelValue: T
    options: readonly { value: T; label: string; disabled?: boolean }[]
    placeholder?: string
    disabled?: boolean
    required?: boolean
    name?: string
    size?: 'sm' | 'md'
  }>(),
  { placeholder: 'Pilih opsi', size: 'md', name: undefined },
)
const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [value: T] }>()
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const menu = useTemplateRef<HTMLElement>('menu')
const native = useTemplateRef<HTMLSelectElement>('native')
const id = useId()
const open = ref(false)
const active = ref(-1)
const invalid = ref(false)
const portalTarget = ref<HTMLElement | string>('body')
const position = ref<Record<string, string>>({})
const selected = computed(() =>
  props.options.findIndex((option) => option.value === props.modelValue),
)
let search = ''
let searchTime = 0

function place() {
  if (!open.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - 12
  const above = rect.top - 12
  const upwards = below < 240 && above > below
  position.value = {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`,
    width: `${Math.min(rect.width, window.innerWidth - 16)}px`,
    maxHeight: `${Math.max(0, Math.min(288, upwards ? above : below))}px`,
    ...(upwards
      ? { bottom: `${window.innerHeight - rect.top + 4}px` }
      : { top: `${rect.bottom + 4}px` }),
  }
}

function reveal() {
  void nextTick(() =>
    menu.value
      ?.querySelector(`#${CSS.escape(id)}-option-${active.value}`)
      ?.scrollIntoView({ block: 'nearest' }),
  )
}

function show() {
  if (props.disabled) return
  active.value =
    selected.value >= 0 && !props.options[selected.value]?.disabled
      ? selected.value
      : props.options.findIndex((option) => !option.disabled)
  open.value = true
  place()
  reveal()
}

function choose(index: number) {
  const option = props.options[index]
  if (!option || option.disabled || props.disabled) return
  if (props.modelValue !== option.value) {
    emit('update:modelValue', option.value)
    emit('change', option.value)
  }
  invalid.value = false
  open.value = false
  trigger.value?.focus()
}

function move(direction: number) {
  for (let i = active.value + direction; i >= 0 && i < props.options.length; i += direction) {
    if (!props.options[i]?.disabled) {
      active.value = i
      reveal()
      return
    }
  }
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  if (event.key === 'Tab') {
    open.value = false
    return
  }
  if (event.key === 'Escape') {
    if (open.value) {
      event.preventDefault()
      event.stopPropagation()
      open.value = false
    }
    return
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    if (!open.value) {
      show()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') choose(active.value)
    else if (event.key === 'Home') {
      active.value = -1
      move(1)
    } else if (event.key === 'End') {
      active.value = props.options.length
      move(-1)
    } else move(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    if (!open.value) show()
    search = Date.now() - searchTime > 700 ? event.key : search + event.key
    searchTime = Date.now()
    const query = search.toLocaleLowerCase()
    for (let offset = 1; offset <= props.options.length; offset++) {
      const index = (active.value + offset) % props.options.length
      const option = props.options[index]!
      if (!option.disabled && option.label.toLocaleLowerCase().startsWith(query)) {
        active.value = index
        reveal()
        break
      }
    }
  }
}

function outside(event: PointerEvent) {
  const target = event.target as Node
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) open.value = false
}

function onInvalid() {
  invalid.value = true
  trigger.value?.focus()
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false
  },
)
watch(
  () => props.options,
  () => {
    if (open.value && (!props.options[active.value] || props.options[active.value]?.disabled)) {
      active.value = props.options.findIndex((option) => !option.disabled)
      reveal()
    }
  },
)
watch(
  () => props.modelValue,
  () => {
    invalid.value = false
  },
)
onMounted(() => {
  portalTarget.value = trigger.value?.closest<HTMLElement>('[role="dialog"]') ?? 'body'
  document.addEventListener('pointerdown', outside)
  window.addEventListener('resize', place)
  document.addEventListener('scroll', place, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', place)
  document.removeEventListener('scroll', place, true)
})
</script>

<template>
  <span class="relative inline-block min-w-0" :class="size === 'sm' ? 'max-w-full' : 'w-full'">
    <button
      v-bind="$attrs"
      :id="($attrs.id as string) || id"
      ref="trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="`${id}-list`"
      :aria-activedescendant="open && active >= 0 ? `${id}-option-${active}` : undefined"
      :aria-required="required || undefined"
      :aria-invalid="invalid || undefined"
      :disabled="disabled"
      class="focus-ring flex w-full items-center justify-between gap-3 rounded-md border bg-canvas text-left text-ink transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
      :class="[
        size === 'sm' ? 'h-8 px-2 text-xs' : 'h-10 px-3 text-sm',
        invalid ? 'border-danger' : 'border-line-strong',
      ]"
      @click="open ? (open = false) : show()"
      @keydown="onKeydown"
      @blur="open = false"
    >
      <span
        class="truncate"
        :class="selected < 0 || options[selected]?.disabled ? 'text-muted' : undefined"
        >{{ options[selected]?.label ?? placeholder }}</span
      >
      <ChevronDown
        :size="15"
        class="shrink-0 text-muted transition-transform"
        :class="{ 'rotate-180': open }"
        aria-hidden="true"
      />
    </button>
    <!-- Preserve native form validation without exposing a second interactive control. -->
    <select
      ref="native"
      :value="modelValue ?? ''"
      :name="name"
      :required="required"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
      class="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      @invalid.prevent="onInvalid"
      @change="choose(native?.selectedIndex ? native.selectedIndex - 1 : -1)"
    >
      <option value="" disabled />
      <option
        v-for="(option, index) in options"
        :key="index"
        :value="option.value ?? ''"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
    <Teleport :to="portalTarget">
      <ul
        v-if="open"
        :id="`${id}-list`"
        ref="menu"
        role="listbox"
        :aria-labelledby="($attrs.id as string) || id"
        :style="position"
        class="fixed z-[100] overflow-y-auto overscroll-contain rounded-md border border-line-strong bg-surface p-1 text-sm text-ink shadow-xl"
        @pointerdown.prevent
      >
        <li
          v-for="(option, index) in options"
          :id="`${id}-option-${index}`"
          :key="index"
          role="option"
          :aria-selected="index === selected"
          :aria-disabled="option.disabled || undefined"
          class="flex items-center gap-2 rounded px-2 py-2"
          :class="[
            option.disabled ? 'cursor-not-allowed text-muted opacity-50' : 'cursor-pointer',
            index === active ? 'bg-surface-raised' : '',
            index === selected ? 'font-semibold text-brand' : '',
          ]"
          @pointermove="!option.disabled && (active = index)"
          @click="choose(index)"
        >
          <span class="min-w-0 flex-1 break-words">{{ option.label }}</span>
          <Check v-if="index === selected" :size="15" class="shrink-0" aria-hidden="true" />
        </li>
        <li v-if="!options.length" role="presentation" class="px-2 py-3 text-muted">
          Tidak ada pilihan
        </li>
      </ul>
    </Teleport>
  </span>
</template>
