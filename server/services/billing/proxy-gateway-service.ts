import { createHash } from 'node:crypto'
import type { z } from 'zod'
import type {
  ApiProxyGateway,
  ApiProxyGatewayPlan,
  proxyGatewayPlanSchema,
} from '../../../shared/schemas/gateway'
import { GatewayRepository } from '../../repositories/gateway'
import { clientForCoolifyConnection } from '../../integrations/coolify/connection'
import { CoolifyClientError } from '../../integrations/coolify/client'
import { DomainError } from '../../utils/errors'
import { billingGateRuntime } from '../../utils/billing-gate'
import type { SettingsActorContext } from '../settings/settings-service'
import { GatewayManagementService } from './gateway-management-service'
import {
  inspectProxyConfiguration,
  planProxyGateway,
  proxyConfigurationRevision,
  validateInternalGateUrl,
} from './proxy-gateway-config'

type PlanInput = z.infer<typeof proxyGatewayPlanSchema>
const keyFor = (id: string) => `gateway.proxy.${id}`

export class ProxyGatewayService {
  constructor(
    private readonly repository = new GatewayRepository(),
    private readonly makeClient = clientForCoolifyConnection,
    private readonly gatewaySettings = () => new GatewayManagementService().getSettings(),
  ) {}

  private async context(id: string) {
    const target = await this.repository.nodeTarget(id)
    if (!target)
      throw DomainError.notFound(
        'Node Coolify tidak ditemukan. Sinkronkan Servers terlebih dahulu.',
      )
    if (!target.server.isActive) throw DomainError.invalidState('Koneksi Coolify tidak aktif.')
    const client = this.makeClient(target.server)
    const proxy = await client.getServerProxy(target.node.coolifyUuid)
    if (proxy.proxy_type?.toLowerCase() !== 'traefik')
      throw DomainError.invalidState('Gate per server hanya mendukung proxy Traefik.')
    if (!Object.hasOwn(proxy, 'configuration'))
      throw DomainError.invalidState(
        'Token membutuhkan read:sensitive dan pemilik token harus admin/owner team Coolify untuk membaca konfigurasi proxy.',
      )
    if (!proxy.configuration)
      throw DomainError.invalidState(
        'Konfigurasi proxy belum tersimpan di database Coolify. Buka Proxy → Configuration, simpan konfigurasi yang ada, lalu muat ulang di sini.',
      )
    inspectProxyConfiguration(proxy.configuration)
    return { ...target, client, configuration: proxy.configuration }
  }

  private async safely<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof CoolifyClientError) {
        if (error.statusCode === 404 || error.statusCode === 405)
          throw DomainError.invalidState(
            'Endpoint konfigurasi proxy tidak tersedia pada versi Coolify ini atau node tidak ditemukan. Perbarui Coolify/sinkronkan Servers, atau konfigurasi entrypoint secara manual.',
          )
        if (error.statusCode === 401 || error.statusCode === 403)
          throw DomainError.external(
            'Akses proxy ditolak Coolify. Periksa token admin dengan read:sensitive, write, dan deploy.',
          )
        throw DomainError.external(
          'Coolify gagal memproses konfigurasi proxy. Muat ulang untuk memeriksa hasil sebelum mencoba lagi; proxy belum direstart oleh BillEngine.',
        )
      }
      if (error instanceof Error && error.message === 'COOLIFY_CREDENTIALS_MISSING')
        throw DomainError.invalidState('Kredensial koneksi Coolify belum tersedia.')
      throw error
    }
  }

  get(id: string): Promise<ApiProxyGateway> {
    return this.safely(async () => {
      const context = await this.context(id)
      const { entrypoints } = inspectProxyConfiguration(context.configuration)
      const saved = (await this.repository.read(keyFor(id))) as
        { checkUrl?: string; savedAt?: string; configurationRevision?: string } | undefined
      const fallback = await this.gatewaySettings()
      const current = entrypoints
        .filter((entrypoint) =>
          entrypoint.middlewares
            .split(',')
            .map((value) => value.trim())
            .includes('billing-gate@file'),
        )
        .map((entrypoint) => entrypoint.name)
      return {
        nodeName: context.node.name,
        entrypoints,
        checkUrl: saved?.checkUrl ?? fallback.checkUrl,
        selected: current.length
          ? current
          : saved
            ? []
            : entrypoints
                .filter((entrypoint) => entrypoint.recommended)
                .map((entrypoint) => entrypoint.name),
        savedAt:
          saved?.configurationRevision === proxyConfigurationRevision(context.configuration)
            ? (saved.savedAt ?? null)
            : null,
      }
    })
  }

  private prepare(id: string, configuration: string, input: PlanInput) {
    if (input.entrypoints.length) {
      const runtime = billingGateRuntime()
      if (!runtime.secret || !runtime.sharedKey)
        throw DomainError.invalidState(
          'Atur kedua secret gate pada deployment BillEngine sebelum mengaktifkan proxy gate.',
        )
      validateInternalGateUrl(input.checkUrl, configuration, runtime.appUrl)
    }
    const plan = planProxyGateway(configuration, input.entrypoints)
    const revision = createHash('sha256')
      .update(
        JSON.stringify([
          id,
          configuration,
          plan.configuration,
          input.checkUrl,
          [...input.entrypoints].sort(),
        ]),
      )
      .digest('hex')
    return { ...plan, revision }
  }

  preview(id: string, input: PlanInput): Promise<ApiProxyGatewayPlan> {
    return this.safely(async () => {
      const context = await this.context(id)
      const { revision, changed, changes, healthcheck } = this.prepare(
        id,
        context.configuration,
        input,
      )
      return { revision, changed, changes, healthcheck }
    })
  }

  save(id: string, input: PlanInput & { revision: string }, actor: SettingsActorContext) {
    return this.safely(async () => {
      const context = await this.context(id)
      const plan = this.prepare(id, context.configuration, input)
      if (plan.revision !== input.revision)
        throw DomainError.conflict(
          'Konfigurasi proxy atau pilihan berubah sejak pratinjau. Muat ulang pratinjau sebelum menyimpan.',
        )
      if (plan.changed) {
        await context.client.saveServerProxyConfiguration(
          context.node.coolifyUuid,
          plan.configuration,
        )
        const after = await context.client.getServerProxy(context.node.coolifyUuid)
        if (after.configuration !== plan.configuration)
          throw DomainError.external(
            'Hasil simpan proxy tidak sesuai pratinjau. Periksa konfigurasi di Coolify sebelum restart.',
          )
      }
      await this.repository.save(
        keyFor(id),
        {
          nodeId: id,
          checkUrl: input.checkUrl,
          entrypoints: input.entrypoints,
          configurationRevision: proxyConfigurationRevision(plan.configuration),
          savedAt: new Date().toISOString(),
          changes: plan.changes,
          healthcheck: plan.healthcheck,
        },
        null,
        actor,
      )
      return {
        restartRequired: plan.changed,
        message:
          'Konfigurasi tersimpan. Pastikan YAML middleware memakai URL internal yang sama, lalu restart proxy secara manual di Coolify. Periksa gate pada resource setelahnya.',
      }
    })
  }
}
