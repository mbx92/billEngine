import { describe, expect, it } from 'vitest'
import {
  createDeploymentBlueprintSchema,
  queueProvisioningJobSchema,
  updateDeploymentBlueprintSchema,
} from '../../shared/schemas/provisioning'

describe('provisioning schemas', () => {
  const blueprint = {
    coolifyServerId: '00000000-0000-4000-8000-000000000001',
    name: 'OpsWiki Standard',
    slug: 'opswiki-standard',
    repositoryUrl: 'https://github.com/example/opswiki',
    branch: 'main',
    buildPack: 'dockercompose',
    projectUuid: 'project-1',
    targetServerUuid: 'server-1',
    environmentName: 'production',
    dockerComposeLocation: '/docker-compose.yml',
    environmentKeys: ['DATABASE_URL', 'APP_SECRET'],
    billingGateEnabled: false,
  }

  it('accepts a reusable Docker Compose blueprint', () => {
    expect(createDeploymentBlueprintSchema.parse(blueprint)).toMatchObject({
      slug: 'opswiki-standard',
      environmentKeys: ['DATABASE_URL', 'APP_SECRET'],
    })
  })

  it('extracts environment keys from dotenv-style input without retaining secrets', () => {
    const parsed = createDeploymentBlueprintSchema.parse({
      ...blueprint,
      environmentKeys: [
        'JWT_SECRET="do-not-store-this-value"',
        'export JWT_EXPIRES_IN="7d"',
        'NODE_ENV=production',
        'BASE_URL=http://localhost:3000',
      ],
    })

    expect(parsed.environmentKeys).toEqual(['JWT_SECRET', 'JWT_EXPIRES_IN', 'NODE_ENV', 'BASE_URL'])
  })

  it('allows the server to generate labels when a blueprint enables the billing gate', () => {
    expect(
      createDeploymentBlueprintSchema.parse({ ...blueprint, billingGateEnabled: true }),
    ).toMatchObject({ billingGateEnabled: true })
  })

  it('validates a complete editable blueprint', () => {
    expect(updateDeploymentBlueprintSchema.parse({ ...blueprint, isActive: false })).toMatchObject({
      slug: 'opswiki-standard',
      isActive: false,
    })
  })

  it('requires the selected Docker build file location', () => {
    expect(() =>
      createDeploymentBlueprintSchema.parse({
        ...blueprint,
        buildPack: 'dockerfile',
        dockerComposeLocation: undefined,
      }),
    ).toThrow(/Lokasi Dockerfile/)
  })

  it('requires hostname and domain type together', () => {
    expect(() =>
      queueProvisioningJobSchema.parse({
        blueprintId: '00000000-0000-4000-8000-000000000001',
        serviceId: '00000000-0000-4000-8000-000000000002',
        applicationName: 'Customer App',
        hostname: 'customer.example.com',
      }),
    ).toThrow(/Hostname dan tipe domain/)
  })

  it('accepts an optional SQL import and rejects non-SQL files', () => {
    const input = {
      blueprintId: '00000000-0000-4000-8000-000000000001',
      serviceId: '00000000-0000-4000-8000-000000000002',
      applicationName: 'Customer App',
      sqlImport: { filename: 'schema.sql', content: 'create table posts (id uuid);' },
    }
    expect(queueProvisioningJobSchema.parse(input).sqlImport?.filename).toBe('schema.sql')
    expect(() =>
      queueProvisioningJobSchema.parse({
        ...input,
        sqlImport: { filename: 'schema.txt', content: 'select 1' },
      }),
    ).toThrow(/berekstensi .sql/)
  })
})
