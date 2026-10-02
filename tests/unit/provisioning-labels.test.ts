import { describe, expect, it } from 'vitest'
import {
  addBillingGateTraefikLabel,
  removeBillingGateTraefikLabel,
} from '../../shared/utils/provisioning-labels'

describe('provisioning Traefik labels', () => {
  it('adds the billing gate middleware to an empty label editor', () => {
    expect(addBillingGateTraefikLabel('')).toBe(
      'coolify.traefik.middlewares=billing-gate@file',
    )
  })

  it('preserves custom labels and existing middleware', () => {
    expect(
      addBillingGateTraefikLabel(
        'traefik.enable=true\ncoolify.traefik.middlewares=gzip@file',
      ),
    ).toBe(
      'traefik.enable=true\ncoolify.traefik.middlewares=gzip@file,billing-gate@file',
    )
  })

  it('does not add the billing middleware twice', () => {
    const labels = 'coolify.traefik.middlewares=gzip@file,billing-gate@file'
    expect(addBillingGateTraefikLabel(labels)).toBe(labels)
  })

  it('removes only the billing gate middleware', () => {
    expect(
      removeBillingGateTraefikLabel(
        'traefik.enable=true\ncoolify.traefik.middlewares=gzip@file,billing-gate@file',
      ),
    ).toBe('traefik.enable=true\ncoolify.traefik.middlewares=gzip@file')
  })
})
