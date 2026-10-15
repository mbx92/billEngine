import { describe, expect, it } from 'vitest'
import {
  deployInfrastructureTemplateSchema,
  infrastructureTemplateDefinitionSchema,
} from '../../shared/schemas/infrastructure-templates'
import { createNativeDatabaseClusterSchema } from '../../shared/schemas/native-database-clusters'
import { provisionNativeServiceDatabaseSchema } from '../../shared/schemas/native-service-databases'

describe('infrastructure template schema', () => {
  it('accepts a persistent PostgreSQL template with generated secret', () => {
    const definition = infrastructureTemplateDefinitionSchema.parse({
      engine: 'postgresql',
      resourceKind: 'database',
      spec: {
        source: { type: 'image', reference: 'postgres:17-alpine' },
        limits: { cpuMilli: 500, memoryBytes: '536870912' },
        ports: [{ containerPort: 5432, protocol: 'tcp' }],
        volumes: [{ name: 'data', mountTarget: '/var/lib/postgresql/data' }],
        restartPolicy: 'unless-stopped',
      },
      parameters: [
        {
          key: 'password',
          label: 'Password',
          environmentKey: 'POSTGRES_PASSWORD',
          type: 'secret',
          generated: true,
        },
      ],
    })

    expect(definition.parameters[0]?.generated).toBe(true)
    expect(definition.spec.volumes[0]?.kind).toBe('persistent')
  })

  it('rejects an invalid host port', () => {
    expect(() =>
      deployInfrastructureTemplateSchema.parse({
        nodeId: '00000000-0000-4000-8000-000000000001',
        name: 'postgres-01',
        hostPort: 70_000,
      }),
    ).toThrow()
  })

  it('keeps secret input separate from the template definition', () => {
    const deployment = deployInfrastructureTemplateSchema.parse({
      nodeId: '00000000-0000-4000-8000-000000000001',
      name: 'mysql-01',
      hostPort: 3306,
      values: { password: 'only-present-at-deploy-time' },
    })

    expect(deployment.values.password).toBe('only-present-at-deploy-time')
    expect(deployment.classification).toBe('internal')
  })
})

describe('native database cluster schema', () => {
  it('accepts activation of an eligible PostgreSQL resource', () => {
    const input = createNativeDatabaseClusterSchema.parse({
      resourceId: '00000000-0000-4000-8000-000000000001',
      name: 'postgresql-01-cluster',
    })

    expect(input.defaultConnectionLimit).toBe(20)
  })

  it('rejects unsafe cluster names', () => {
    expect(() =>
      createNativeDatabaseClusterSchema.parse({
        resourceId: '00000000-0000-4000-8000-000000000001',
        name: 'Billing Production DB',
      }),
    ).toThrow()
  })
})

describe('native service database schema', () => {
  it('defaults application connection secret to DATABASE_URL', () => {
    const input = provisionNativeServiceDatabaseSchema.parse({
      serviceId: '00000000-0000-4000-8000-000000000001',
      applicationResourceId: '00000000-0000-4000-8000-000000000002',
    })

    expect(input.environmentKey).toBe('DATABASE_URL')
  })

  it('rejects unsafe environment keys', () => {
    expect(() =>
      provisionNativeServiceDatabaseSchema.parse({
        serviceId: '00000000-0000-4000-8000-000000000001',
        applicationResourceId: '00000000-0000-4000-8000-000000000002',
        environmentKey: 'DATABASE-URL',
      }),
    ).toThrow()
  })
})
