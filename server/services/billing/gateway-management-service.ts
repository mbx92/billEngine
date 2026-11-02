import type {
  ApiGatewaySettings,
  ApiResourceGate,
  ApiGateVerification,
} from '../../../shared/schemas/gateway'
import { gatewaySettingsSchema } from '../../../shared/schemas/gateway'
import { GatewayRepository } from '../../repositories/gateway'
import { BillingAccessRepository } from '../../repositories/billing-access'
import { clientForCoolifyConnection } from '../../integrations/coolify/connection'
import { CoolifyClientError } from '../../integrations/coolify/client'
import { DomainError } from '../../utils/errors'
import { billingGateRuntime } from '../../utils/billing-gate'
import { SettingsService, type SettingsActorContext } from '../settings/settings-service'
import { planGatewayLabels, gatewayRevision, decodeLabels } from './gateway-labels'
import { inspectGateway } from './gateway-probe'
import { BillingAccessControlService } from './access-control-service'
import { normalizeCoolifyApplication } from '../../integrations/coolify/normalize'

const settingsKey = 'gateway.configuration'
const resourceKey = (id: string) => `gateway.resource.${id}`

export class GatewayManagementService {
  constructor(
    private readonly repository = new GatewayRepository(),
    private readonly access = new BillingAccessRepository(),
    private readonly settings = new SettingsService(),
    private readonly makeClient = clientForCoolifyConnection,
    private readonly probe = inspectGateway,
  ) {}

  async getSettings(): Promise<ApiGatewaySettings> {
    const stored = gatewaySettingsSchema.safeParse(await this.repository.read(settingsKey))
    const runtime = billingGateRuntime()
    return {
      checkUrl: stored.success
        ? stored.data.checkUrl
        : String(useRuntimeConfig().billingGateInternalUrl || ''),
      secretsConfigured: Boolean(runtime.secret && runtime.sharedKey),
    }
  }

  async saveSettings(input: { checkUrl: string }, actor: SettingsActorContext) {
    await this.repository.save(settingsKey, gatewaySettingsSchema.parse(input), null, actor)
    return this.getSettings()
  }

  private async context(id: string, labelsRequired = true) {
    const target = await this.repository.target(id)
    if (!target) throw DomainError.notFound('Resource tidak ditemukan.')
    if (!target.server.isActive) throw DomainError.invalidState('Koneksi Coolify tidak aktif.')
    if (
      target.resource.resourceType !== 'application' ||
      target.resource.classification !== 'billable'
    ) {
      throw DomainError.invalidState('Gate hanya dapat dikonfigurasi pada aplikasi billable.')
    }
    const runtime = billingGateRuntime()
    if (!runtime.secret || !runtime.sharedKey)
      throw DomainError.invalidState(
        'Konfigurasikan kedua secret gate pada deployment BillEngine terlebih dahulu.',
      )
    let billingHost: string
    try {
      billingHost = new URL(runtime.appUrl).hostname.toLowerCase()
    } catch {
      throw DomainError.invalidState('NUXT_PUBLIC_APP_URL belum valid.')
    }
    const client = this.makeClient(target.server)
    const app = await client.getApplication(target.resource.coolifyUuid)
    const compose = app.build_pack === 'dockercompose'
    const values = (normalizeCoolifyApplication(app).fqdn || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const urls = [
      ...new Set(
        values.map((value) => {
          let url: URL
          try {
            url = new URL(value)
          } catch {
            throw DomainError.invalidState(
              'Domain Coolify belum berupa URL yang valid. Periksa domain aplikasi.',
            )
          }
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          ) {
            throw DomainError.invalidState(
              'Domain aplikasi harus berupa URL HTTP(S) tanpa kredensial, query, atau fragment.',
            )
          }
          if (url.hostname.toLowerCase() === billingHost)
            throw DomainError.invalidState(
              'Gate tidak boleh dipasang pada domain BillEngine sendiri.',
            )
          return url.href
        }),
      ),
    ].filter((value, _index, all) => {
      const url = new URL(value)
      return (
        url.protocol === 'https:' ||
        !all.some((other) => new URL(other).hostname === url.hostname && other.startsWith('https:'))
      )
    })
    if (!urls.length)
      throw DomainError.invalidState('Atur domain aplikasi di Coolify terlebih dahulu.')
    const serviceIds = await this.repository.serviceIds(id)
    for (const url of urls) {
      const service = await this.access.findServiceByHost(new URL(url).hostname.toLowerCase())
      if (!service || !serviceIds.includes(service.id)) {
        throw DomainError.invalidState(
          'Sinkronkan Resources lalu hubungkan aplikasi ke satu service. Domain belum memiliki pemilik billing yang jelas.',
        )
      }
    }
    return {
      target,
      client,
      app,
      urls,
      plan:
        !compose && labelsRequired
          ? planGatewayLabels(
              app.custom_labels,
              urls.map((url) => new URL(url).hostname.toLowerCase()),
            )
          : null,
    }
  }

