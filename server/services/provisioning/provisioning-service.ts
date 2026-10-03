import { createHash } from 'node:crypto'
import type {
  CreateDeploymentBlueprintInput,
  QueueProvisioningJobInput,
  UpdateDeploymentBlueprintInput,
} from '../../../shared/schemas/provisioning'
import type { ProvisioningStatus } from '../../../shared/types/api'
import { withPostgresAdvisoryLock } from '../../database/advisory-lock'
import { useDatabase, type Database } from '../../database/client'
import { clientForCoolifyConnection } from '../../integrations/coolify/connection'
import { CoolifyClientError } from '../../integrations/coolify/client'
import { normalizeCoolifyApplication } from '../../integrations/coolify/normalize'
import {
  buildDatabaseUrl,
  databaseIdentifiers,
  generateDatabasePassword,
} from '../../integrations/postgres/shared-database-client'
import { CoolifyResourceRepository } from '../../repositories/coolify-resources'
import { DatabaseProvisioningRepository } from '../../repositories/database-provisioning'
import { ProvisioningRepository } from '../../repositories/provisioning'
import { ResourceDomainRepository } from '../../repositories/resource-domains'
import {
  decryptCredential,
  decryptInfrastructureCredential,
  encryptCredential,
  encryptInfrastructureCredential,
} from '../../utils/credentials'
import { DomainError } from '../../utils/errors'
import { CoolifyResourceService } from '../coolify/resource-service'
import { clientForCluster } from '../database/database-cluster-service'
import { ResourceDomainService } from '../domains/resource-domain-service'

const PROVISIONING_LOCK_KEY = 814_210_732
const POLL_INTERVAL_MS = 5_000
const STAGE_TIMEOUT_MS = 30 * 60_000
const SUCCESSFUL_DEPLOYMENT_STATUSES = new Set(['finished', 'completed', 'success', 'successful'])
const FAILED_DEPLOYMENT_STATUSES = new Set(['failed', 'cancelled', 'cancelled-by-user', 'error'])

interface ActorContext {
  userId: string | null
}

