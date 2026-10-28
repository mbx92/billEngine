export function usePageLoading() {
  const pendingOperations = useState<number>('page-loading-operations', () => 0)
  const active = computed(() => pendingOperations.value > 0)

  async function run<T>(action: () => Promise<T> | T) {
    pendingOperations.value += 1

    try {
      return await action()
    } finally {
      pendingOperations.value = Math.max(0, pendingOperations.value - 1)
    }
  }

  return { active: readonly(active), run }
}
