export function useAppVersion() {
  const runtime = useRuntimeConfig().public
  const version = computed(() => runtime.appVersion || '0.0.0')
  const revision = computed(() => runtime.appRevision || '')
  const label = computed(() =>
    revision.value ? `v${version.value} · ${revision.value}` : `v${version.value}`,
  )

  return { version, revision, label }
}
