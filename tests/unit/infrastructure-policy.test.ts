import { describe, expect, it } from 'vitest'
import { applicationSpecSchema } from '../../shared/schemas/infrastructure'
import {
  isUbuntuRelease,
  validateApplicationPolicy,
} from '../../server/services/infrastructure/policy'

function validSpec() {
  return applicationSpecSchema.parse({
    source: { type: 'image', reference: 'ghcr.io/oc/example:1.0.0' },
    limits: { cpuMilli: 500, memoryBytes: '536870912' },
    ports: [{ containerPort: 3000 }],
    volumes: [{ name: 'data', mountTarget: '/app/data' }],
  })
}

describe('native infrastructure policy', () => {
  it('accepts a structured application spec', () => {
    expect(validateApplicationPolicy(validSpec())).toEqual({ allowed: true, violations: [] })
  })

  it('rejects quota excess and duplicate mounts or ports', () => {
    const spec = validSpec()
    spec.limits.cpuMilli = 9_000
    spec.ports.push({ containerPort: 3000, protocol: 'tcp' })
    spec.volumes.push({ name: 'other', mountTarget: '/app/data', kind: 'persistent' })

    const result = validateApplicationPolicy(spec)
    expect(result.allowed).toBe(false)
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CPU'),
        'Port duplikat: 3000/tcp.',
        'Mount target duplikat: /app/data.',
      ]),
    )
  })

  it('only accepts Ubuntu host identity', () => {
    expect(isUbuntuRelease('Ubuntu 24.04.3 LTS')).toBe(true)
    expect(isUbuntuRelease('ubuntu')).toBe(true)
    expect(isUbuntuRelease('Debian GNU/Linux 13')).toBe(false)
  })

  it('rejects Docker option injection and unsafe mount or healthcheck values', () => {
    const base = {
      limits: { cpuMilli: 500, memoryBytes: '536870912' },
    }
    expect(() =>
      applicationSpecSchema.parse({
        ...base,
        source: { type: 'image', reference: '--privileged' },
      }),
    ).toThrow()
    expect(() =>
      applicationSpecSchema.parse({
        ...base,
        source: { type: 'image', reference: 'ghcr.io/oc/app:1' },
        volumes: [{ name: 'data', mountTarget: '/data,readonly=false' }],
      }),
    ).toThrow()
    expect(() =>
      applicationSpecSchema.parse({
        ...base,
        source: { type: 'image', reference: 'ghcr.io/oc/app:1' },
        healthcheck: { path: '/health;cat /etc/passwd', port: 3000 },
      }),
    ).toThrow()
  })
})
