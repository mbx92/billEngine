import type { CreateResourceDomainInput } from '../../../shared/schemas/coolify'
import type { ApiResourceDomainsResponse } from '../../../shared/types/api'
import {
  CloudflareClient,
  CloudflareClientError,
  customHostnameVerificationRecords,
} from '../../integrations/cloudflare/client'
import { CoolifyClientError } from '../../integrations/coolify/client'
import { clientForCoolifyConnection } from '../../integrations/coolify/connection'
import { ResourceDomainRepository, serializeDomain } from '../../repositories/resource-domains'
import { DomainError } from '../../utils/errors'

type ResourceTarget = NonNullable<
  Awaited<ReturnType<ResourceDomainRepository['findResourceTarget']>>
>

export class ResourceDomainService {
  constructor(private readonly repository = new ResourceDomainRepository()) {}

  async list(resourceId: string): Promise<ApiResourceDomainsResponse> {
    const target = await this.requireTarget(resourceId)
    const config = domainConfig()
    return {
      resource: {
        id: target.id,
        name: target.name,
        coolifyUuid: target.coolifyUuid,
        resourceType: target.resourceType,
        serverName: target.serverName,
      },
      configuration: {
        platformDomain: config.platformDomain,
        customDomainsEnabled: Boolean(config.cloudflareApiToken && config.cloudflareZoneId),
        cnameTarget: config.cnameTarget,
      },
      data: await this.repository.list(resourceId),
    }
  }

  async create(
    resourceId: string,
    input: CreateResourceDomainInput,
    options: { instantDeploy?: boolean; configureCoolify?: boolean } = {},
  ) {
    const target = await this.requireTarget(resourceId)
    const config = domainConfig()
    validateHostnameType(input.hostname, input.type, config.platformDomain)

    if (await this.repository.findByHostname(input.hostname)) {
      throw DomainError.conflict('Hostname sudah terdaftar pada resource lain.')
    }
    if (input.type === 'custom' && (!config.cloudflareApiToken || !config.cloudflareZoneId)) {
      throw DomainError.invalidState(
        'Cloudflare API token dan zone ID belum dikonfigurasi untuk custom domain.',
      )
    }

    const row = await this.repository.create({
      resourceId,
      hostname: input.hostname,
      type: input.type,
      isPrimary: input.isPrimary,
      cnameTarget: input.type === 'custom' ? config.cnameTarget : null,
      composeServiceName: input.composeServiceName,
    })

    let providerHostnameId: string | null = null
    let coolifyConfigured = options.configureCoolify === false
    try {
      if (input.type === 'custom') {
        const provider = await cloudflareClient(config).createCustomHostname(input.hostname)
        providerHostnameId = provider.id
        await this.repository.updateProvider(row.id, {
          providerHostnameId: provider.id,
          providerHostnameStatus: provider.status,
          providerSslStatus: provider.ssl.status,
          verificationRecords: customHostnameVerificationRecords(provider),
        })
      }

      if (options.configureCoolify !== false) {
        const routing = await clientForCoolifyConnection(target).addApplicationDomain(
          target.coolifyUuid,
          input.hostname,
          input.composeServiceName,
          { instantDeploy: options.instantDeploy },
        )
        coolifyConfigured = true
        await this.repository.updateComposeServiceName(row.id, routing.composeServiceName)
      }

      if (input.type === 'platform') {
        await this.repository.updateStatus(row.id, 'verifying')
        return this.refresh(resourceId, row.id)
      }

      return this.refresh(resourceId, row.id)
    } catch (error) {
      if (providerHostnameId && !coolifyConfigured) {
        await cloudflareClient(config)
          .deleteCustomHostname(providerHostnameId)
          .catch(() => undefined)
      }
      await this.repository.updateStatus(row.id, 'failed', externalErrorMessage(error))
      throw externalDomainError(error)
    }
  }

