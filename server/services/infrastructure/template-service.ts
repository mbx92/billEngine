import { randomBytes, randomUUID } from 'node:crypto'
import {
  type CreateApplicationTemplateInput,
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
import { InfrastructureReleaseService } from './release-service'
import { ApplicationBuildService } from './application-build-service'
import { releaseImageSource, validateLocalImageNode } from './local-image'

export class InfrastructureTemplateService {
  constructor(private readonly repository = new InfrastructureTemplateRepository()) {}

  async listTemplates() {
    const templates = await this.repository.listActive()
    return Promise.all(
      templates.map(async (template) => {
        const definition = infrastructureTemplateDefinitionSchema.parse(template.definition)
        const resolvedRelease = template.applicationId
          ? await new InfrastructureReleaseService().latestRelease(template.applicationId)
          : null
        return {
          ...template,
          definition: resolvedRelease
            ? {
                ...definition,
                spec: {
                  ...definition.spec,
                  source: releaseImageSource(resolvedRelease),
                },
              }
            : definition,
          resolvedRelease,
          createdAt: template.createdAt.toISOString(),
          updatedAt: template.updatedAt.toISOString(),
        }
      }),
    )
  }

  async createApplicationTemplate(input: CreateApplicationTemplateInput, actorUserId: string) {
    const release = await new InfrastructureReleaseService().latestRelease(input.applicationId)
    if (!release) {
      throw DomainError.invalidState('Application belum memiliki release yang dapat dideploy.')
    }

    const parameters = [...input.environmentKeys, ...input.secretKeys].map((environmentKey) => {
      const secret = input.secretKeys.includes(environmentKey)
      return {
        key: parameterKey(environmentKey),
        label: environmentKey
          .toLowerCase()
          .split('_')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
        environmentKey,
        type: secret ? ('secret' as const) : ('string' as const),
        required: secret,
        generated: false,
      }
    })
    if (new Set(parameters.map((parameter) => parameter.key)).size !== parameters.length) {
      throw DomainError.validation('Environment key menghasilkan nama parameter yang duplikat.')
    }
    const definition = infrastructureTemplateDefinitionSchema.parse({
      engine: 'generic',
      resourceKind: 'application',
      spec: {
        source: releaseImageSource(release),
        secretDelivery: input.secretDelivery,
        limits: {
          cpuMilli: input.cpuMilli,
          memoryBytes: String(input.memoryMiB * 1024 * 1024),
        },
        ports: [{ containerPort: input.containerPort, protocol: 'tcp' }],
        volumes: input.volume
          ? [
              {
                name: input.volume.name,
                mountTarget: input.volume.mountTarget,
                kind: 'persistent',
              },
            ]
          : [],
        restartPolicy: input.restartPolicy,
        ...(input.healthcheckPath
          ? {
              healthcheck: {
                path: input.healthcheckPath,
                port: input.containerPort,
                intervalSeconds: 30,
                timeoutSeconds: 5,
              },
            }
          : {}),
      },
      parameters,
    })

    try {
      const template = await this.repository.createApplicationTemplate({
        slug: input.slug,
        name: input.name,
        description: input.description,
        applicationId: input.applicationId,
        releasePolicy: input.trackLatest ? 'track_latest' : 'manual',
        definition,
        actorUserId,
      })
      return {
        ...template,
        definition,
        resolvedRelease: release,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      }
    } catch (error) {
      if (isUniqueViolation(error)) throw DomainError.conflict('Slug template sudah digunakan.')
      throw error
    }
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
    const release = template.applicationId
      ? await new InfrastructureReleaseService().latestRelease(template.applicationId)
      : null
    if (template.applicationId && !release) {
      throw DomainError.invalidState('Application template belum memiliki release.')
    }
    if (release) validateLocalImageNode(releaseImageSource(release), input.nodeId)
    const isApplication = definition.resourceKind === 'application'
    const useGateway = isApplication && input.exposure !== 'port'
    if (!useGateway && !input.hostPort) {
      throw DomainError.validation('Host port wajib diisi untuk akses langsung ke server.')
    }
    if (isApplication && !useGateway && input.classification === 'billable') {
      throw DomainError.validation(
        'Akses port langsung hanya untuk resource internal atau ignored. Gunakan domain untuk resource billable.',
      )
    }
    const targetPort = definition.spec.ports.find((port) => port.protocol === 'tcp')?.containerPort
    if (isApplication && !targetPort) {
      throw DomainError.validation('Template aplikasi belum memiliki target port TCP.')
    }
    const platformDomain = String(useRuntimeConfig().platformDomain || '')
      .trim()
      .toLowerCase()
    if (useGateway && !platformDomain) {
      throw DomainError.invalidState('Platform domain belum dikonfigurasi.')
    }
    const hostname = useGateway
      ? `${input.subdomain || input.name}.${platformDomain}`.toLowerCase()
      : undefined
    if (useGateway && input.classification === 'billable') {
      const config = useRuntimeConfig()
      if (!config.billingGateInternalUrl || !config.billingGateSharedKey) {
        throw DomainError.invalidState(
          'Billing gate internal URL atau shared key belum dikonfigurasi.',
        )
      }
    }

    const environment: Record<string, string> = {}
    const secretReferences: Record<string, string> = {}
    const secrets = []
    for (const parameter of definition.parameters) {
      const provided = input.values[parameter.key]
      const value =
        provided || parameter.defaultValue || (parameter.generated ? generateSecret() : '')
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
      !useGateway && index === 0 ? { ...port, hostPort: input.hostPort } : port,
    )
    const spec = {
      ...definition.spec,
      source: release ? releaseImageSource(release) : definition.spec.source,
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
        applicationId: template.applicationId ?? undefined,
        releaseId: release?.id,
        releasePolicy: template.releasePolicy,
        engine: definition.engine,
        resourceKind: definition.resourceKind,
        nodeId: input.nodeId,
        serviceId: input.serviceId,
        hostname,
        targetPort,
        billingGateEnabled: useGateway && input.classification === 'billable',
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
        throw DomainError.invalidState(
          `Node membutuhkan OC Agent ${result.minimumAgentVersion} atau lebih baru.`,
        )
      }
      if ('gatewayUnavailable' in result) {
        throw DomainError.invalidState('Traefik gateway pada node belum healthy.')
      }
      if ('invalidService' in result) {
        throw DomainError.validation('Service tidak ditemukan atau sudah dibatalkan.')
      }
      return result
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (uniqueConstraint(error) === 'resource_routes_hostname_uidx') {
        throw DomainError.conflict('Subdomain sudah digunakan deployment lain.')
      }
      const operation = await this.repository.findOperationByIdempotencyKey(idempotencyKey)
      if (!operation) throw error
      return { operation, replayed: true }
    }
  }

  async operationSecrets(nodeId: string, operationId: string) {
    const resolved = await this.repository.findOperationSecrets(nodeId, operationId)
    if (!resolved) throw DomainError.notFound('Operation tidak ditemukan atau tidak aktif.')
    const secrets: Record<string, string> = {}
    for (const record of resolved.records) {
      if (!record.encryptedValue) {
        throw DomainError.invalidState(`Secret ${record.environmentKey} belum memiliki nilai.`)
      }
      secrets[record.environmentKey] = decryptInfrastructureCredential(record.encryptedValue)
    }
    if (resolved.action === 'route.configure') {
      const sharedKey = String(useRuntimeConfig().billingGateSharedKey || '')
      if (sharedKey) secrets.BILLING_GATE_SHARED_KEY = sharedKey
    }
    const registry =
      resolved.action === 'application.build'
        ? await new ApplicationBuildService().registryCredentialForOperation(nodeId, operationId)
        : ['application.ensure', 'application.redeploy'].includes(resolved.action)
          ? await new InfrastructureReleaseService().registryCredentialForOperation(
              nodeId,
              operationId,
            )
          : null
    return { secrets, registry }
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

function parameterKey(environmentKey: string) {
  const [first = 'value', ...rest] = environmentKey.toLowerCase().split('_')
  return `${first}${rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}

function uniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'constraint' in error
    ? String((error as { constraint?: unknown }).constraint || '')
    : ''
}
