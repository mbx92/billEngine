import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { isSeq, parseDocument } from 'yaml'
import { DomainError } from '../../utils/errors'
import { gatewaySettingsSchema } from '../../../shared/schemas/gateway'

const middleware = 'billing-gate@file'
const healthEntrypoint = 'billengine-health'
export const proxyConfigurationRevision = (configuration: string) =>
  createHash('sha256').update(configuration).digest('hex')

export function inspectProxyConfiguration(configuration: string) {
  if (!configuration || configuration.length > 1_000_000)
    throw DomainError.invalidState(
      'Konfigurasi proxy kosong atau terlalu besar. Simpan konfigurasi proxy di Coolify terlebih dahulu.',
    )
  const document = parseDocument(configuration)
  if (document.errors.length || document.warnings.length)
    throw DomainError.invalidState(
      'YAML proxy tidak valid atau memakai tag khusus. Sesuaikan manual di Coolify.',
    )
  let config: Record<string, unknown>
  try {
    config = document.toJS({ maxAliasCount: 0 })
  } catch {
    throw DomainError.invalidState('Alias YAML proxy tidak didukung untuk perubahan otomatis.')
  }
  const services = config?.services as Record<string, Record<string, unknown>> | undefined
  const candidates = Object.entries(services ?? {}).filter(
    ([, service]) =>
      typeof service?.image === 'string' && /(^|\/)traefik(?=[:@]|$)/.test(service.image),
  )
  if (candidates.length !== 1)
    throw DomainError.invalidState(
      'Harus ada tepat satu service Traefik dengan image eksplisit pada konfigurasi proxy.',
    )
  const [serviceName, service] = candidates[0]!
  if (service.container_name !== 'coolify-proxy')
    throw DomainError.invalidState('Container proxy harus bernama coolify-proxy.')
  const command = document.getIn(['services', serviceName, 'command'])
  if (
    !isSeq(command) ||
    !Array.isArray(service.command) ||
    !service.command.every((value) => typeof value === 'string')
  ) {
    throw DomainError.invalidState(
      'Konfigurasi otomatis membutuhkan command Traefik dalam bentuk daftar argumen YAML.',
    )
  }
  const flags = new Map<string, { index: number; value: string; originalKey: string }>()
  for (const [index, argument] of (service.command as string[]).entries()) {
    const match = /^--([^=\s]+)(?:=(.*))?$/.exec(argument)
    if (!match)
      throw DomainError.invalidState('Argumen proxy harus menggunakan format --nama=nilai.')
    const key = match[1]!.toLowerCase()
    if (flags.has(key))
      throw DomainError.invalidState(
        'Argumen proxy duplikat. Rapikan konfigurasi di Coolify terlebih dahulu.',
      )
    flags.set(key, { index, value: match[2] ?? 'true', originalKey: match[1]! })
  }
  const envKeys = Array.isArray(service.environment)
    ? service.environment.map((value) => String(value).split('=')[0]!)
    : Object.keys(service.environment ?? {})
  if (
    flags.has('configfile') ||
    envKeys.some((key) => /^TRAEFIK_(ENTRYPOINTS|CONFIGFILE|PROVIDERS_FILE|PING)/i.test(key))
  ) {
    throw DomainError.invalidState(
      'Konfigurasi entrypoint/provider dari environment atau configFile perlu dikelola manual.',
    )
  }
  if (
    !flags.get('providers.file.directory')?.value &&
    !flags.get('providers.file.filename')?.value
  ) {
    throw DomainError.invalidState(
      'File provider Traefik belum dikonfigurasi. Pasang provider dan billing-gate.yaml di Coolify.',
    )
  }
  const entrypoints = [...flags].flatMap(([key, flag]) => {
    const match = /^entrypoints\.([a-z0-9_-]+)\.address$/.exec(key)
    if (
      !match ||
      /\/udp$/i.test(flag.value) ||
      match[1] === 'traefik' ||
      match[1] === healthEntrypoint ||
      /^(127\.|\[::1\]:|localhost:)/i.test(flag.value)
    )
      return []
    const name = flag.originalKey.split('.')[1]!
    const address = flag.value
    if (address.includes('$'))
      throw DomainError.invalidState(
        'Alamat entrypoint harus eksplisit untuk memeriksa loop gateway.',
      )
    return [
      {
        name,
        address,
        middlewares: flags.get(`entrypoints.${name.toLowerCase()}.http.middlewares`)?.value ?? '',
        recommended: /:(80|443)(\/tcp)?$/.test(address),
      },
    ]
  })
  if (!entrypoints.length)
    throw DomainError.invalidState('Entrypoint aplikasi tidak ditemukan pada command Traefik.')
  return { document, serviceName, service, command, flags, entrypoints }
}

