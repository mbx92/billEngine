export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Browsers commonly block the Clipboard API on development HTTP origins.
    }
  }

  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  input.style.pointerEvents = 'none'
  document.body.appendChild(input)
  input.select()
  input.setSelectionRange(0, value.length)
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Clipboard is unavailable.')
}
