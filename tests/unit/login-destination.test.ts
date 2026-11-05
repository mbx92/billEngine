import { describe, expect, it } from 'vitest'
import { loginDestination, safeLoginRedirect } from '../../shared/utils/login-destination'

describe('portal login destinations', () => {
  it('keeps a customer on the requested invoice', () => {
    expect(loginDestination('customer', '/portal/invoices/inv-1?source=gate', 'customer-1')).toBe(
      '/portal/invoices/inv-1?source=gate',
    )
    expect(loginDestination('customer', '/servers', 'customer-1')).toBe('/portal')
    expect(loginDestination('customer', '/portal-other', 'customer-1')).toBe('/portal')
  })
  it.each(['admin', 'super_admin'] as const)('preserves invoice context for %s', (role) => {
    expect(loginDestination(role, '/portal/invoices/inv-1')).toBe('/invoices/inv-1')
    expect(loginDestination(role, '/portal/invoices')).toBe('/invoices')
    expect(loginDestination(role, '/portal/services')).toBe('/services')
    expect(loginDestination(role, '/portal')).toBe('/')
  })
  it('directs an unlinked customer to an actionable access page without looping', () => {
    expect(loginDestination('customer', '/portal/invoices/inv-1', null)).toBe('/portal/access')
    expect(loginDestination('customer', '/portal/access', null)).toBe('/portal/access')
    expect(loginDestination('customer', '/portal/access', 'customer-1')).toBe('/portal')
  })
  it.each([
    'https://other.test',
    '//other.test',
    '/\\other.test',
    '/path\nother',
    '/login?redirect=/login',
    '/api/auth/sign-out',
    '/x/../login',
    null,
    ['//other.test'],
  ])('rejects unsafe or looping destination %s', (target) => {
    expect(safeLoginRedirect(target)).toBeNull()
    expect(loginDestination('customer', target, 'customer-1')).toBe('/portal')
    expect(loginDestination('admin', target)).toBe('/')
  })
})
