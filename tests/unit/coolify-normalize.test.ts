import { describe, expect, it } from 'vitest'
import {
  normalizeCoolifyApplication,
  normalizeCoolifyServer,
  normalizeCoolifyStatus,
} from '../../server/integrations/coolify/normalize'

describe('Coolify normalization', () => {
  it('normalizes provider status variants', () => {
    expect(normalizeCoolifyStatus('running:healthy')).toBe('running')
    expect(normalizeCoolifyStatus('exited')).toBe('stopped')
    expect(normalizeCoolifyStatus('unhealthy')).toBe('degraded')
    expect(normalizeCoolifyStatus(undefined)).toBe('unknown')
  })

  it('creates a stable resource shape from an application', () => {
    const resource = normalizeCoolifyApplication({
      uuid: 'app-123',
      name: 'api-production',
      status: 'running:healthy',
      fqdn: 'https://api.example.test',
      limits_cpus: '1.5',
      limits_memory: '2147483648',
      project: { name: 'customer-a' },
      environment: { name: 'production' },
    })

    expect(resource).toMatchObject({
      coolifyUuid: 'app-123',
      resourceType: 'application',
      status: 'running',
      limitsCpus: '1.5',
      limitsMemoryBytes: 2_147_483_648n,
      projectName: 'customer-a',
      environmentName: 'production',
    })
  })

  it('does not persist secrets returned in Coolify metadata', () => {
    const resource = normalizeCoolifyApplication({
      uuid: 'app-secret',
      name: 'private-app',
      manual_webhook_secret_github: 'do-not-store-me',
      http_basic_auth_password: 'also-private',
      destination: { private_key: 'nested-secret', name: 'production' },
    })

    expect(resource.rawMetadata).toMatchObject({
      manual_webhook_secret_github: '[REDACTED]',
      http_basic_auth_password: '[REDACTED]',
      destination: { private_key: '[REDACTED]', name: 'production' },
    })
  })

  it('links an application to its Coolify server node', () => {
    const resource = normalizeCoolifyApplication({
      uuid: 'app-node',
      name: 'website',
      destination: { server: { uuid: 'node-1' } },
    })

    expect(resource.coolifyNodeUuid).toBe('node-1')
  })

  it('normalizes Coolify server reachability', () => {
    const node = normalizeCoolifyServer({
      uuid: 'node-1',
      name: 'production-node',
      ip: '10.0.0.10',
      port: 22,
      settings: { is_reachable: true, is_usable: true },
    })

    expect(node).toMatchObject({
      coolifyUuid: 'node-1',
      address: '10.0.0.10',
      sshPort: 22,
      status: 'ready',
      isReachable: true,
      isUsable: true,
    })
  })
})
