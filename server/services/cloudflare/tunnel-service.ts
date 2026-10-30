import { sql } from 'drizzle-orm'
import type {
  ApiCloudflareTunnel,
  ApiCloudflareTunnelDetail,
  ApiCloudflareTunnelOverview,
  ApiCloudflareTunnelRoute,
} from '../../../shared/types/api'
import type {
  CloudflareTunnelRouteInput,
  CloudflareTunnelRouteKey,
} from '../../../shared/schemas/cloudflare-tunnels'
import {
  CloudflareTunnelClientError,
  type CloudflareTunnel,
  type CloudflareTunnelClient,
  type CloudflareTunnelConfig,
  type CloudflareTunnelIngressRule,
  useCloudflareTunnelClient,
} from '../../integrations/cloudflare/tunnel-client'
import { useDatabase } from '../../database/client'
import { AuditLogRepository } from '../../repositories/audit'
import { DomainError } from '../../utils/errors'
import { tunnelHostnameMatches } from '../../../shared/utils/tunnel-hostname'

interface TunnelActor {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export class CloudflareTunnelService {
  constructor(private readonly injectedClient?: CloudflareTunnelClient) {}

  async overview(): Promise<ApiCloudflareTunnelOverview> {
    if (!this.isConfigured()) return { configured: false, tunnels: [] }

    try {
      const tunnels = await this.client().listTunnels()
      return {
        configured: true,
        tunnels: tunnels
          .map(serializeTunnel)
          .sort((left, right) => left.name.localeCompare(right.name)),
      }
    } catch (error) {
      throw mapCloudflareError(error)
    }
  }

  async detail(tunnelId: string): Promise<ApiCloudflareTunnelDetail> {
    this.assertConfigured()

    try {
      const tunnel = await this.client().getTunnel(tunnelId)
      const editable = configSource(tunnel) === 'cloudflare'
      const configuration = editable ? await this.client().getConfiguration(tunnelId) : null

      return {
        tunnel: serializeTunnel(tunnel),
        editable,
        configuration: configuration
          ? {
              version: configuration.version ?? null,
              updatedAt: configuration.created_at ?? null,
              routes: configuration.config.ingress.map((rule) =>
                serializeRoute(rule, configuration.config.originRequest),
              ),
            }
          : null,
      }
    } catch (error) {
      throw mapCloudflareError(error)
    }
  }

  async addRoute(tunnelId: string, input: CloudflareTunnelRouteInput, actor: TunnelActor) {
    return this.mutateConfiguration(
      tunnelId,
      actor,
      'cloudflare.tunnel_route.created',
      (config) => {
        if (findRuleIndex(config.ingress, input) !== -1) {
          throw DomainError.conflict('Hostname dan path tersebut sudah terdaftar pada tunnel.')
        }

        const catchAllIndex = config.ingress.findIndex(isCatchAll)
        const insertAt = catchAllIndex === -1 ? config.ingress.length : catchAllIndex
        config.ingress.splice(insertAt, 0, buildRule(input))
        ensureCatchAll(config)
      },
    )
  }

  async connectApplicationRoute(
    tunnelId: string,
    input: CloudflareTunnelRouteInput,
    actor: TunnelActor,
  ) {
    return this.mutateConfiguration(
      tunnelId,
      actor,
      'cloudflare.application_domain.connected',
      (config) => {
        if (config.originRequest?.httpHostHeader)
          throw DomainError.conflict(
            'Tunnel memiliki HTTP Host Header global. Hapus override tersebut melalui konfigurasi tunnel agar hostname aplikasi sampai ke Traefik.',
          )
        const exact = config.ingress.find(
          (rule) => rule.hostname?.toLowerCase() === input.hostname && !rule.path,
        )
        if (exact) {
          if (
            exact.service.replace(/\/$/, '') !== input.service.replace(/\/$/, '') ||
            exact.originRequest?.httpHostHeader
          ) {
            throw DomainError.conflict(
              'Domain ini sudah mengarah ke origin lain atau memakai Host Header khusus. Kelola route tersebut melalui halaman Tunnels.',
            )
          }
          const earlier = config.ingress.slice(0, config.ingress.indexOf(exact))
          if (
            earlier.some(
              (rule) => !rule.hostname || tunnelHostnameMatches(rule.hostname, input.hostname),
            )
          ) {
            throw DomainError.conflict(
              'Ada aturan lebih awal yang dapat mengambil trafik domain ini. Periksa urutan route melalui halaman Tunnels.',
            )
          }
          return
        }
        if (
          config.ingress.some(
            (rule) =>
              rule.path && (!rule.hostname || tunnelHostnameMatches(rule.hostname, input.hostname)),
          )
        ) {
          throw DomainError.conflict(
            'Domain memiliki aturan path. Kelola melalui halaman Tunnels agar aturan tersebut tidak tertimpa.',
          )
        }
        // Put this exact hostname ahead of wildcard rules without changing other hosts.
        config.ingress.unshift(buildRule(input))
        if (!config.ingress.some(isCatchAll)) config.ingress.push({ service: 'http_status:404' })
      },
    )
  }

