import {
  BILLING_GATE_TRAEFIK_MIDDLEWARE,
  COOLIFY_TRAEFIK_MIDDLEWARE_LABEL,
  addBillingGateTraefikLabel,
  removeBillingGateTraefikLabel,
} from '../../shared/utils/provisioning-labels'

interface ProvisioningBillingGateLabelsInput {
  existingLabels?: string | null
  /** @deprecated Kept for call-site compatibility; file middleware is shared. */
  namespace?: string
  sharedKey: string
  forwardAuthAddress: string
}

const coolifyMiddlewarePattern = /^([\t ]*)coolify\.traefik\.middlewares[\t ]*=(.*)$/

function isDockerBillingMiddleware(middleware: string) {
  return (
    middleware === BILLING_GATE_TRAEFIK_MIDDLEWARE ||
    middleware.includes('billing-gate') ||
    middleware.includes('billing-key') ||
    middleware.includes('billing-forward') ||
    middleware.endsWith('-billing')
  )
}

/**
 * Builds Traefik labels for a Coolify application.
 *
 * Coolify's Docker Compose label merger attaches every
 * `traefik.http.middlewares.<name>.*` definition onto the generated router and
 * breaks routing with HTTP 500. Attach only the shared file-provider middleware
 * `billing-gate@file` (written by BillEngine onto the Coolify proxy host).
 */
export function buildProvisioningBillingGateLabels(input: ProvisioningBillingGateLabelsInput) {
  // Validate secrets even though labels no longer embed them — provisioning still
  // requires a working gate before enabling the middleware reference.
  singleLineValue(input.sharedKey, 'shared key billing gate')
  singleLineValue(input.forwardAuthAddress, 'alamat internal billing gate')

  const cleaned = removeBillingGateTraefikLabel(input.existingLabels ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !/^traefik\.http\.middlewares\.[^=]*billing/i.test(line.trim()))
    .map((line) => {
      const match = line.match(coolifyMiddlewarePattern)
      if (!match) return line
      const middlewares = match[2]!
        .split(',')
        .map((middleware) => middleware.trim())
        .filter(Boolean)
        .filter((middleware) => !isDockerBillingMiddleware(middleware))
      return middlewares.length
        ? `${match[1]}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${middlewares.join(',')}`
        : null
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')

  const withFileMiddleware = addBillingGateTraefikLabel(cleaned)
  if (!withFileMiddleware.includes(BILLING_GATE_TRAEFIK_MIDDLEWARE)) {
    throw new Error('Gagal memasang middleware billing-gate@file.')
  }
  return withFileMiddleware
}

export function withGateKeyQuery(forwardAuthAddress: string, sharedKey: string) {
  const url = new URL(forwardAuthAddress)
  url.searchParams.set('gate_key', sharedKey)
  return url.toString()
}

function singleLineValue(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized || /[\r\n]/.test(normalized)) throw new Error(`${label} tidak valid.`)
  return normalized
}
