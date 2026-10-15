import { randomBytes, randomUUID } from 'node:crypto'
import {
  infrastructureTemplateDefinitionSchema,
  type DeployInfrastructureTemplateInput,
} from '../../../shared/schemas/infrastructure-templates'
import { InfrastructureTemplateRepository } from '../../repositories/infrastructure-templates'
import {
  decryptInfrastructureCredential,
  encryptInfrastructureCredential,
} from '../../utils/credentials'
import { DomainError } from '../../utils/errors'
import { validateApplicationPolicy } from './policy'

export class InfrastructureTemplateService {
  constructor(private readonly repository = new InfrastructureTemplateRepository()) {}

  async listTemplates() {
    const templates = await this.repository.listActive()
    return templates.map((template) => ({
      ...template,
      definition: infrastructureTemplateDefinitionSchema.parse(template.definition),
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    }))
  }

  async deploy(
    templateId: string,
    input: DeployInfrastructureTemplateInput,
    actorUserId: string,
    idempotencyKey: string,
  ) {
    const template = await this.repository.findActive(templateId)
    if (!template) throw DomainError.notFound('Template tidak ditemukan atau tidak aktif.')
    const definition = infrastructureTemplateDefinitionSchema.parse(template.definition)
    if (definition.spec.source.type !== 'image') {
      throw DomainError.invalidState('Template build source belum didukung agent.')
    }

    const environment: Record<string, string> = {}
    const secretReferences: Record<string, string> = {}
    const secrets = []
    for (const parameter of definition.parameters) {
      const provided = input.values[parameter.key]
      const value = provided || parameter.defaultValue || (parameter.generated ? generateSecret() : '')
      if (parameter.required && !value) {
        throw DomainError.validation(`${parameter.label} wajib diisi.`)
      }
      if (!value) continue

      if (parameter.type === 'secret') {
        const secretId = randomUUID()
        const reference = `managed://${secretId}@1`
        secretReferences[parameter.environmentKey] = reference
        secrets.push({
          id: secretId,
          environmentKey: parameter.environmentKey,
          reference,
          encryptedValue: encryptInfrastructureCredential(value),
        })
      } else {
        environment[parameter.environmentKey] = value
      }
    }

    const ports = definition.spec.ports.map((port, index) =>
      index === 0 ? { ...port, hostPort: input.hostPort } : port,
    )
    const spec = {
      ...definition.spec,
      ports,
      environment,
      secretReferences,
    }
    const policy = validateApplicationPolicy(spec)
    if (!policy.allowed) {
      throw DomainError.validation('Template melanggar policy node.', policy.violations)
    }

    const resourceId = randomUUID()
    try {
      const result = await this.repository.createDeployment({
        resourceId,
        externalId: `pending:${resourceId}`,
        templateId: template.id,
        templateVersion: template.version,
        templateSlug: template.slug,
        engine: definition.engine,
        resourceKind: definition.resourceKind,
        nodeId: input.nodeId,
        name: input.name,
        classification: input.classification,
        spec,
        secrets,
        actorUserId,
        idempotencyKey,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      })
      if (!result) throw DomainError.invalidState('Node tidak aktif, offline, atau sedang drain.')
      if ('incompatibleAgent' in result) {
        throw DomainError.invalidState('Node membutuhkan OC Agent 0.3.0 atau lebih baru.')
      }
      return result
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw error
      return { operation, replayed: true }
    }
  }

  async operationSecrets(nodeId: string, operationId: string) {
    const records = await this.repository.findOperationSecrets(nodeId, operationId)
    if (!records) throw DomainError.notFound('Operation tidak ditemukan atau tidak aktif.')
    const secrets: Record<string, string> = {}
    for (const record of records) {
      if (!record.encryptedValue) {
        throw DomainError.invalidState(`Secret ${record.environmentKey} belum memiliki nilai.`)
      }
      secrets[record.environmentKey] = decryptInfrastructureCredential(record.encryptedValue)
    }
    return { secrets }
  }

  async revealResourceSecrets(resourceId: string, actorUserId: string) {
    const result = await this.repository.revealResourceSecrets(resourceId, actorUserId)
    if (!result) throw DomainError.notFound('Resource tidak ditemukan.')
    const secrets: Record<string, string> = {}
    for (const record of result.secrets) {
      if (!record.encryptedValue) {
        throw DomainError.invalidState(`Secret ${record.environmentKey} belum memiliki nilai.`)
      }
      secrets[record.environmentKey] = decryptInfrastructureCredential(record.encryptedValue)
    }
    const desiredSpec = result.resource.desiredSpec as {
      environment?: Record<string, string>
      ports?: Array<{ containerPort: number; hostPort?: number; protocol: string }>
    }
    return {
      resourceId: result.resource.id,
      name: result.resource.name,
      kind: result.resource.kind,
      environment: desiredSpec.environment ?? {},
      ports: desiredSpec.ports ?? [],
      secrets,
    }
  }
}

function generateSecret() {
  return randomBytes(32).toString('base64url')
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}
