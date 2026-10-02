export const BILLING_GATE_TRAEFIK_MIDDLEWARE = 'billing-gate@file'
export const COOLIFY_TRAEFIK_MIDDLEWARE_LABEL = 'coolify.traefik.middlewares'

const middlewareLabelPattern = /^([\t ]*)coolify\.traefik\.middlewares[\t ]*=(.*)$/

export function addBillingGateTraefikLabel(labels: string) {
  const normalized = labels.trim()
  if (!normalized) {
    return `${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${BILLING_GATE_TRAEFIK_MIDDLEWARE}`
  }

  const lines = normalized.split(/\r?\n/)
  const labelIndex = lines.findIndex((line) => middlewareLabelPattern.test(line))
  if (labelIndex === -1) {
    return `${normalized}\n${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${BILLING_GATE_TRAEFIK_MIDDLEWARE}`
  }

  const match = lines[labelIndex]!.match(middlewareLabelPattern)!
  const middlewares = match[2]!
    .split(',')
    .map((middleware) => middleware.trim())
    .filter(Boolean)

  if (!middlewares.includes(BILLING_GATE_TRAEFIK_MIDDLEWARE)) {
    middlewares.push(BILLING_GATE_TRAEFIK_MIDDLEWARE)
  }
  lines[labelIndex] = `${match[1]}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${middlewares.join(',')}`
  return lines.join('\n')
}

export function removeBillingGateTraefikLabel(labels: string) {
  const normalized = labels.trim()
  if (!normalized) return ''

  return normalized
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(middlewareLabelPattern)
      if (!match) return [line]

      const middlewares = match[2]!
        .split(',')
        .map((middleware) => middleware.trim())
        .filter(
          (middleware) =>
            Boolean(middleware) && middleware !== BILLING_GATE_TRAEFIK_MIDDLEWARE,
        )
      return middlewares.length
        ? [`${match[1]}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${middlewares.join(',')}`]
        : []
    })
    .join('\n')
    .trim()
}
