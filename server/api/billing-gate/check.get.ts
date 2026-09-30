import {
  deleteCookie,
  getCookie,
  getHeader,
  getRequestProtocol,
  sendRedirect,
  setCookie,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
import { BillingAccessControlService } from '../../services/billing/access-control-service'
import { normalizeRequestHost, safeReturnPath } from '../../services/billing/access-policy'
import {
  signBillingGateToken,
  verifyBillingGateToken,
  type BillingGateToken,
} from '../../services/billing/gate-token'
import {
  BILLING_GATE_COOKIE,
  billingGateRuntime,
  secureStringEqual,
} from '../../utils/billing-gate'

const NOTICE_TOKEN_SECONDS = 30 * 60

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const runtime = billingGateRuntime()

  if (!runtime.secret || !runtime.sharedKey) {
    setResponseStatus(event, 503)
    return { error: 'Billing gate is not configured.' }
  }
  if (!secureStringEqual(getHeader(event, 'x-billing-gate-key'), runtime.sharedKey)) {
    setResponseStatus(event, 401)
    return { error: 'Invalid billing gate key.' }
  }

  const host = normalizeRequestHost(
    getHeader(event, 'x-forwarded-host') ?? getHeader(event, 'host'),
  )
  if (!host) return allow(event)

  const forwardedUri = safeReturnPath(getHeader(event, 'x-forwarded-uri'))
  const forwardedUrl = new URL(forwardedUri, 'http://billing-gate.internal')
  const scheme = forwardedScheme(event)
  const decision = await new BillingAccessControlService().evaluate(host, runtime.secret)

  if (forwardedUrl.pathname === '/.billing/continue') {
    return handleContinue(
      event,
      forwardedUrl.searchParams.get('token'),
      host,
      scheme,
      decision,
      runtime,
    )
  }

  if (decision.state === 'normal' || !decision.invoice) {
    deleteCookie(event, BILLING_GATE_COOKIE, { path: '/' })
    return allow(event)
  }

  const acknowledgement = verifyBillingGateToken(
    getCookie(event, BILLING_GATE_COOKIE),
    runtime.secret,
  )
  if (
    decision.state === 'grace' &&
    acknowledgement?.kind === 'ack' &&
    acknowledgement.host === host &&
    acknowledgement.invoiceFingerprint === decision.invoice.fingerprint
  ) {
    return allow(event)
  }

  if (decision.state === 'grace' && !isBrowserNavigation(event)) return allow(event)

  if (!isBrowserNavigation(event)) {
    setResponseStatus(event, 402)
    return {
      error: 'PAYMENT_REQUIRED',
      message: 'Layanan dibatasi karena invoice telah melewati grace period.',
    }
  }

  return redirectToNotice(event, {
    runtime,
    host,
    scheme,
    returnTo: forwardedUri,
    invoiceFingerprint: decision.invoice.fingerprint,
  })
})

function allow(event: Parameters<typeof setResponseStatus>[0]) {
  setResponseStatus(event, 204)
  return null
}

function isBrowserNavigation(event: Parameters<typeof getHeader>[0]) {
  const method = event.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return false
  return (
    getHeader(event, 'sec-fetch-dest') === 'document' ||
    getHeader(event, 'accept')?.includes('text/html') === true
  )
}

function forwardedScheme(event: Parameters<typeof getHeader>[0]): 'http' | 'https' {
  const forwarded = getHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwarded === 'http' || forwarded === 'https') return forwarded
  return getRequestProtocol(event) === 'https' ? 'https' : 'http'
}

async function handleContinue(
  event: Parameters<typeof getHeader>[0],
  rawToken: string | null,
  host: string,
  scheme: 'http' | 'https',
  decision: Awaited<ReturnType<BillingAccessControlService['evaluate']>>,
  runtime: ReturnType<typeof billingGateRuntime>,
) {
  const notice = verifyBillingGateToken(rawToken, runtime.secret)
  if (notice?.kind !== 'notice' || notice.host !== host || notice.scheme !== scheme) {
    setResponseStatus(event, 400)
    return { error: 'Invalid or expired continuation token.' }
  }

  if (decision.state === 'normal') return sendRedirect(event, notice.returnTo, 302)

  if (decision.state === 'grace' && decision.invoice?.fingerprint === notice.invoiceFingerprint) {
    const maxAge = decision.noticeIntervalHours * 60 * 60
    const acknowledgement: BillingGateToken = {
      kind: 'ack',
      scheme,
      host,
      invoiceFingerprint: notice.invoiceFingerprint,
      returnTo: '/',
      expiresAt: Math.floor(Date.now() / 1_000) + maxAge,
    }
    setCookie(event, BILLING_GATE_COOKIE, signBillingGateToken(acknowledgement, runtime.secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: scheme === 'https',
      path: '/',
      maxAge,
    })
    return sendRedirect(event, notice.returnTo, 302)
  }

  if (!decision.invoice) return sendRedirect(event, notice.returnTo, 302)
  return redirectToNotice(event, {
    runtime,
    host,
    scheme,
    returnTo: notice.returnTo,
    invoiceFingerprint: decision.invoice.fingerprint,
  })
}

function redirectToNotice(
  event: Parameters<typeof getHeader>[0],
  input: {
    runtime: ReturnType<typeof billingGateRuntime>
    host: string
    scheme: 'http' | 'https'
    returnTo: string
    invoiceFingerprint: string
  },
) {
  const payload: BillingGateToken = {
    kind: 'notice',
    scheme: input.scheme,
    host: input.host,
    invoiceFingerprint: input.invoiceFingerprint,
    returnTo: safeReturnPath(input.returnTo),
    expiresAt: Math.floor(Date.now() / 1_000) + NOTICE_TOKEN_SECONDS,
  }
  const token = signBillingGateToken(payload, input.runtime.secret)
  const appUrl = input.runtime.appUrl.replace(/\/$/, '')
  return sendRedirect(event, `${appUrl}/billing/overdue?token=${encodeURIComponent(token)}`, 302)
}
