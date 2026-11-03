import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineEventHandler } from 'h3'
import { DomainError } from '../../server/utils/errors'

const { constructed } = vi.hoisted(() => ({ constructed: vi.fn() }))
vi.mock('../../server/services/billing/gateway-management-service', () => ({
  GatewayManagementService: vi.fn(function () {
    constructed()
  }),
}))
vi.mock('../../server/services/billing/proxy-gateway-service', () => ({
  ProxyGatewayService: vi.fn(function () {
    constructed()
  }),
}))

describe('gateway management admin boundary', () => {
  beforeAll(() => {
    vi.stubGlobal('defineEventHandler', defineEventHandler)
    vi.stubGlobal('requireAdmin', vi.fn().mockRejectedValue(DomainError.forbidden()))
  })
  afterAll(() => vi.unstubAllGlobals())
  it('rejects non-admin access before inspecting credentials or making outbound requests', async () => {
    const handlers = [
      (await import('../../server/api/settings/gateway.get')).default,
      (await import('../../server/api/settings/gateway.put')).default,
      (await import('../../server/api/settings/gateway-yaml.post')).default,
      (await import('../../server/api/resources/[id]/gateway.get')).default,
      (await import('../../server/api/resources/[id]/gateway.post')).default,
      (await import('../../server/api/resources/[id]/gateway-verify.post')).default,
      (await import('../../server/api/resources/nodes/[id]/gateway.get')).default,
      (await import('../../server/api/resources/nodes/[id]/gateway-preview.post')).default,
      (await import('../../server/api/resources/nodes/[id]/gateway.post')).default,
    ]
    for (const handler of handlers)
      await expect(handler({} as never)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(constructed).not.toHaveBeenCalled()
  })
})
