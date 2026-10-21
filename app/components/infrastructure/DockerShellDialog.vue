<script setup lang="ts">
import { LoaderCircle, Play, SquareTerminal } from '@lucide/vue'
import { apiErrorMessage } from '~/lib/api-error'

const props = defineProps<{
  resource: { id: string; name: string }
}>()

const emit = defineEmits<{ close: [] }>()

type OperationStatus =
  'queued' | 'dispatched' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

interface ExecOperation {
  id: string
  status: OperationStatus
  result: { output?: unknown; exitCode?: unknown; truncated?: unknown } | null
  errorCode: string | null
  errorMessage: string | null
}

interface HistoryEntry {
  id: string
  command: string
  status: 'running' | 'succeeded' | 'failed'
  output: string
  exitCode: number | null
  truncated: boolean
}

const command = ref('')
const history = ref<HistoryEntry[]>([])
const running = ref(false)
const errorMessage = ref<string | null>(null)
let active = true

onBeforeUnmount(() => {
  active = false
})

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function waitForOperation(operationId: string) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const response = await $fetch<{ data: ExecOperation }>(
      `/api/infrastructure/resources/${props.resource.id}/exec/${operationId}`,
    )
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(response.data.status)) {
      return response.data
    }
    await delay(1_000)
  }
  throw new Error('Docker sh operation tidak selesai dalam batas waktu.')
}

async function executeCommand() {
  const submittedCommand = command.value.trim()
  if (!submittedCommand || running.value) return

  const entry = reactive<HistoryEntry>({
    id: crypto.randomUUID(),
    command: submittedCommand,
    status: 'running',
    output: '',
    exitCode: null,
    truncated: false,
  })
  history.value.push(entry)
  command.value = ''
  running.value = true
  errorMessage.value = null

  try {
    const response = await $fetch<{ data: { operation: { id: string } } }>(
      `/api/infrastructure/resources/${props.resource.id}/exec`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': `container-exec:${crypto.randomUUID()}` },
        body: { command: submittedCommand },
      },
    )
    const operation = await waitForOperation(response.data.operation.id)
    if (!active) return

    if (operation.status !== 'succeeded') {
      entry.status = 'failed'
      entry.output =
        operation.errorMessage || `Operation berakhir dengan status ${operation.status}.`
      return
    }

    entry.status = 'succeeded'
    entry.output = typeof operation.result?.output === 'string' ? operation.result.output : ''
    entry.exitCode =
      typeof operation.result?.exitCode === 'number' ? operation.result.exitCode : null
    entry.truncated = operation.result?.truncated === true
  } catch (caught) {
    if (!active) return
    entry.status = 'failed'
    entry.output = apiErrorMessage(caught, 'Docker sh gagal dijalankan.')
    errorMessage.value = entry.output
  } finally {
    if (active) running.value = false
  }
}
</script>

<template>
  <UiDialog
    :title="`Docker sh · ${resource.name}`"
    description="Command dijalankan sebagai proses baru melalui /bin/sh -lc di dalam container. Working directory dan environment shell tidak dipertahankan antar-command."
    size="xl"
    fixed-height
    :close-disabled="running"
    @close="emit('close')"
  >
    <div class="flex h-full min-h-0 flex-col gap-4">
      <div
        class="min-h-0 flex-1 overflow-y-auto rounded-md border border-line-strong bg-[#080c10] p-4 font-mono text-xs leading-5 text-slate-200"
        aria-live="polite"
      >
        <div v-if="history.length === 0" class="flex h-full items-center justify-center text-muted">
          <div class="text-center">
            <SquareTerminal :size="30" class="mx-auto mb-3" aria-hidden="true" />
            <p>Masukkan command untuk container yang sedang running.</p>
            <p class="mt-1 text-[10px]">Timeout 30 detik · output maksimal 64 KiB</p>
          </div>
        </div>
        <div v-else class="space-y-5">
          <section v-for="entry in history" :key="entry.id">
            <p class="break-all text-brand">
              <span class="select-none">$ </span>{{ entry.command }}
            </p>
            <div v-if="entry.status === 'running'" class="mt-2 flex items-center gap-2 text-muted">
              <LoaderCircle :size="13" class="animate-spin" aria-hidden="true" />
              Menunggu OC Agent…
            </div>
            <template v-else>
              <pre class="mt-2 whitespace-pre-wrap break-words text-slate-300">{{
                entry.output || '(tanpa output)'
              }}</pre>
              <p
                class="mt-2 text-[10px]"
                :class="entry.status === 'failed' || entry.exitCode ? 'text-danger' : 'text-muted'"
              >
                {{ entry.status === 'failed' ? 'operation failed' : `exit ${entry.exitCode ?? 0}` }}
                <span v-if="entry.truncated"> · output dipotong</span>
              </p>
            </template>
          </section>
        </div>
      </div>

      <form class="flex shrink-0 items-center gap-2" @submit.prevent="executeCommand">
        <span class="font-mono text-sm font-semibold text-brand" aria-hidden="true">$</span>
        <input
          v-model="command"
          type="text"
          maxlength="2000"
          autocomplete="off"
          spellcheck="false"
          autofocus
          placeholder="contoh: ls -la /app"
          class="focus-ring h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm text-ink"
          :disabled="running"
          aria-label="Docker sh command"
        />
        <UiButton type="submit" :disabled="running || !command.trim()">
          <LoaderCircle v-if="running" :size="14" class="animate-spin" aria-hidden="true" />
          <Play v-else :size="14" aria-hidden="true" />
          Jalankan
        </UiButton>
      </form>
      <p v-if="errorMessage" class="text-xs text-danger" role="alert">{{ errorMessage }}</p>
    </div>
  </UiDialog>
</template>
