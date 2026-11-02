import { getQuery, setResponseHeader } from 'h3'
import { BillingAccessControlService } from '../../services/billing/access-control-service'
import { billingAccessFingerprint, verifyBillingGateToken } from '../../services/billing/gate-token'
import { billingGateRuntime } from '../../utils/billing-gate'
import { DomainError } from '../../utils/errors'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const runtime = billingGateRuntime()
  const rawToken = getQuery(event).token
  const token = verifyBillingGateToken(
    typeof rawToken === 'string' ? rawToken : null,
    runtime.secret,
  )
  if (token?.kind !== 'notice') throw DomainError.notFound('Pemberitahuan tidak ditemukan.')

  const decision = await new BillingAccessControlService().evaluate(token.host, runtime.secret)
  if (decision.state === 'normal') {
    return {
      data: {
        state: 'normal' as const,
        returnUrl: `${token.scheme}://${token.host}${token.returnTo}`,
      },
    }
  }

  if (billingAccessFingerprint(decision, runtime.secret) !== token.invoiceFingerprint) {
    throw DomainError.notFound(
      'Status layanan berubah. Buka kembali layanan untuk pemberitahuan terbaru.',
    )
  }

  const continueUrl = `${token.scheme}://${token.host}/.billing/continue?token=${encodeURIComponent(
    typeof rawToken === 'string' ? rawToken : '',
  )}`

  return {
    data: {
      state: decision.state,
      serviceName: decision.service?.name ?? null,
      serviceNumber: decision.service?.serviceNumber ?? null,
      invoiceNumber: decision.invoice?.invoiceNumber ?? null,
      dueDate: decision.invoice?.dueDate ?? null,
      daysPastDue: decision.daysPastDue,
      graceEndsAt: decision.graceEndsAt,
      continueUrl: decision.state === 'grace' ? continueUrl : null,
      portalUrl: `/login?redirect=${encodeURIComponent(decision.invoice ? `/portal/invoices/${decision.invoice.id}` : '/portal/services')}`,
    },
  }
})
