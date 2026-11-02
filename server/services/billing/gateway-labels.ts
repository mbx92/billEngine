import { createHash } from 'node:crypto'
import { DomainError } from '../../utils/errors'

const gate = 'billing-gate@file'

/** Accept Coolify's encoded API value and its plain-text variant. Never guess missing labels. */
export function decodeLabels(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw DomainError.invalidState(
      'Label belum tersedia. Deploy aplikasi sekali di Coolify, lalu muat ulang.',
    )
  }
  const trimmed = value.trim()
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0) {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8')
    if (decoded.includes('=')) return decoded
  }
  return value
}

export function planGatewayLabels(value: unknown, allowedHosts?: string[]) {
  const labels = decodeLabels(value)
  const newline = labels.includes('\r\n') ? '\r\n' : '\n'
  const lines = labels.split(/\r?\n/)
  const entries = new Map<string, { value: string; index: number }>()
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = /^\s*([^=\s]+)=(.*)$/.exec(line)
    if (!match)
      throw DomainError.invalidState(
        'Format label tidak didukung. Periksa Container labels di Coolify.',
      )
    if (entries.has(match[1]!))
      throw DomainError.invalidState(
        'Label duplikat ditemukan. Rapikan label di Coolify terlebih dahulu.',
      )
    entries.set(match[1]!, { value: match[2]!, index })
  }
  const routers = [...entries.keys()].flatMap((key) => {
    const match = /^traefik\.http\.routers\.(.+)\.rule$/.exec(key)
    return match ? [match[1]!] : []
  })
  if (!routers.length)
    throw DomainError.invalidState(
      'Router Traefik tidak ditemukan. Caddy dan konfigurasi tanpa router harus diatur manual.',
    )
  const changes = routers.map((router) => {
    if (allowedHosts) {
      const rule = entries.get(`traefik.http.routers.${router}.rule`)!.value
      const hosts = [...rule.matchAll(/Host\(([^)]+)\)/g)].flatMap((match) =>
        [...match[1]!.matchAll(/[`"]([^`"]+)[`"]/g)].map((host) => host[1]!.toLowerCase()),
      )
      if (
        !hosts.length ||
        rule.includes('HostRegexp') ||
        hosts.some((host) => !allowedHosts.includes(host))
      ) {
        throw DomainError.invalidState(
          'Router memiliki domain di luar domain aplikasi atau aturan khusus. Konfigurasikan gate manual di Coolify.',
        )
      }
    }
    const key = `traefik.http.routers.${router}.middlewares`
    const entry = entries.get(key)
    const before = entry?.value ?? ''
    const names = before
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    const after = names.includes(gate) ? before : [...names, gate].join(',')
    if (before !== after) {
      if (entry) lines[entry.index] = `${key}=${after}`
      else lines.push(`${key}=${after}`)
    }
    return { router, before, after }
  })
  return {
    labels: lines.join(newline),
    changes,
    configured: changes.every((change) => change.before === change.after),
  }
}

export function gatewayRevision(application: Record<string, unknown>) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        labels: application.custom_labels,
        settings: application.settings,
        fqdn: application.fqdn,
        domains: application.domains,
        buildPack: application.build_pack,
        composeDomains: application.docker_compose_domains,
      }),
    )
    .digest('hex')
}