export class ProvisioningService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly repository = new ProvisioningRepository(database),
    private readonly resources = new CoolifyResourceRepository(database),
    private readonly domains = new ResourceDomainRepository(database),
    private readonly databases = new DatabaseProvisioningRepository(database),
  ) {}

  async overview() {
    const [blueprints, jobs, services, servers, databaseClusters] = await Promise.all([
      this.repository.listBlueprints(),
      this.repository.listJobs(),
      this.repository.listProvisionableServices(),
      new CoolifyResourceService(this.database).listServers(),
      this.databases.listActiveClusters(),
    ])
    return { blueprints, jobs, services, servers, databaseClusters }
  }

  async blueprintCatalog() {
    const [blueprints, servers, databaseClusters] = await Promise.all([
      this.repository.listBlueprints(),
      new CoolifyResourceService(this.database).listServers(),
      this.databases.listActiveClusters(),
    ])
    return { blueprints, servers, databaseClusters }
  }

  async createBlueprint(input: CreateDeploymentBlueprintInput, actor: ActorContext) {
    await this.validateBlueprintTarget(input)

    try {
      const created = await this.repository.createBlueprint(input, actor.userId)
      return { id: created.id, name: created.name, slug: created.slug }
    } catch (error) {
      if (isUniqueViolation(error)) throw DomainError.conflict('Slug blueprint sudah digunakan.')
      throw error
    }
  }

  async updateBlueprint(id: string, input: UpdateDeploymentBlueprintInput) {
    const current = await this.repository.findBlueprint(id)
    if (!current) throw DomainError.notFound('Blueprint tidak ditemukan.')
    if (await this.repository.hasRunnableBlueprintJob(id)) {
      throw DomainError.invalidState(
        'Blueprint sedang digunakan job provisioning aktif dan belum dapat diubah.',
      )
    }
    await this.validateBlueprintTarget(input)
    try {
      const updated = await this.repository.updateBlueprint(id, input)
      if (!updated) throw DomainError.notFound('Blueprint tidak ditemukan.')
      return { id: updated.id, name: updated.name, slug: updated.slug }
    } catch (error) {
      if (isUniqueViolation(error)) throw DomainError.conflict('Slug blueprint sudah digunakan.')
      throw error
    }
  }

  async deleteBlueprint(id: string) {
    const current = await this.repository.findBlueprint(id)
    if (!current) throw DomainError.notFound('Blueprint tidak ditemukan.')
    if ((await this.repository.blueprintJobCount(id)) > 0) {
      throw DomainError.conflict(
        'Blueprint sudah memiliki riwayat provisioning. Nonaktifkan blueprint untuk menjaga audit job lama.',
      )
    }
    const deleted = await this.repository.deleteBlueprint(id)
    if (!deleted) throw DomainError.notFound('Blueprint tidak ditemukan.')
    return deleted
  }

  async listProjects(serverId: string) {
    const server = await this.resources.findServerConnection(serverId)
    if (!server || !server.isActive) throw DomainError.validation('Koneksi Coolify tidak aktif.')
    return this.fetchProjects(server)
  }

  private async validateBlueprintTarget(input: CreateDeploymentBlueprintInput) {
    const server = await this.resources.findServerConnection(input.coolifyServerId)
    if (!server || !server.isActive) throw DomainError.validation('Koneksi Coolify tidak aktif.')

    const projects = await this.fetchProjects(server)
    if (!projects.some((project) => project.uuid === input.projectUuid)) {
      throw DomainError.validation('Project tidak tersedia pada koneksi Coolify yang dipilih.')
    }
    if (input.databaseClusterId) {
      const cluster = await this.databases.findCluster(input.databaseClusterId)
      if (!cluster?.isActive) throw DomainError.validation('Cluster database tidak aktif.')
    }
  }

  async queue(input: QueueProvisioningJobInput, actor: ActorContext) {
    const [blueprintRow, service] = await Promise.all([
      this.repository.findBlueprint(input.blueprintId),
      this.repository.findActiveService(input.serviceId),
    ])
    if (!blueprintRow?.blueprint.isActive || !blueprintRow.serverActive) {
      throw DomainError.validation('Blueprint atau koneksi Coolify tidak aktif.')
    }
    if (!service) throw DomainError.validation('Service aktif tidak ditemukan.')

    if (service.databaseMode === 'dedicated') {
      throw DomainError.invalidState('Provisioning database dedicated belum tersedia.')
    }
    if (service.databaseMode === 'shared' && !blueprintRow.blueprint.databaseClusterId) {
      throw DomainError.validation('Blueprint wajib memilih cluster untuk service database shared.')
    }
    if (service.databaseMode === 'none' && blueprintRow.blueprint.databaseClusterId) {
      throw DomainError.validation(
        'Blueprint menggunakan database shared, tetapi service belum memakai plan dengan mode database shared.',
      )
    }
    if (service.databaseMode === 'none' && input.sqlImport) {
      throw DomainError.validation('Import SQL hanya tersedia untuk service database shared.')
    }
    const databaseKey = blueprintRow.blueprint.databaseEnvironmentKey
    if (
      service.databaseMode === 'shared' &&
      input.environmentVariables[databaseKey] !== undefined
    ) {
      throw DomainError.validation(
        `${databaseKey} dikelola otomatis dan tidak boleh diisi secara manual.`,
      )
    }

    const missingKeys = blueprintRow.blueprint.environmentKeys.filter(
      (key) =>
        !(service.databaseMode === 'shared' && key === databaseKey) &&
        !input.environmentVariables[key]?.trim(),
    )
    if (missingKeys.length > 0) {
      throw DomainError.validation(`Environment wajib belum diisi: ${missingKeys.join(', ')}.`)
    }

    const environmentEncrypted = Object.keys(input.environmentVariables).length
      ? encryptCredential(JSON.stringify(input.environmentVariables))
      : null
    const sqlImportEncrypted = input.sqlImport
      ? encryptInfrastructureCredential(input.sqlImport.content)
      : null
    const sqlImportChecksum = input.sqlImport
      ? createHash('sha256').update(input.sqlImport.content).digest('hex')
      : null
    const created = await this.repository.createJob({
      blueprintId: input.blueprintId,
      serviceId: input.serviceId,
      requestedBy: actor.userId,
      applicationName: input.applicationName,
      hostname: input.hostname,
      domainType: input.domainType,
      environmentEncrypted,
      sqlImportEncrypted,
      sqlImportFilename: input.sqlImport?.filename ?? null,
      sqlImportSize: input.sqlImport
        ? new TextEncoder().encode(input.sqlImport.content).byteLength
        : null,
      sqlImportChecksum,
    })
    return { id: created.id, status: created.status }
  }

  async retry(id: string) {
    const current = await this.repository.findJobContext(id)
    if (!current) throw DomainError.notFound('Provisioning job tidak ditemukan.')
    if (current.job.status !== 'failed') {
      throw DomainError.invalidState('Hanya job gagal yang dapat dicoba ulang.')
    }
    const updated = await this.repository.retry(id)
    return { id, status: updated?.status ?? current.job.status }
  }

  async processNext() {
    return withPostgresAdvisoryLock(this.database.$client, PROVISIONING_LOCK_KEY, async () => {
      const jobId = await this.repository.findNextRunnable()
      if (!jobId) return { status: 'idle' as const }
      await this.processJob(jobId)
      return { status: 'processed' as const, jobId }
    })
  }

  private async fetchProjects(connection: { baseUrl: string; tokenEncrypted: string | null }) {
    try {
      const projects = await clientForCoolifyConnection(connection).listProjects()
      return projects
        .map((project) => ({
          uuid: project.uuid,
          name: project.name,
          description: project.description ?? null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    } catch {
      throw DomainError.external(
        'Daftar project Coolify gagal dimuat. Periksa koneksi dan permission API token.',
      )
    }
  }

  private async processJob(id: string) {
    const context = await this.repository.findJobContext(id)
    if (!context || context.job.status === 'active' || context.job.status === 'failed') return

    try {
      if (!context.serverActive || !context.blueprint.isActive) {
        throw new ProvisioningStageError(
          context.job.status,
          'Blueprint atau koneksi Coolify tidak aktif.',
        )
      }
      if (context.serviceStatus !== 'active') {
        throw new ProvisioningStageError(context.job.status, 'Service tidak lagi aktif.')
      }
      await this.runStage(context)
    } catch (error) {
      const stage = error instanceof ProvisioningStageError ? error.stage : context.job.status
      const message = provisioningErrorMessage(error)
      const attempt = context.job.attemptCount + 1
      const delay = Math.min(60_000, 2 ** Math.min(attempt, 5) * 1_000)
      await this.repository.recordFailure(
        id,
        stage,
        attempt,
        context.job.maxAttempts,
        message,
        new Date(Date.now() + delay),
      )
    }
  }

  private async runStage(
    context: NonNullable<Awaited<ReturnType<ProvisioningRepository['findJobContext']>>>,
  ) {
    const { job, blueprint } = context
    const client = clientForCoolifyConnection(context)

    switch (job.status) {
      case 'queued':
        await this.repository.advance(
          job.id,
          context.planDatabaseMode === 'shared' ? 'provisioning_database' : 'creating_application',
          {},
          context.planDatabaseMode === 'shared'
            ? 'Mulai menyiapkan database shared untuk service.'
            : 'Mulai membuat aplikasi di Coolify.',
        )
        return

      case 'provisioning_database': {
        const cluster = context.databaseCluster
        if (!cluster || !cluster.isActive) {
          throw new ProvisioningStageError(
            'provisioning_database',
            'Cluster database blueprint tidak tersedia atau tidak aktif.',
          )
        }

        let allocation = context.serviceDatabase
        if (!allocation) allocation = await this.databases.findServiceDatabase(job.serviceId)
        if (allocation && allocation.databaseClusterId !== cluster.id) {
          throw new ProvisioningStageError(
            'provisioning_database',
            'Service sudah memiliki database pada cluster lain.',
          )
        }

        if (!allocation) {
          const identifiers = databaseIdentifiers(context.serviceNumber)
          allocation = await this.databases.createServiceDatabase({
            serviceId: job.serviceId,
            databaseClusterId: cluster.id,
            provisioningJobId: job.id,
            ...identifiers,
            passwordEncrypted: encryptInfrastructureCredential(generateDatabasePassword()),
          })
        }

        try {
          const password = decryptInfrastructureCredential(allocation.passwordEncrypted)
          await this.databases.markServiceDatabase(allocation.id, {
            status: 'provisioning',
            lastError: null,
          })
          await clientForCluster(cluster).provision({
            databaseName: allocation.databaseName,
            roleName: allocation.roleName,
            password,
            connectionLimit: cluster.defaultConnectionLimit,
            resetPassword: allocation.status !== 'active',
          })
          await this.databases.markServiceDatabase(allocation.id, {
            status: 'active',
            lastError: null,
          })
        } catch (error) {
          await this.databases.markServiceDatabase(allocation.id, {
            status: 'failed',
            lastError: provisioningErrorMessage(error),
          })
          throw error
        }

        await this.repository.advance(
          job.id,
          job.sqlImportEncrypted ? 'importing_database' : 'creating_application',
          { serviceDatabaseId: allocation.id },
          job.sqlImportEncrypted
            ? 'Database dan role siap; mulai mengimpor SQL.'
            : 'Database dan role siap; mulai membuat aplikasi Coolify.',
        )
        return
      }

      case 'importing_database': {
        const allocation = context.serviceDatabase
        const cluster = context.databaseCluster
        if (!allocation || !cluster) {
          throw new ProvisioningStageError(
            'importing_database',
            'Alokasi atau cluster database tidak ditemukan.',
          )
        }
        const sql = job.sqlImportEncrypted
          ? decryptInfrastructureCredential(job.sqlImportEncrypted)
          : null
        try {
          if (sql) {
            await clientForCluster(cluster).importSql({
              databaseName: allocation.databaseName,
              roleName: allocation.roleName,
              password: decryptInfrastructureCredential(allocation.passwordEncrypted),
              jobId: job.id,
              checksum: requireValue(job.sqlImportChecksum, 'checksum SQL import'),
              sql,
            })
            await this.databases.markServiceDatabase(allocation.id, {
              status: 'active',
              lastError: null,
              sqlImportedAt: new Date(),
            })
          }
        } catch (error) {
          await this.databases.markServiceDatabase(allocation.id, {
            status: 'failed',
            lastError: provisioningErrorMessage(error),
          })
          throw error
        }
        await this.repository.advance(
          job.id,
          'creating_application',
          {},
          sql ? `SQL ${job.sqlImportFilename ?? ''} berhasil diimpor.` : 'Import SQL dilewati.',
        )
        return
      }

      case 'creating_application': {
        const recoveryTag = `billengine-job-${job.id}`
        let applicationUuid = job.coolifyApplicationUuid
        if (!applicationUuid) {
          const recovered = await client.findApplicationByTag(recoveryTag)
          applicationUuid = recovered?.uuid ?? null
        }
        if (!applicationUuid) {
          const created = await client.createPublicApplication({
            projectUuid: blueprint.projectUuid,
            serverUuid: blueprint.targetServerUuid,
            environmentName: blueprint.environmentName,
            repositoryUrl: blueprint.repositoryUrl,
            branch: blueprint.branch,
            buildPack: blueprint.buildPack,
            name: job.applicationName,
            description: `Provisioned by BillEngine for ${context.serviceNumber}`,
            destinationUuid: blueprint.destinationUuid ?? undefined,
            portsExposes: blueprint.portsExposes ?? undefined,
            baseDirectory: blueprint.baseDirectory ?? undefined,
            dockerfileLocation: blueprint.dockerfileLocation ?? undefined,
            dockerComposeLocation: blueprint.dockerComposeLocation ?? undefined,
            healthcheckPath: blueprint.healthcheckPath ?? undefined,
            healthcheckPort: blueprint.healthcheckPort ?? undefined,
            cpuCores: context.planCpuCores ?? undefined,
            memoryBytes: context.planMemoryBytes ?? undefined,
            customLabels: blueprint.customLabels ?? undefined,
            tags: ['billengine', recoveryTag, `service-${context.serviceNumber.toLowerCase()}`],
            hostname: job.hostname ?? undefined,
            composeServiceName: blueprint.composeServiceName ?? undefined,
          })
          applicationUuid = created.uuid
        }

        const application = await client.getApplication(applicationUuid)
        const resourceId = await this.resources.upsertProvisionedResource(
          blueprint.coolifyServerId,
          job.serviceId,
          job.requestedBy,
          normalizeCoolifyApplication(application),
        )
        await this.repository.advance(
          job.id,
          'configuring_environment',
          { coolifyApplicationUuid: applicationUuid, resourceId },
          'Aplikasi Coolify tersimpan; mulai mengatur environment.',
        )
        return
      }

      case 'configuring_environment': {
        const applicationUuid = requireValue(job.coolifyApplicationUuid, 'UUID aplikasi Coolify')
        const variables = decryptEnvironment(job.environmentEncrypted)
        if (context.planDatabaseMode === 'shared') {
          const allocation = context.serviceDatabase
          const cluster = context.databaseCluster
          if (!allocation || !cluster) {
            throw new ProvisioningStageError(
              'configuring_environment',
              'Database service belum tersedia.',
            )
          }
          variables[blueprint.databaseEnvironmentKey] = buildDatabaseUrl(
            {
              host: cluster.host,
              port: cluster.port,
              sslMode: cluster.sslMode as 'disable' | 'prefer' | 'require',
            },
            {
              databaseName: allocation.databaseName,
              roleName: allocation.roleName,
              password: decryptInfrastructureCredential(allocation.passwordEncrypted),
            },
          )
        }
        await client.upsertApplicationEnvironments(
          applicationUuid,
          Object.entries(variables).map(([key, value]) => ({ key, value, isShownOnce: true })),
        )
        await this.repository.advance(
          job.id,
          'configuring_domain',
          {},
          variables && Object.keys(variables).length
            ? `${Object.keys(variables).length} environment variable diterapkan.`
            : 'Blueprint tidak memerlukan environment variable.',
        )
        return
      }

      case 'configuring_domain': {
        if (!job.hostname || !job.domainType) {
          await this.repository.advance(
            job.id,
            'deploying',
            {},
            'Domain dilewati; aplikasi siap dideploy.',
          )
          return
        }
        const resourceId = requireValue(job.resourceId, 'resource aplikasi')
        let domainId = job.domainId
        if (!domainId) {
          const existing = await this.domains.findByHostname(job.hostname)
          if (existing && existing.resourceId !== resourceId) {
            throw new ProvisioningStageError(
              'configuring_domain',
              'Hostname sudah digunakan resource lain.',
            )
          }
          if (existing) {
            domainId = existing.id
          } else {
            const domain = await new ResourceDomainService(this.domains).create(
              resourceId,
              {
                hostname: job.hostname,
                type: job.domainType,
                isPrimary: true,
                composeServiceName: blueprint.composeServiceName ?? undefined,
              },
              { instantDeploy: false, configureCoolify: false },
            )
            domainId = domain.id
          }
        }
        await this.repository.advance(
          job.id,
          'deploying',
          { domainId },
          'Domain dikonfigurasi; deployment akan dimulai.',
        )
        return
      }

      case 'deploying': {
        const applicationUuid = requireValue(job.coolifyApplicationUuid, 'UUID aplikasi Coolify')
        let deploymentUuid = job.coolifyDeploymentUuid
        if (!deploymentUuid) {
          const recent = await client.listApplicationDeployments(applicationUuid)
          const recoverable = recent.find(
            (deployment) =>
              deployment.createdAt &&
              deployment.createdAt >= job.stageStartedAt &&
              !FAILED_DEPLOYMENT_STATUSES.has(deployment.status.toLowerCase()),
          )
          deploymentUuid = recoverable?.uuid ?? null
        }
        if (!deploymentUuid) {
          deploymentUuid = (await client.deployApplication(applicationUuid)).uuid
        }
        await this.repository.advance(
          job.id,
          'verifying_health',
          { coolifyDeploymentUuid: deploymentUuid },
          'Deployment Coolify dimulai; menunggu aplikasi healthy.',
        )
        return
      }

      case 'verifying_health': {
        ensureWithinStageTimeout(job.stageStartedAt, 'Health check deployment timeout.')
        const applicationUuid = requireValue(job.coolifyApplicationUuid, 'UUID aplikasi Coolify')
        const deploymentUuid = requireValue(job.coolifyDeploymentUuid, 'UUID deployment Coolify')
        const deployment = await client.getDeployment(deploymentUuid)
        const deploymentStatus = deployment.status.toLowerCase()
        if (FAILED_DEPLOYMENT_STATUSES.has(deploymentStatus)) {
          throw new ProvisioningStageError('deploying', `Deployment Coolify ${deploymentStatus}.`)
        }
        if (!SUCCESSFUL_DEPLOYMENT_STATUSES.has(deploymentStatus)) {
          await this.repository.reschedule(
            job.id,
            job.status,
            new Date(Date.now() + POLL_INTERVAL_MS),
          )
          return
        }

        const application = await client.getApplication(applicationUuid)
        const normalized = normalizeCoolifyApplication(application)
        const resourceId = await this.resources.upsertProvisionedResource(
          blueprint.coolifyServerId,
          job.serviceId,
          job.requestedBy,
          normalized,
        )
        if (normalized.status !== 'running') {
          await this.repository.reschedule(
            job.id,
            job.status,
            new Date(Date.now() + POLL_INTERVAL_MS),
          )
          return
        }
        await this.repository.advance(
          job.id,
          'verifying_ssl',
          { resourceId },
          'Aplikasi healthy; memverifikasi domain dan SSL.',
        )
        return
      }

      case 'verifying_ssl': {
        if (job.domainId && job.resourceId) {
          const domainService = new ResourceDomainService(this.domains)
          const attachment = await domainService.ensureAttachedToCoolify(
            job.resourceId,
            job.domainId,
            { instantDeploy: true },
          )
          if (attachment.newlyAttached) {
            await this.repository.reschedule(
              job.id,
              job.status,
              new Date(Date.now() + POLL_INTERVAL_MS),
              `Domain ${attachment.domain.hostname} dipasang ke Coolify; menunggu SSL/route siap.`,
            )
            return
          }

          const domain = await domainService.refresh(job.resourceId, job.domainId)
          if (domain.status !== 'active') {
            ensureWithinStageTimeout(
              job.stageStartedAt,
              domainSslTimeoutMessage(domain.hostname, domain),
            )
            await this.repository.reschedule(
              job.id,
              job.status,
              new Date(Date.now() + POLL_INTERVAL_MS),
            )
            return
          }
        }
        await this.repository.advance(
          job.id,
          'active',
          {
            environmentEncrypted: null,
            sqlImportEncrypted: null,
            completedAt: new Date(),
          },
          'Provisioning selesai; aplikasi aktif.',
        )
        return
      }

      case 'active':
      case 'failed':
        return
    }
  }
}

class ProvisioningStageError extends Error {
  constructor(
    readonly stage: ProvisioningStatus,
    message: string,
  ) {
    super(message)
    this.name = 'ProvisioningStageError'
  }
}

function decryptEnvironment(payload: string | null): Record<string, string> {
  if (!payload) return {}
  const parsed = JSON.parse(decryptCredential(payload)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Payload environment provisioning tidak valid.')
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, typeof value === 'string' ? value : '']),
  )
}

