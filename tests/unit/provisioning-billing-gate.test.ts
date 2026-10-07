import { describe, expect, it } from 'vitest'
import {
  buildProvisioningBillingGateLabels,
  withGateKeyQuery,
} from '../../server/utils/provisioning-billing-gate'

describe('provisioning billing gate labels', () => {
  it('builds a single forwardAuth middleware with gate_key on the URL', () => {
    const labels = buildProvisioningBillingGateLabels({
      namespace: 'BillEngine Job 123',
      sharedKey: 'hidden-key',
      forwardAuthAddress: 'http://host.docker.internal:8010/api/billing-gate/check',
    })

    expect(labels).toContain('coolify.traefik.middlewares=billengine-job-123-billing')
    expect(labels).toContain(
      'billengine-job-123-billing.forwardauth.address=http://host.docker.internal:8010/api/billing-gate/check?gate_key=hidden-key',
    )
    expect(labels).not.toContain('billing-key')
    expect(labels).not.toContain('billing-gate.chain')
  })

  it('preserves unrelated labels and replaces the legacy file middleware', () => {
    const labels = buildProvisioningBillingGateLabels({
      existingLabels:
        'traefik.enable=true\ncoolify.traefik.middlewares=gzip@file,billing-gate@file',
      namespace: 'digarasi',
      sharedKey: 'hidden-key',
      forwardAuthAddress: 'http://gate/check',
    })

    expect(labels).toContain('traefik.enable=true')
    expect(labels).toContain('coolify.traefik.middlewares=gzip@file,digarasi-billing')
    expect(labels).not.toContain('billing-gate@file')
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
