import { describe, expect, it } from 'vitest'
import {
  buildProvisioningBillingGateLabels,
  withGateKeyQuery,
} from '../../server/utils/provisioning-billing-gate'

describe('provisioning billing gate labels', () => {
  it('attaches only billing-gate@file without docker middleware definitions', () => {
    const labels = buildProvisioningBillingGateLabels({
      namespace: 'BillEngine Job 123',
      sharedKey: 'hidden-key',
      forwardAuthAddress: 'http://host.docker.internal:8010/api/billing-gate/check',
    })

    expect(labels).toBe('coolify.traefik.middlewares=billing-gate@file')
    expect(labels).not.toContain('forwardauth')
    expect(labels).not.toContain('billing-key')
    expect(labels).not.toContain('gate_key=')
  })

  it('preserves unrelated labels and replaces docker billing middleware names', () => {
    const labels = buildProvisioningBillingGateLabels({
      existingLabels:
        'traefik.enable=true\ncoolify.traefik.middlewares=gzip@file,digarasi-billing',
      namespace: 'digarasi',
      sharedKey: 'hidden-key',
      forwardAuthAddress: 'http://gate/check',
    })

    expect(labels).toContain('traefik.enable=true')
    expect(labels).toContain('coolify.traefik.middlewares=gzip@file,billing-gate@file')
    expect(labels).not.toContain('digarasi-billing')
  })

  it('rejects multiline secret values', () => {
    expect(() =>
      buildProvisioningBillingGateLabels({
        namespace: 'digarasi',
        sharedKey: 'secret\ntraefik.enable=false',
        forwardAuthAddress: 'http://gate/check',
      }),
    ).toThrow(/shared key billing gate tidak valid/)
  })

  it('appends gate_key without dropping existing query params', () => {
    expect(withGateKeyQuery('http://gate/check?x=1', 'secret')).toBe(
      'http://gate/check?x=1&gate_key=secret',
    )
  })
})