  async updateRoute(
    tunnelId: string,
    original: CloudflareTunnelRouteKey,
    input: CloudflareTunnelRouteInput,
    actor: TunnelActor,
  ) {
    return this.mutateConfiguration(
      tunnelId,
      actor,
      'cloudflare.tunnel_route.updated',
      (config) => {
        const index = findRuleIndex(config.ingress, original)
        if (index === -1 || isCatchAll(config.ingress[index]!)) {
          throw DomainError.notFound('Route tunnel tidak ditemukan.')
        }

        const duplicateIndex = findRuleIndex(config.ingress, input)
        if (duplicateIndex !== -1 && duplicateIndex !== index) {
          throw DomainError.conflict('Hostname dan path tersebut sudah terdaftar pada tunnel.')
        }

        config.ingress[index] = buildRule(input, config.ingress[index])
        ensureCatchAll(config)
      },
    )
  }

  async removeRoute(tunnelId: string, key: CloudflareTunnelRouteKey, actor: TunnelActor) {
    return this.mutateConfiguration(
      tunnelId,
      actor,
      'cloudflare.tunnel_route.deleted',
      (config) => {
        const index = findRuleIndex(config.ingress, key)
        if (index === -1 || isCatchAll(config.ingress[index]!)) {
          throw DomainError.notFound('Route tunnel tidak ditemukan.')
        }

        config.ingress.splice(index, 1)
        ensureCatchAll(config)
      },
    )
  }

