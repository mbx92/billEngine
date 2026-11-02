import { createHmac, randomBytes } from 'node:crypto'
import { secureStringEqual } from '../../utils/billing-gate'
import type { ApiGateProbe } from '../../../shared/schemas/gateway'

export function gateProbeSignature(nonce: string, host: string, secret: string) {
  return createHmac('sha256', secret).update(`billing-gate-probe:${nonce}:${host}`).digest('hex')
}

export async function probeGateway(url: string, secret: string) {
  return (await inspectGateway(url, secret)).verified
}

export async function inspectGateway(url: string, secret: string): Promise<ApiGateProbe> {
  const nonce = randomBytes(32).toString('hex')
  try {
    // No credentials are sent to the application and redirects are never followed.
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'X-Billing-Gate-Probe': nonce, 'Cache-Control': 'no-cache' },
    })
    const status = response.status
    const proof = response.headers.get('x-billing-gate-proof')
    await response.body?.cancel().catch(() => {})
    const result = (reason: ApiGateProbe['reason'], message: string): ApiGateProbe => ({
      verified: reason === 'verified',
      status,
      reason,
      message,
    })
    if (status === 418 && proof) {
      return secureStringEqual(
        proof,
        gateProbeSignature(nonce, new URL(url).hostname.toLowerCase(), secret),
      )
        ? result('verified', 'Proxy mencapai gate BillEngine dan bukti tanda tangan valid.')
        : result(
            'invalid_proof',
            'Bukti gate tidak cocok. Periksa kesamaan NUXT_BILLING_GATE_SECRET pada instance BillEngine dan hostname yang diteruskan proxy.',
          )
    }
    if (status >= 300 && status < 400)
      return result(
        'redirect',
        'Domain mengembalikan redirect tanpa bukti gate. Periksa URL HTTP/HTTPS di Coolify dan middleware pada router tujuan.',
      )
    if (status === 401 || status === 403)
      return result(
        'unauthorized',
        'Permintaan ditolak tanpa bukti gate. Periksa shared key middleware serta autentikasi Cloudflare Access/proxy yang mungkin mendahului gate.',
      )
    if (status >= 500)
      return result(
        'proxy_error',
        'Server/proxy mengembalikan error. Periksa log Traefik, keberadaan billing-gate@file, dan koneksi dari container proxy ke URL internal BillEngine.',
      )
    if ((status >= 200 && status < 300) || status === 418)
      return result(
        'missing_proof',
        'Respons tanpa bukti gate. Pastikan domain atau Cloudflare Tunnel menuju Traefik, bukan langsung ke container/port aplikasi. Periksa juga file middleware, restart proxy, dan header probe yang diteruskan.',
      )
    return result(
      'unexpected_response',
      'Respons tidak membuktikan gate aktif. Periksa routing domain, file middleware, dan log proxy.',
    )
  } catch (error) {
    const caught = error as { name?: string; cause?: { code?: string }; code?: string }
    const code = caught?.cause?.code ?? caught?.code ?? ''
    if (
      caught?.name === 'TimeoutError' ||
      caught?.name === 'AbortError' ||
      code === 'UND_ERR_CONNECT_TIMEOUT'
    )
      return {
        verified: false,
        status: null,
        reason: 'timeout',
        message:
          'Koneksi ke domain melewati batas waktu 8 detik. Periksa DNS, firewall, dan akses dari BillEngine.',
      }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
      return {
        verified: false,
        status: null,
        reason: 'dns_error',
        message:
          'DNS domain gagal di-resolve dari BillEngine. Periksa record DNS dan resolver pada deployment BillEngine.',
      }
    if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))
      return {
        verified: false,
        status: null,
        reason: 'tls_error',
        message:
          'Validasi TLS domain gagal. Periksa sertifikat dan hostname; pemeriksaan tetap memvalidasi TLS.',
      }
    return {
      verified: false,
      status: null,
      reason: 'connection_error',
      message:
        'BillEngine gagal terhubung ke domain. Periksa alamat, port, firewall, dan konektivitas deployment.',
    }
  }
}
