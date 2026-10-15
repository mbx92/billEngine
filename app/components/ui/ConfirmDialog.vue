<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description: string
    confirmLabel?: string
    cancelLabel?: string
    pending?: boolean
    destructive?: boolean
  }>(),
  {
    confirmLabel: 'Konfirmasi',
    cancelLabel: 'Batal',
    pending: false,
    destructive: false,
  },
)

defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <UiDialog
    :title="title"
    :description="description"
    size="md"
    :close-disabled="pending"
    @close="$emit('cancel')"
  >
    <p class="text-sm leading-6 text-muted">
      Pastikan Anda memahami dampak tindakan ini sebelum melanjutkan.
    </p>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UiButton variant="secondary" :disabled="pending" @click="$emit('cancel')">
          {{ cancelLabel }}
        </UiButton>
        <UiButton
          :variant="destructive ? 'danger' : 'primary'"
          :disabled="pending"
          @click="$emit('confirm')"
        >
          {{ pending ? 'Memproses…' : confirmLabel }}
        </UiButton>
      </div>
    </template>
  </UiDialog>
</template>
