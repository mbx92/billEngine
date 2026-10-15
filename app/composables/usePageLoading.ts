const minimumLoadingDuration = 600

export function usePageLoading() {
  const pendingOperations = useState<number>('page-loading-operations', () => 0)
  const active = computed(() => pendingOperations.value > 0)

  async function run<T>(action: () => Promise<T> | T) {
    const startedAt = Date.now()
    pendingOperations.value += 1

    try {
      return await action()
    } finally {
      if (import.meta.client) {
        const remainingDuration = minimumLoadingDuration - (Date.now() - startedAt)

        if (remainingDuration > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, remainingDuration)
          })
        }
      }

      pendingOperations.value = Math.max(0, pendingOperations.value - 1)
    }
  }

  return { active: readonly(active), run }
}