function requireValue(value: string | null, label: string) {
  if (!value) throw new Error(`${label} belum tersedia.`)
  return value
}

function ensureWithinStageTimeout(startedAt: Date, message: string) {
  if (Date.now() - startedAt.getTime() > STAGE_TIMEOUT_MS) throw new Error(message)
}

function domainSslTimeoutMessage(
  hostname: string,
  domain: {
    status: string
    providerHostnameStatus: string | null
    providerSslStatus: string | null
    lastError: string | null
  },
) {
  const details = [
    `status=${domain.status}`,
    domain.providerHostnameStatus ? `cf_host=${domain.providerHostnameStatus}` : null,
    domain.providerSslStatus ? `cf_ssl=${domain.providerSslStatus}` : null,
    domain.lastError ? `error=${domain.lastError}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return `Verifikasi domain/SSL timeout (${hostname}: ${details}). Pastikan domain terpasang di Coolify dan DNS/tunnel mengarah ke Traefik.`
}

function provisioningErrorMessage(error: unknown) {
  if (error instanceof ProvisioningStageError) return redactProvisioningError(error.message)
  if (error instanceof CoolifyClientError) return redactProvisioningError(error.message)
  if (error instanceof Error) return redactProvisioningError(error.message)
  return 'Provisioning gagal karena error yang tidak dikenal.'
}

function redactProvisioningError(message: string) {
  return message
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1<redacted>@')
    .replace(/(password\s*[=:]\s*)[^\s,;]+/gi, '$1<redacted>')
    .slice(0, 500)
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    ('code' in error ? (error as { code?: unknown }).code === '23505' : false),
  )
}