  private async safely<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof CoolifyClientError)
        throw DomainError.external(
          'Coolify tidak dapat membaca atau menyimpan label. Periksa koneksi, izin token, dan versi Coolify.',
        )
      if (error instanceof Error && error.message === 'COOLIFY_CREDENTIALS_MISSING')
        throw DomainError.invalidState('Kredensial Coolify belum tersedia.')
      throw error
    }
  }

  preview(id: string): Promise<ApiResourceGate> {
    return this.safely(async () => {
      const context = await this.context(id)
      const revision = gatewayRevision(context.app)
      const saved = (await this.repository.read(resourceKey(id))) as
        { revision?: string; verifiedAt?: string } | undefined
      return {
        mode: context.app.build_pack === 'dockercompose' ? 'proxy' : 'application',
        nodeUuid: context.target.resource.coolifyNodeUuid,
        revision,
        configured: context.plan?.configured ?? false,
        changes: context.plan?.changes ?? [],
        urls: context.urls,
        verifiedAt: saved?.revision === revision ? (saved.verifiedAt ?? null) : null,
      }
    })
  }

  save(id: string, revision: string, actor: SettingsActorContext): Promise<ApiResourceGate> {
    return this.safely(async () => {
      const context = await this.context(id)
      if (!context.plan)
        throw DomainError.invalidState(
          'Untuk Docker Compose, gunakan Servers → Gate proxy pada node aplikasi. Verifikasi tetap tersedia di resource ini.',
        )
      if (gatewayRevision(context.app) !== revision)
        throw DomainError.conflict(
          'Konfigurasi Coolify berubah. Muat ulang pratinjau sebelum menyimpan.',
        )
      if (!context.plan.configured) {
        await context.client.saveApplicationGatewayLabels(
          context.target.resource.coolifyUuid,
          context.plan.labels,
        )
        const after = await context.client.getApplication(context.target.resource.coolifyUuid)
        const expectedLabels = context.plan.labels
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .sort()
        const actualLabels = decodeLabels(after.custom_labels)
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .sort()
        const afterSettings = after.settings as Record<string, unknown> | undefined
        if (
          JSON.stringify(actualLabels) !== JSON.stringify(expectedLabels) ||
          afterSettings?.is_container_label_readonly_enabled === true
        ) {
          throw DomainError.external(
            'Coolify belum menyimpan referensi gate. Periksa versi dan pengaturan pengelolaan label di Coolify.',
          )
        }
        await this.repository.save(
          resourceKey(id),
          { revision: gatewayRevision(after), verifiedAt: null, savedAt: new Date().toISOString() },
          id,
          actor,
        )
      }
      return this.preview(id)
    })
  }

  verify(id: string, actor: SettingsActorContext): Promise<ApiGateVerification> {
    return this.safely(async () => {
      const context = await this.context(id, false)
      const runtime = billingGateRuntime()
      const billing = await this.settings.getBillingSettings()
      const evaluator = new BillingAccessControlService(this.access, this.settings)
      const results = await Promise.all(
        context.urls.map(async (url) => ({
          url,
          ...(await this.probe(url, runtime.secret)),
          state: (await evaluator.evaluate(new URL(url).hostname.toLowerCase(), runtime.secret))
            .state,
        })),
      )
      const reachable = results.every((result) => result.verified)
      await this.repository.save(
        resourceKey(id),
        {
          revision: gatewayRevision(context.app),
          verifiedAt: reachable ? new Date().toISOString() : null,
        },
        id,
        actor,
      )
      return { reachable, enabled: billing.billingAccessControlEnabled, results }
    })
  }
}