export function validateInternalGateUrl(
  checkUrl: string,
  configuration: string,
  publicAppUrl: string,
) {
  const parsed = gatewaySettingsSchema.safeParse({ checkUrl })
  if (!parsed.success)
    throw DomainError.validation(
      'URL gate harus berupa HTTP(S) /api/billing-gate/check tanpa query atau kredensial.',
    )
  const url = new URL(parsed.data.checkUrl)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  let publicHost: string
  try {
    publicHost = new URL(publicAppUrl).hostname.toLowerCase()
  } catch {
    throw DomainError.invalidState('NUXT_PUBLIC_APP_URL belum valid.')
  }
  const ipType = isIP(host)
  const octets = host.split('.').map(Number)
  const privateIp =
    ipType === 4
      ? octets[0] === 10 ||
        (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
      : ipType === 6 && /^(fc|fd)/i.test(host)
  const containerHost =
    host === 'host.docker.internal' ||
    (!ipType && /^[a-z0-9][a-z0-9_-]*$/.test(host) && host !== 'localhost')
  if ((!privateIp && !containerHost) || url.hostname.toLowerCase() === publicHost) {
    throw DomainError.validation(
      'Gunakan alamat langsung BillEngine: IP privat atau nama container, bukan domain publik/localhost. Contoh http://host.docker.internal:8010/api/billing-gate/check.',
    )
  }
  const proxy = inspectProxyConfiguration(configuration)
  if (host === proxy.serviceName.toLowerCase() || host === 'coolify-proxy') {
    throw DomainError.validation('URL gate tidak boleh menunjuk container proxy itu sendiri.')
  }
  const proxyPorts = new Set([80, 443])
  for (const entrypoint of proxy.entrypoints) {
    const match = /:(\d+)(?:\/tcp)?$/.exec(entrypoint.address)
    if (match) proxyPorts.add(Number(match[1]))
  }
  for (const value of Array.isArray(proxy.service.ports) ? proxy.service.ports : []) {
    if (typeof value === 'object' && value) {
      proxyPorts.add(Number(value.published))
      proxyPorts.add(Number(value.target))
    } else {
      const parts = String(value)
        .replace(/\/(tcp|udp)$/, '')
        .split(':')
      proxyPorts.add(Number(parts.at(-1)))
      if (parts.length > 1) proxyPorts.add(Number(parts.at(-2)))
    }
  }
  if (proxyPorts.has(port))
    throw DomainError.validation(
      'Port URL gate sama dengan listener/port proxy. Gunakan port langsung BillEngine untuk menghindari loop.',
    )
}

export function planProxyGateway(configuration: string, selected: string[]) {
  const proxy = inspectProxyConfiguration(configuration)
  if (selected.some((name) => !proxy.entrypoints.some((entrypoint) => entrypoint.name === name)))
    throw DomainError.validation('Entrypoint tidak ditemukan. Muat ulang konfigurasi.')
  const edits: Array<{ index: number; value: string | null }> = []
  const additions: string[] = []
  // Coolify's default ping uses the public HTTP entrypoint. EntryPoint middleware
  // also wraps ping@internal, so health must not depend on the billing backend.
  let healthcheck: { before: string; after: string; address: string } | null = null
  const ping = proxy.flags.get('ping.entrypoint')
  if (selected.some((name) => name.toLowerCase() === (ping?.value ?? 'traefik').toLowerCase())) {
    const health = proxy.service.healthcheck as Record<string, unknown> | undefined
    const test = health?.test
    const shellTest =
      typeof test === 'string'
        ? test
        : Array.isArray(test) && test.length === 2 && test[0] === 'CMD-SHELL'
          ? test[1]
          : null
    const match =
      typeof shellTest === 'string'
        ? /^wget -qO- http:\/\/(localhost|127\.0\.0\.1):(\d+)\/ping \|\| exit 1$/.exec(
            shellTest.trim(),
          )
        : null
    const pingAddress = proxy.flags.get(`entrypoints.${ping?.value.toLowerCase()}.address`)?.value
    if (
      !match ||
      !pingAddress?.endsWith(`:${match[2]}`) ||
      proxy.flags.get('ping')?.value === 'false' ||
      proxy.flags.get('ping.manualrouting')?.value === 'true' ||
      health?.disable === true
    ) {
      throw DomainError.invalidState(
        'Healthcheck proxy memakai entrypoint yang akan dipasangi gate. Pisahkan ping dan healthcheck ke listener loopback tanpa middleware di Coolify; format healthcheck khusus tidak diubah otomatis.',
      )
    }
    if ([...proxy.flags.keys()].some((key) => key.startsWith(`entrypoints.${healthEntrypoint}.`)))
      throw DomainError.invalidState(
        'Entrypoint billengine-health sudah digunakan. Sesuaikan healthcheck manual di Coolify.',
      )
    const usedPorts = [...proxy.flags].flatMap(([key, flag]) =>
      /^entrypoints\.[^.]+\.address$/.test(key)
        ? [Number(/:(\d+)(?:\/\w+)?$/.exec(flag.value)?.[1])]
        : [],
    )
    const port = Array.from({ length: 10 }, (_, index) => 9082 + index).find(
      (value) => !usedPorts.includes(value),
    )
    if (!port)
      throw DomainError.invalidState(
        'Port listener healthcheck internal tidak tersedia. Sesuaikan manual di Coolify.',
      )
    const address = `127.0.0.1:${port}`
    const after = `wget -qO- http://127.0.0.1:${port}/ping || exit 1`
    healthcheck = { before: shellTest as string, after, address }
    edits.push({ index: ping!.index, value: `--${ping!.originalKey}=${healthEntrypoint}` })
    additions.push(`--entrypoints.${healthEntrypoint}.address=${address}`)
    proxy.document.setIn(
      ['services', proxy.serviceName, 'healthcheck', 'test'],
      Array.isArray(test) ? ['CMD-SHELL', after] : after,
    )
  }
  const changes = proxy.entrypoints.map((entrypoint) => {
    const key = `entrypoints.${entrypoint.name.toLowerCase()}.http.middlewares`
    const existing = proxy.flags.get(key)
    const before = entrypoint.middlewares
    if (before.includes('$'))
      throw DomainError.invalidState(
        'Middleware entrypoint harus eksplisit, bukan interpolasi environment.',
      )
    const names = before
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const enabled = selected.includes(entrypoint.name)
    const after = enabled
      ? names.includes(middleware)
        ? before
        : [...names, middleware].join(',')
      : names.includes(middleware)
        ? names.filter((value) => value !== middleware).join(',')
        : before
    if (before !== after) {
      const flag = `--${existing?.originalKey ?? `entrypoints.${entrypoint.name}.http.middlewares`}=${after}`
      if (existing) edits.push({ index: existing.index, value: after ? flag : null })
      else if (after) additions.push(flag)
    }
    return { entrypoint: entrypoint.name, before, after }
  })
  for (const edit of edits.sort((a, b) => b.index - a.index)) {
    if (edit.value === null) proxy.command.delete(edit.index)
    else proxy.command.set(edit.index, edit.value)
  }
  for (const flag of additions) proxy.command.add(flag)
  const changed = Boolean(healthcheck) || changes.some((change) => change.before !== change.after)
  return {
    configuration: changed ? proxy.document.toString({ lineWidth: 0 }) : configuration,
    changed,
    changes,
    healthcheck,
  }
}