  private async mutateConfiguration(
    tunnelId: string,
    actor: TunnelActor,
    action: string,
    mutate: (configuration: CloudflareTunnelConfig) => void,
  ) {
    this.assertConfigured()

    try {
      return await useDatabase().transaction(async (transaction) => {
        // Serialize BillEngine's read/modify/write operations for the same tunnel.
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`cloudflare-tunnel:${tunnelId}`}, 0))`,
        )
        const [tunnel, current] = await Promise.all([
          this.client().getTunnel(tunnelId),
          this.client().getConfiguration(tunnelId),
        ])
        if (configSource(tunnel) !== 'cloudflare') {
          throw DomainError.invalidState(
            'Tunnel memakai konfigurasi lokal dan hanya dapat diubah dari file cloudflared.',
          )
        }

        const before = current.config.ingress.map((rule) =>
          serializeRoute(rule, current.config.originRequest),
        )
        const next = structuredClone(current.config)
        mutate(next)
        const updated = await this.client().updateConfiguration(tunnelId, next)
        const after = updated.config.ingress.map((rule) =>
          serializeRoute(rule, updated.config.originRequest),
        )

        await new AuditLogRepository().record(transaction, {
          actorUserId: actor.userId,
          action,
          entityType: 'cloudflare_tunnel',
          entityId: tunnelId,
          beforeData: before,
          afterData: after,
          metadata: { tunnelName: tunnel.name },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        })

        return {
          tunnel: serializeTunnel(tunnel),
          editable: true,
          configuration: {
            version: updated.version ?? null,
            updatedAt: updated.created_at ?? null,
            routes: after,
          },
        } satisfies ApiCloudflareTunnelDetail
      })
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw mapCloudflareError(error)
    }
  }

  private client() {
    return this.injectedClient ?? useCloudflareTunnelClient()
  }

  private isConfigured() {
    if (this.injectedClient) return true
    const config = useRuntimeConfig()
    return Boolean(config.cloudflareApiToken && config.cloudflareAccountId)
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw DomainError.invalidState(
        'NUXT_CLOUDFLARE_API_TOKEN dan NUXT_CLOUDFLARE_ACCOUNT_ID belum dikonfigurasi.',
      )
    }
  }
}

function configSource(tunnel: CloudflareTunnel): 'local' | 'cloudflare' {
  if (tunnel.config_src) return tunnel.config_src
  return tunnel.remote_config === false ? 'local' : 'cloudflare'
}

function serializeTunnel(tunnel: CloudflareTunnel): ApiCloudflareTunnel {
  return {
    id: tunnel.id,
    name: tunnel.name,
    status: tunnel.status,
    configSource: configSource(tunnel),
    createdAt: tunnel.created_at ?? null,
    connectionsActiveAt: tunnel.conns_active_at ?? null,
    connectionsInactiveAt: tunnel.conns_inactive_at ?? null,
    expectedDnsTarget: `${tunnel.id}.cfargotunnel.com`,
  }
}

function serializeRoute(
  rule: CloudflareTunnelIngressRule,
  defaults?: CloudflareTunnelConfig['originRequest'],
): ApiCloudflareTunnelRoute {
  return {
    hostname: rule.hostname?.trim().toLowerCase() || null,
    path: rule.path?.trim() || null,
    service: rule.service,
    noTlsVerify: rule.originRequest?.noTLSVerify ?? defaults?.noTLSVerify ?? false,
    httpHostHeader: rule.originRequest?.httpHostHeader ?? defaults?.httpHostHeader ?? null,
    originServerName: rule.originRequest?.originServerName ?? defaults?.originServerName ?? null,
    catchAll: isCatchAll(rule),
  }
}

function buildRule(
  input: CloudflareTunnelRouteInput,
  existing?: CloudflareTunnelIngressRule,
): CloudflareTunnelIngressRule {
  const rule: CloudflareTunnelIngressRule = {
    ...(existing ?? {}),
    hostname: input.hostname,
    service: input.service,
  }

  if (input.path) rule.path = input.path
  else delete rule.path

  const originRequest = { ...(existing?.originRequest ?? {}) }
  originRequest.noTLSVerify = input.noTlsVerify
  if (input.httpHostHeader) originRequest.httpHostHeader = input.httpHostHeader
  else delete originRequest.httpHostHeader
  if (input.originServerName) originRequest.originServerName = input.originServerName
  else delete originRequest.originServerName

  if (Object.keys(originRequest).length > 0) rule.originRequest = originRequest
  else delete rule.originRequest
  return rule
}

function normalizedKey(value: CloudflareTunnelRouteKey) {
  return `${value.hostname.trim().toLowerCase()}\n${value.path.trim()}`
}

function findRuleIndex(rules: CloudflareTunnelIngressRule[], key: CloudflareTunnelRouteKey) {
  const target = normalizedKey(key)
  return rules.findIndex(
    (rule) =>
      !isCatchAll(rule) &&
      normalizedKey({ hostname: rule.hostname ?? '', path: rule.path ?? '' }) === target,
  )
}

function isCatchAll(rule: CloudflareTunnelIngressRule) {
  return !rule.hostname?.trim() && !rule.path?.trim()
}

function ensureCatchAll(config: CloudflareTunnelConfig) {
  const catchAllRules = config.ingress.filter(isCatchAll)
  config.ingress = config.ingress.filter((rule) => !isCatchAll(rule))
  config.ingress.push(catchAllRules[0] ?? { service: 'http_status:404' })
}

function mapCloudflareError(error: unknown) {
  if (error instanceof CloudflareTunnelClientError) {
    if (error.statusCode === 404) return DomainError.notFound('Cloudflare Tunnel tidak ditemukan.')
    if (error.statusCode === 401 || error.statusCode === 403) {
      return DomainError.external(
        'Token Cloudflare tidak memiliki akses Tunnel yang diperlukan. Periksa Account ID dan permission token.',
      )
    }
  }
  return DomainError.external('Cloudflare Tunnel API tidak dapat menyelesaikan permintaan.')
}
