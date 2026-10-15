export type ToastTone = 'success' | 'danger' | 'info'

export interface AppToast {
  id: string
  message: string
  tone: ToastTone
}

export function useToast() {
  const toasts = useState<AppToast[]>('app-toasts', () => [])

  function dismiss(id: string) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function show(message: string, tone: ToastTone = 'info', duration = 3000) {
    const id = crypto.randomUUID()
    toasts.value = [...toasts.value, { id, message, tone }]
    if (import.meta.client) window.setTimeout(() => dismiss(id), duration)
    return id
  }

  return {
    toasts: readonly(toasts),
    dismiss,
    show,
    success: (message: string) => show(message, 'success'),
    error: (message: string) => show(message, 'danger', 4500),
  }
}
