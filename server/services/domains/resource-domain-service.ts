import type { CreateResourceDomainInput } from '../../../shared/schemas/coolify'
import type { ApiResourceDomainsResponse } from '../../../shared/types/api'
import {
  CloudflareClient,
  CloudflareClientError,
  customHostnameVerificationRecords,
} from '../../integrations/cloudflare/client'
import {
  CoolifyClientError,
  type CoolifyApplicationRouting,
} from '../../integrations/coolify/client'
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

      if (input.type === 'platform') {
        await ensurePlatformDns(input.hostname, config)
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
        await this.repository.updateStatus(row.id, 'verifying')
        return this.refresh(resourceId, row.id)
      }

      // Provisioning defers Coolify attachment until after the first successful deploy
      // (Compose domains are only reliable once Coolify has loaded the compose file).
      const current = await this.repository.findById(resourceId, row.id)
      if (!current) throw DomainError.notFound('Domain resource tidak ditemukan.')
      return serializeDomain(current)
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

  /**
   * Ensures the hostname is attached to the Coolify application. Safe to call repeatedly:
   * only the first attachment triggers an optional instant deploy.
   */
  async ensureAttachedToCoolify(
    resourceId: string,
    domainId: string,
    options: { instantDeploy?: boolean } = {},
  ) {
    const target = await this.requireTarget(resourceId)
    const domain = await this.repository.findById(resourceId, domainId)
    if (!domain) throw DomainError.notFound('Domain resource tidak ditemukan.')

    const client = clientForCoolifyConnection(target)
    const routing = await client.getApplicationRouting(target.coolifyUuid)
    const alreadyRouted = routingHasHostname(routing, domain.hostname, domain.composeServiceName)
    // Domains set at application-create time for dockercompose can appear in the API
    // before Traefik has applied them. Re-apply once while status is still configuring.
    if (alreadyRouted && domain.status !== 'configuring') {
      return {
        attached: true as const,
        newlyAttached: false as const,
        domain: serializeDomain(domain),
      }
    }

    try {
      const attached = await client.addApplicationDomain(
        target.coolifyUuid,
        domain.hostname,
        domain.composeServiceName ?? undefined,
        { instantDeploy: options.instantDeploy ?? true },
      )
      await this.repository.updateComposeServiceName(domain.id, attached.composeServiceName)
      const updated = await this.repository.updateStatus(domain.id, 'verifying')
      return {
        attached: true as const,
        newlyAttached: true as const,
        domain: serializeDomain(updated),
      }
    } catch (error) {
      await this.repository.updateStatus(domain.id, 'failed', externalErrorMessage(error))
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

    try {
      await ensurePlatformDns(domain.hostname, domainConfig())
    } catch (error) {
      // DNS edit is optional; keep polling reachability and surface the reason.
      const message = externalErrorMessage(error)
      await this.repository.updateStatus(domain.id, 'verifying', message)
    }

    const probe = await probeHostname(domain.hostname)
    const updated = await this.repository.updateStatus(
      domain.id,
      probe.ok ? 'active' : 'verifying',
      probe.ok ? null : probe.detail,
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

function routingHasHostname(
  routing: CoolifyApplicationRouting,
  hostname: string,
  composeServiceName?: string | null,
) {
  const needle = hostname.toLowerCase()
  const urlsContainHost = (value: string | null | undefined) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .some((item) => {
        try {
          return new URL(item).hostname === needle
        } catch {
          return item.includes(needle)
        }
      })

  if (routing.buildPack === 'dockercompose') {
    if (composeServiceName && routing.composeDomains[composeServiceName]) {
      return urlsContainHost(routing.composeDomains[composeServiceName]?.domain)
    }
    return Object.values(routing.composeDomains).some((entry) => urlsContainHost(entry.domain))
  }

  return urlsContainHost(routing.fqdn)
}

async function ensurePlatformDns(
  hostname: string,
  config: ReturnType<typeof domainConfig>,
) {
  if (!config.cloudflareApiToken || !config.cloudflareZoneId) {
    throw DomainError.invalidState(
      'Cloudflare API token dan zone ID belum dikonfigurasi untuk DNS platform.',
    )
  }
  const client = cloudflareClient(config)
  const target = await client.resolveWildcardTunnelTarget(config.platformDomain)
  if (!target) {
    throw DomainError.invalidState(
      `DNS wildcard *.${config.platformDomain} belum ada. Arahkan wildcard ke tunnel Coolify (Traefik :443).`,
    )
  }
  return client.upsertProxiedCname(hostname, target)
}

async function probeHostname(hostname: string): Promise<{ ok: boolean; detail: string | null }> {
  const url = `https://${hostname}`
  let lastDetail: string | null = null
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const response = await fetch(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      // Cloudflare 5xx usually means DNS/tunnel points at a dead host port, or Traefik has no route.
      if (response.status < 500) return { ok: true, detail: null }
      lastDetail =
        response.status === 502
          ? `HTTP 502 dari Cloudflare. Pastikan DNS hostname mengarah ke tunnel wildcard Coolify (bukan port host lama), dan domain sudah terpasang di Traefik.`
          : `HTTP ${response.status} saat probe publik.`
    } catch (error) {
      lastDetail =
        error instanceof Error
          ? `Probe HTTPS gagal: ${error.name}`
          : 'Probe HTTPS gagal.'
    }
  }
  return { ok: false, detail: lastDetail }
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
