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

export function buildProvisioningBillingGateLabels(
  input: ProvisioningBillingGateLabelsInput,
) {
  const namespace = normalizeNamespace(input.namespace)
  const sharedKey = singleLineValue(input.sharedKey, 'shared key billing gate')
  const forwardAuthAddress = singleLineValue(
    input.forwardAuthAddress,
    'alamat internal billing gate',
  )
  const gateMiddleware = `${namespace}-billing-gate@docker`
  const keyMiddleware = `${namespace}-billing-key`
  const forwardMiddleware = `${namespace}-billing-forward`
  const clearMiddleware = `${namespace}-billing-key-clear`

  const lines = removeBillingGateTraefikLabel(input.existingLabels ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
  const middlewareIndex = lines.findIndex((line) => coolifyMiddlewarePattern.test(line))

  if (middlewareIndex === -1) {
    lines.push(`${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${gateMiddleware}`)
  } else {
    const match = lines[middlewareIndex]!.match(coolifyMiddlewarePattern)!
    const middlewares = match[2]!
      .split(',')
      .map((middleware) => middleware.trim())
      .filter(Boolean)
    if (!middlewares.includes(gateMiddleware)) middlewares.push(gateMiddleware)
    lines[middlewareIndex] = `${match[1]}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${middlewares.join(',')}`
  }

  lines.push(
    `traefik.http.middlewares.${keyMiddleware}.headers.customrequestheaders.X-Billing-Gate-Key=${sharedKey}`,
    `traefik.http.middlewares.${forwardMiddleware}.forwardauth.address=${forwardAuthAddress}`,
    `traefik.http.middlewares.${forwardMiddleware}.forwardauth.trustForwardHeader=true`,
    `traefik.http.middlewares.${forwardMiddleware}.forwardauth.preserveLocationHeader=true`,
    `traefik.http.middlewares.${forwardMiddleware}.forwardauth.addAuthCookiesToResponse=billing_notice_ack`,
    `traefik.http.middlewares.${clearMiddleware}.headers.customrequestheaders.X-Billing-Gate-Key=`,
    `traefik.http.middlewares.${namespace}-billing-gate.chain.middlewares=${keyMiddleware},${forwardMiddleware},${clearMiddleware}`,
  )

  return lines.join('\n')
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
