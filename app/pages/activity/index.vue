<script setup lang="ts">
import { RefreshCw } from '@lucide/vue'
import type { ApiActivityListResponse } from '#shared/types/api'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Activity · Billing Infra' })

const format = useFormat()
const page = ref(1)
const perPage = 25

const { data, status, error, refresh } = await useFetch<ApiActivityListResponse>('/api/activity', {
  query: { page, perPage },
})

const entries = computed(() => data.value?.data ?? [])
const jobRuns = computed(() => data.value?.jobRuns ?? [])
const meta = computed(() => data.value?.meta)
</script>

<template>
  <div class="mx-auto max-w-7xl">
    <header class="mb-5 flex flex-col justify-between gap-4 sm:mb-6 sm:flex-row sm:items-end">
      <div>
        <p class="mb-2 font-mono text-[11px] font-semibold tracking-wider text-brand uppercase">
          Operations / audit
        </p>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Activity Log</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Append-oriented audit trail for commercial, infrastructure, and security-sensitive
          changes.
        </p>
      </div>
      <UiButton variant="secondary" :disabled="status === 'pending'" @click="refresh()">
        <RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" />
        Refresh
      </UiButton>
    </header>

    <div class="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <UiCard :padded="false">
        <div class="flex h-11 items-center justify-between border-b px-4">
          <span class="text-xs font-semibold text-muted">Audit trail</span>
          <UiBadge v-if="meta">{{ format.count(meta.total) }} entri</UiBadge>
        </div>

        <div v-if="status === 'pending'" class="space-y-3 p-4">
          <UiSkeleton v-for="row in 4" :key="row" height="2.25rem" />
        </div>

        <UiEmptyState
          v-else-if="error"
          title="Gagal memuat activity log"
          description="Server tidak dapat membaca audit trail. Coba muat ulang halaman."
        >
          <UiButton variant="secondary" size="sm" @click="refresh()">Coba lagi</UiButton>
        </UiEmptyState>

        <UiEmptyState
          v-else-if="entries.length === 0"
          title="Belum ada aktivitas"
          description="Audit trail masih kosong. Perubahan commercial, infrastructure, dan security-sensitive akan tercatat di sini."
        />

        <template v-else>
          <ul class="divide-y">
            <li v-for="entry in entries" :key="entry.id" class="px-4 py-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-mono text-xs font-semibold text-ink">{{ entry.action }}</span>
                <span class="text-xs text-muted">{{ format.dateTime(entry.createdAt) }}</span>
              </div>
              <p class="mt-1 text-xs text-muted">
                {{ entry.entityType }}
                <span v-if="entry.entityId" class="font-mono">· {{ entry.entityId }}</span>
              </p>
              <p class="mt-1 text-xs text-muted">
                Oleh {{ entry.actorName || entry.actorEmail || 'sistem' }}
              </p>
            </li>
          </ul>

          <UiPagination
            v-if="meta"
            :page="meta.page"
            :per-page="meta.perPage"
            :total="meta.total"
            :total-pages="meta.totalPages"
            @update:page="page = $event"
          />
        </template>
      </UiCard>

      <UiCard :padded="false" class="self-start">
        <div class="flex h-11 items-center justify-between border-b px-4">
          <span class="text-xs font-semibold text-muted">Job runs</span>
          <UiBadge v-if="jobRuns.length">{{ format.count(jobRuns.length) }} terakhir</UiBadge>
        </div>

        <div v-if="jobRuns.length === 0" class="px-4 py-6 text-xs text-muted">
          Belum ada background job yang dijalankan.
        </div>

        <ul v-else class="divide-y">
          <li v-for="job in jobRuns" :key="job.id" class="px-4 py-3">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate font-mono text-xs text-ink">{{ job.jobName }}</span>
              <UiBadge
                :tone="
                  job.status === 'failed' ? 'danger' : job.status === 'running' ? 'info' : 'success'
                "
                dot
              >
                {{ job.status }}
              </UiBadge>
            </div>
            <p class="mt-1 text-xs text-muted">
              {{ format.dateTime(job.startedAt) }} · {{ format.count(job.processedCount) }} diproses
            </p>
          </li>
        </ul>
      </UiCard>
    </div>
  </div>
</template>
