export type LoginRole = 'super_admin' | 'admin' | 'customer'

export function safeLoginRedirect(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return null
  const url = new URL(value, 'https://billing.invalid')
  if (
    url.origin !== 'https://billing.invalid' ||
    url.pathname === '/login' ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/')
  )
    return null
  return `${url.pathname}${url.search}${url.hash}`
}

export function loginDestination(
  role: LoginRole,
  requested: unknown,
  customerId?: string | null,
): string {
  const target = safeLoginRedirect(requested) ?? (role === 'customer' ? '/portal' : '/')
  const url = new URL(target, 'https://billing.invalid')
  const portal = url.pathname === '/portal' || url.pathname.startsWith('/portal/')
  if (role === 'customer') {
    if (!customerId) return '/portal/access'
    return portal && url.pathname !== '/portal/access' ? target : '/portal'
  }
  if (!portal) return target
  if (url.pathname === '/portal/invoices' || /^\/portal\/invoices\/[^/]+$/.test(url.pathname)) {
    return `${url.pathname.replace('/portal', '')}${url.search}${url.hash}`
  }
  if (url.pathname === '/portal/services') return '/services'
  return '/'
}
