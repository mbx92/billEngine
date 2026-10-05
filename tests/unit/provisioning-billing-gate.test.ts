import { describe, expect, it } from 'vitest'
import { buildProvisioningBillingGateLabels } from '../../server/utils/provisioning-billing-gate'

describe('provisioning billing gate labels', () => {
  it('builds a self-contained Docker middleware chain', () => {
    const labels = buildProvisioningBillingGateLabels({
      namespace: 'BillEngine Job 123',
      sharedKey: 'hidden-key',
      forwardAuthAddress: 'http://host.docker.internal:8010/api/billing-gate/check',
    })

    expect(labels).toContain(
      'coolify.traefik.middlewares=billengine-job-123-billing-gate@docker',
    )
    expect(labels).toContain('X-Billing-Gate-Key=hidden-key')
    expect(labels).toContain(
      'billengine-job-123-billing-forward.forwardauth.address=http://host.docker.internal:8010/api/billing-gate/check',
    )
    expect(labels).toContain(
      'billengine-job-123-billing-gate.chain.middlewares=billengine-job-123-billing-key,billengine-job-123-billing-forward,billengine-job-123-billing-key-clear',
    )
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
    expect(labels).toContain('coolify.traefik.middlewares=gzip@file,digarasi-billing-gate@docker')
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
})
