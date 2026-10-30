import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ApplicationDomains } from '../../../shared/types/application-domains'
import type { ConnectApplicationDomainInput } from '../../../shared/schemas/application-domains'
import { connectApplicationDomainSchema } from '../../../shared/schemas/application-domains'
import { applicationSpecSchema } from '../../../shared/schemas/infrastructure'
import { tunnelHostnameMatches } from '../../../shared/utils/tunnel-hostname'
import { useDatabase, type Database } from '../../database/client'
import {
  auditLogs,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  resourceRoutes,
  serviceResources,
  services,
} from '../../database/schema'
import { useCloudflareClient } from '../../integrations/cloudflare/client'
import { CloudflareTunnelService } from '../cloudflare/tunnel-service'
import { DomainError } from '../../utils/errors'

export class ApplicationDomainService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly tunnels = new CloudflareTunnelService(),
  ) {}

  async read(resourceId: string): Promise<ApplicationDomains> {
    const [entry] = await this.database
      .select({ resource: infrastructureResources, node: infrastructureNodes })
      .from(infrastructureResources)
      .innerJoin(infrastructureNodes, eq(infrastructureNodes.id, infrastructureResources.nodeId))
      .where(
        and(
          eq(infrastructureResources.id, resourceId),
          eq(infrastructureResources.kind, 'application'),
          isNull(infrastructureResources.deletedAt),
        ),
      )
      .limit(1)
    if (!entry) throw DomainError.notFound('Deployment aplikasi tidak ditemukan.')
    const { resource, node } = entry
    const spec = applicationSpecSchema.parse(resource.desiredSpec)
    const routes = await this.database
      .select()
      .from(resourceRoutes)
      .where(eq(resourceRoutes.resourceId, resourceId))
    const overview = await this.tunnels.overview()
    const result: ApplicationDomains = {
      resource: {
        id: resource.id,
        name: resource.name,
        nodeName: node.name,
        revision: resource.desiredRevision,
        gatewayStatus: node.gatewayStatus,
        ports: spec.ports
          .filter((port) => port.protocol === 'tcp')
          .map((port) => port.containerPort),
      },
      configured: overview.configured,
      tunnels: overview.tunnels,
      warnings: [],
      domains: routes.map((route) => ({
        hostname: route.hostname,
        source: 'route',
        targetPort: route.targetPort,
        routeStatus: ['pending', 'configuring', 'disabled'].includes(route.desiredStatus)
          ? route.desiredStatus
          : route.observedStatus,
        dns: { status: 'unavailable' },
        matches: [],
      })),
    }
    try {
      const url = new URL(spec.environment.APP_URL || '')
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        connectApplicationDomainSchema.shape.hostname.safeParse(url.hostname).success &&
        !result.domains.some((domain) => domain.hostname === url.hostname)
      ) {
        result.domains.push({
          hostname: url.hostname,
          source: 'app_url',
          targetPort: null,
          routeStatus: null,
          dns: { status: 'unavailable' },
          matches: [],
        })
      }
    } catch {
      /* APP_URL is optional and is only a hint, never a verified route. */
    }
    if (!result.domains.length || !overview.configured) return result

    const config = useRuntimeConfig()
    await Promise.all(
      result.domains.map(async (domain) => {
        if (!config.cloudflareApiToken || !config.cloudflareZoneId) return
        try {
          const record = await useCloudflareClient().hostnameDnsRecord(domain.hostname)
          domain.dns = record
            ? {
                status: 'record',
                type: record.type,
                target: record.content,
                proxied: record.proxied,
              }
            : { status: 'missing' }
        } catch {
          domain.dns = { status: 'unavailable' }
        }
      }),
    )

    // Prefer DNS-selected tunnels; bound remote calls and report incomplete discovery.
    const candidates = [...overview.tunnels].sort((left, right) => {
      const selected = (id: string) =>
        result.domains.some(
          (domain) =>
            domain.dns.target?.toLowerCase().replace(/\.$/, '') === `${id}.cfargotunnel.com`,
        )
      return Number(selected(right.id)) - Number(selected(left.id))
    })
    if (candidates.length > 50)
      result.warnings.push(
        'Pencarian dibatasi pada 50 tunnel. Tunnel tujuan DNS diperiksa lebih dulu.',
      )
    for (let index = 0; index < Math.min(candidates.length, 50); index += 5) {
      await Promise.all(
        candidates.slice(index, Math.min(index + 5, 50)).map(async (tunnel) => {
          if (tunnel.configSource === 'local') {
            result.warnings.push(
              `Tunnel ${tunnel.name} memakai konfigurasi lokal; origin harus diperiksa pada cloudflared.`,
            )
            return
          }
          try {
            const detail = await this.tunnels.detail(tunnel.id)
            for (const domain of result.domains) {
              for (const route of detail.configuration?.routes ?? []) {
                if (route.catchAll) {
                  if (
                    domain.dns.target?.toLowerCase().replace(/\.$/, '') === tunnel.expectedDnsTarget
                  )
                    domain.matches.push({ tunnel: detail.tunnel, route })
                  break
                }
                if (
                  !tunnelHostnameMatches(route.hostname, domain.hostname) &&
                  !(
                    route.path &&
                    !route.hostname &&
                    domain.dns.target?.toLowerCase().replace(/\.$/, '') === tunnel.expectedDnsTarget
                  )
                )
                  continue
                domain.matches.push({ tunnel: detail.tunnel, route })
                if (!route.path) break
              }
            }
          } catch {
            result.warnings.push(`Konfigurasi tunnel ${tunnel.name} belum dapat dibaca.`)
          }
        }),
      )
    }
    return result
  }

  async connect(
    resourceId: string,
    input: ConnectApplicationDomainInput,
    actor: { userId: string; ipAddress?: string | null; userAgent?: string | null },
    idempotencyKey: string,
  ) {
    let remoteWritten = false
    try {
      return await this.database.transaction(async (transaction) => {
        const [resource] = await transaction
          .select()
          .from(infrastructureResources)
          .where(
            and(
              eq(infrastructureResources.id, resourceId),
              eq(infrastructureResources.kind, 'application'),
              isNull(infrastructureResources.deletedAt),
            ),
          )
          .limit(1)
          .for('update')
        if (!resource) throw DomainError.notFound('Deployment aplikasi tidak ditemukan.')
        const [previous] = await transaction
          .select()
          .from(infrastructureOperations)
          .where(eq(infrastructureOperations.idempotencyKey, idempotencyKey))
          .limit(1)
        if (previous) {
          if (
            previous.resourceId !== resourceId ||
            previous.actorUserId !== actor.userId ||
            previous.action !== 'route.configure'
          )
            throw DomainError.conflict('Idempotency key sudah digunakan.')
          return { operationId: previous.id, replayed: true }
        }
        if (resource.desiredRevision !== input.expectedRevision)
          throw DomainError.conflict(
            'Konfigurasi deployment berubah. Muat ulang sebelum menghubungkan domain.',
          )
        if (
          resource.desiredState !== 'running' ||
          resource.observedState !== 'running' ||
          resource.observedRevision !== resource.desiredRevision
        )
          throw DomainError.invalidState(
            'Tunggu hingga deployment berjalan dan revisinya sinkron sebelum menghubungkan domain.',
          )
        const [busy] = await transaction
          .select({ id: infrastructureOperations.id })
          .from(infrastructureOperations)
          .where(
            and(
              eq(infrastructureOperations.resourceId, resourceId),
              inArray(infrastructureOperations.status, ['queued', 'dispatched', 'running']),
            ),
          )
          .limit(1)
        if (busy)
          throw DomainError.invalidState('Tunggu operasi deployment yang sedang berjalan selesai.')
        const [node] = await transaction
          .select()
          .from(infrastructureNodes)
          .where(eq(infrastructureNodes.id, resource.nodeId))
          .limit(1)
        if (!node?.isActive || node.isDraining || node.gatewayStatus !== 'healthy')
          throw DomainError.invalidState(
            'Gateway Traefik pada server aplikasi harus healthy dan server harus aktif.',
          )
        const spec = applicationSpecSchema.parse(resource.desiredSpec)
        if (
          !spec.ports.some(
            (port) => port.protocol === 'tcp' && port.containerPort === input.targetPort,
          )
        )
          throw DomainError.validation('Pilih port TCP yang terdaftar pada deployment ini.')
        const owners = await transaction
          .select({ status: services.status, blocked: services.billingBlocked })
          .from(serviceResources)
          .innerJoin(services, eq(services.id, serviceResources.serviceId))
          .where(eq(serviceResources.resourceId, resourceId))
        if (
          owners.some((owner) => owner.status !== 'active' || owner.blocked) ||
          (resource.classification === 'billable' && owners.length !== 1)
        )
          throw DomainError.invalidState('Layanan billing harus aktif sebelum domain dihubungkan.')
        const [existing] = await transaction
          .select()
          .from(resourceRoutes)
          .where(eq(resourceRoutes.hostname, input.hostname))
          .limit(1)
        if (existing && existing.resourceId !== resourceId)
          throw DomainError.conflict('Domain sudah dipakai oleh deployment lain.')
        const billingGateEnabled =
          resource.classification === 'billable' || Boolean(existing?.billingGateEnabled)
        const config = useRuntimeConfig()
        if (billingGateEnabled && (!config.billingGateInternalUrl || !config.billingGateSharedKey))
          throw DomainError.invalidState('Billing gate belum dikonfigurasi.')

        const routeId = existing?.id ?? randomUUID()
        if (!existing)
          await transaction.insert(resourceRoutes).values({
            id: routeId,
            resourceId,
            hostname: input.hostname,
            targetPort: input.targetPort,
            tlsEnabled: false,
            billingGateEnabled,
            desiredStatus: 'configuring',
            observedStatus: 'pending',
          })
        else
          await transaction
            .update(resourceRoutes)
            .set({
              targetPort: input.targetPort,
              billingGateEnabled,
              desiredStatus: 'configuring',
              updatedAt: new Date(),
            })
            .where(eq(resourceRoutes.id, routeId))

        await this.tunnels.connectApplicationRoute(
          input.tunnelId,
          {
            hostname: input.hostname,
            path: '',
            service: input.origin,
            noTlsVerify: false,
            httpHostHeader: '',
            originServerName: '',
          },
          actor,
        )
        remoteWritten = true
        const [operation] = await transaction
          .insert(infrastructureOperations)
          .values({
            nodeId: resource.nodeId,
            resourceId,
            actorUserId: actor.userId,
            idempotencyKey,
            action: 'route.configure',
            expectedResourceRevision: resource.desiredRevision,
            expiresAt: new Date(Date.now() + 15 * 60_000),
            payload: {
              routeId,
              resourceId,
              hostname: input.hostname,
              targetPort: input.targetPort,
              networkName: spec.networkName,
              billingGateEnabled,
              ...(billingGateEnabled
                ? { billingGateUrl: String(config.billingGateInternalUrl) }
                : {}),
            },
          })
          .returning({ id: infrastructureOperations.id })
        if (!operation) throw new Error('Operasi konfigurasi domain tidak dapat dibuat.')
        await transaction.insert(auditLogs).values({
          actorUserId: actor.userId,
          action: 'infrastructure.domain.connected',
          entityType: 'infrastructure_resource',
          entityId: resourceId,
          metadata: {
            hostname: input.hostname,
            tunnelId: input.tunnelId,
            origin: input.origin,
            targetPort: input.targetPort,
            operationId: operation.id,
          },
        })
        return { operationId: operation.id, replayed: false }
      })
    } catch (error) {
      if (remoteWritten)
        throw DomainError.external(
          'Route di Cloudflare sudah tersimpan, tetapi konfigurasi lokal belum berhasil diselesaikan. Muat ulang, periksa route, lalu coba hubungkan kembali dengan pengaturan yang sama.',
        )
      throw error
    }
  }
}