  async refresh(resourceId: string, domainId: string) {
    await this.requireTarget(resourceId)
    const domain = await this.repository.findById(resourceId, domainId)
    if (!domain) throw DomainError.notFound('Domain resource tidak ditemukan.')

    if (domain.type === 'custom') {
      if (!domain.providerHostnameId) {
        throw DomainError.invalidState('Custom hostname belum terdaftar pada Cloudflare.')
      }
      const config = domainConfig()
      if (!config.cloudflareApiToken || !config.cloudflareZoneId) {
        throw DomainError.invalidState('Konfigurasi Cloudflare tidak tersedia.')
      }

      try {
        const provider = await cloudflareClient(config).getCustomHostname(domain.providerHostnameId)
        const updated = await this.repository.updateProvider(domain.id, {
          providerHostnameId: provider.id,
          providerHostnameStatus: provider.status,
          providerSslStatus: provider.ssl.status,
          verificationRecords: customHostnameVerificationRecords(provider),
        })
        return serializeDomain(updated)
      } catch (error) {
        await this.repository.updateStatus(domain.id, 'failed', externalErrorMessage(error))
        throw externalDomainError(error)
      }
    }

    const reachable = await hostnameIsReachable(domain.hostname)
    const updated = await this.repository.updateStatus(
      domain.id,
      reachable ? 'active' : 'verifying',
    )
    return serializeDomain(updated)
  }

  async remove(resourceId: string, domainId: string) {
    const target = await this.requireTarget(resourceId)
    const domain = await this.repository.findById(resourceId, domainId)
    if (!domain) throw DomainError.notFound('Domain resource tidak ditemukan.')

    const config = domainConfig()
    if (domain.providerHostnameId && (!config.cloudflareApiToken || !config.cloudflareZoneId)) {
      throw DomainError.invalidState(
        'Cloudflare harus dikonfigurasi sebelum custom domain dapat dilepas.',
      )
    }

    try {
      await clientForCoolifyConnection(target).removeApplicationDomain(
        target.coolifyUuid,
        domain.hostname,
        domain.composeServiceName ?? undefined,
      )

      if (domain.providerHostnameId) {
        await cloudflareClient(config).deleteCustomHostname(domain.providerHostnameId)
      }

      await this.repository.delete(domain.id)
      return { id: domain.id, hostname: domain.hostname }
    } catch (error) {
      throw externalDomainError(error)
    }
  }

  private async requireTarget(resourceId: string): Promise<ResourceTarget> {
    const target = await this.repository.findResourceTarget(resourceId)
    if (!target) throw DomainError.notFound('Resource tidak ditemukan.')
    if (!target.serverActive) throw DomainError.invalidState('Server Coolify tidak aktif.')
    if (target.resourceType !== 'application') {
      throw DomainError.invalidState('Domain otomatis hanya mendukung Coolify application.')
    }
    return target
  }
}

function domainConfig() {
  const config = useRuntimeConfig()
  return {
    platformDomain: String(config.platformDomain).trim().toLowerCase(),
    cnameTarget: String(config.cloudflareSaasCnameTarget).trim().toLowerCase(),
    cloudflareApiToken: String(config.cloudflareApiToken || ''),
    cloudflareZoneId: String(config.cloudflareZoneId || ''),
  }
}

function cloudflareClient(config: ReturnType<typeof domainConfig>) {
  return new CloudflareClient(config.cloudflareApiToken, config.cloudflareZoneId)
}

function validateHostnameType(
  hostname: string,
  type: CreateResourceDomainInput['type'],
  platformDomain: string,
) {
  const suffix = `.${platformDomain}`
  const isPlatformHostname = hostname.endsWith(suffix)
  if (type === 'platform') {
    const prefix = hostname.slice(0, -suffix.length)
    if (!isPlatformHostname || !prefix || prefix.includes('.')) {
      throw DomainError.validation(
        `Domain platform harus menggunakan satu subdomain di bawah ${platformDomain}.`,
      )
    }
  } else if (hostname === platformDomain || isPlatformHostname) {
    throw DomainError.validation('Gunakan tipe platform untuk domain milik platform.')
  }
}

async function hostnameIsReachable(hostname: string) {
  try {
    const response = await fetch(`https://${hostname}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    return response.status < 500
  } catch {
    return false
  }
}

function externalErrorMessage(error: unknown) {
  if (error instanceof CloudflareClientError) return 'Cloudflare gagal memproses hostname.'
  if (error instanceof CoolifyClientError) return 'Coolify gagal menerapkan domain aplikasi.'
  return 'Provisioning domain gagal.'
}

function externalDomainError(error: unknown) {
  if (error instanceof DomainError) return error
  return DomainError.external(externalErrorMessage(error))
}
