import {
  COOLIFY_TRAEFIK_MIDDLEWARE_LABEL,
  removeBillingGateTraefikLabel,
} from '../../shared/utils/provisioning-labels'

interface ProvisioningBillingGateLabelsInput {
  existingLabels?: string | null
  namespace: string
  sharedKey: string
  forwardAuthAddress: string
}

const coolifyMiddlewarePattern = /^([\t ]*)coolify\.traefik\.middlewares[\t ]*=(.*)$/

/**
 * Builds Traefik labels for a Coolify application.
 *
 * Uses a single forwardAuth middleware (no chain). Coolify's Docker Compose
 * label merger attaches every `traefik.http.middlewares.<name>.*` definition to
 * the generated router; a multi-middleware chain therefore breaks routing with
 * HTTP 500. The shared key is passed as `gate_key` on the forwardAuth URL.
 */
export function buildProvisioningBillingGateLabels(input: ProvisioningBillingGateLabelsInput) {
  const namespace = normalizeNamespace(input.namespace)
  const sharedKey = singleLineValue(input.sharedKey, 'shared key billing gate')
  const forwardAuthAddress = withGateKeyQuery(
    singleLineValue(input.forwardAuthAddress, 'alamat internal billing gate'),
    sharedKey,
  )
  const gateMiddleware = `${namespace}-billing`
  const gateMiddlewareRef = `${gateMiddleware}@docker`

  const lines = removeBillingGateTraefikLabel(input.existingLabels ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !/billing-(gate|key|forward|key-clear)|-billing(\.|@|$)/.test(line))

  const middlewareIndex = lines.findIndex((line) => coolifyMiddlewarePattern.test(line))
  if (middlewareIndex === -1) {
    lines.push(`${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${gateMiddlewareRef}`)
  } else {
    const match = lines[middlewareIndex]!.match(coolifyMiddlewarePattern)!
    const middlewares = match[2]!
      .split(',')
      .map((middleware) => middleware.trim())
      .filter(Boolean)
      .filter((middleware) => !middleware.includes('billing-gate'))
    if (!middlewares.includes(gateMiddlewareRef)) middlewares.push(gateMiddlewareRef)
    lines[middlewareIndex] = `${match[1]}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${middlewares.join(',')}`
  }

  lines.push(
    `traefik.http.middlewares.${gateMiddleware}.forwardauth.address=${forwardAuthAddress}`,
    `traefik.http.middlewares.${gateMiddleware}.forwardauth.trustForwardHeader=true`,
    `traefik.http.middlewares.${gateMiddleware}.forwardauth.preserveLocationHeader=true`,
    `traefik.http.middlewares.${gateMiddleware}.forwardauth.addAuthCookiesToResponse=billing_notice_ack`,
  )

  return lines.join('\n')
}

export function withGateKeyQuery(forwardAuthAddress: string, sharedKey: string) {
  const url = new URL(forwardAuthAddress)
  url.searchParams.set('gate_key', sharedKey)
  return url.toString()
}

function normalizeNamespace(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalized) throw new Error('Namespace billing gate tidak valid.')
  return normalized.slice(0, 63)
}

function singleLineValue(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized || /[\r\n]/.test(normalized)) throw new Error(`${label} tidak valid.`)
  return normalized
}
