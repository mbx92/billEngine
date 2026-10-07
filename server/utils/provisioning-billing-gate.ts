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

const GATE_ASSIGNMENT = `${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${BILLING_GATE_TRAEFIK_MIDDLEWARE}`

/**
 * Attaches `coolify.traefik.middlewares=billing-gate@file` to a Compose service.
 * Coolify merges that reserved label onto the generated HTTPS router.
 */
export function injectComposeBillingGateLabel(compose: string, serviceName: string) {
  const name = singleLineValue(serviceName, 'Nama service compose')
  const lines = compose.split('\n')
  const headerIndex = findComposeServiceHeader(lines, name)
  if (headerIndex === -1) {
    throw new Error(`Service compose "${name}" tidak ditemukan.`)
  }

  const serviceIndent = leadingWhitespace(lines[headerIndex]!)
  const blockEnd = nextSiblingIndex(lines, headerIndex, serviceIndent.length)
  const childIndent = inferChildIndent(lines, headerIndex, blockEnd, serviceIndent)
  const labelsIndex = findLabelsKey(lines, headerIndex + 1, blockEnd)

  if (labelsIndex === -1) {
    lines.splice(
      headerIndex + 1,
      0,
      `${childIndent}labels:`,
      `${childIndent}  - "${GATE_ASSIGNMENT}"`,
    )
    return lines.join('\n')
  }

  const labelsIndent = leadingWhitespace(lines[labelsIndex]!)
  const labelsEnd = nextSiblingIndex(lines, labelsIndex, labelsIndent.length, blockEnd)
  const itemIndent = `${labelsIndent}  `
  const existingAssignment = findMiddlewareAssignment(lines, labelsIndex + 1, labelsEnd)

  if (existingAssignment >= 0) {
    lines[existingAssignment] = rewriteMiddlewareAssignment(lines[existingAssignment]!, itemIndent)
    return lines.join('\n')
  }

  const firstItem = lines[labelsIndex + 1]
  const listStyle = firstItem ? /^\s*- /.test(firstItem) : true
  const insertion = listStyle
    ? `${itemIndent}- "${GATE_ASSIGNMENT}"`
    : `${itemIndent}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}: ${BILLING_GATE_TRAEFIK_MIDDLEWARE}`
  lines.splice(labelsIndex + 1, 0, insertion)
  return lines.join('\n')
}

export function publicGitComposeUrl(
  repositoryUrl: string,
  branch: string,
  composeLocation: string,
) {
  const repo = repositoryUrl.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  const match = repo.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i)
  if (!match) return null
  const path = composeLocation.trim().replace(/^\/+/, '')
  if (!path) return null
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${encodeURIComponent(branch.trim() || 'main')}/${path}`
}

function singleLineValue(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized || /[\r\n]/.test(normalized)) throw new Error(`${label} tidak valid.`)
  return normalized
}

function findComposeServiceHeader(lines: string[], serviceName: string) {
  let servicesIndent: number | null = null
  const header = new RegExp(
    `^(\\s*)(?:${escapeRegExp(serviceName)}|"${escapeRegExp(serviceName)}"|'${escapeRegExp(serviceName)}'):\\s*$`,
  )

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = leadingWhitespace(line).length

    if (servicesIndent === null) {
      if (/^services:\s*$/.test(line.trim())) servicesIndent = indent
      continue
    }

    if (indent <= servicesIndent && /:\s*$/.test(line.trim()) && !line.trimStart().startsWith('-')) {
      break
    }

    if (indent > servicesIndent && header.test(line)) return index
  }

  return -1
}

function findLabelsKey(lines: string[], start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (/^\s*labels:\s*$/.test(lines[index]!)) return index
  }
  return -1
}

function findMiddlewareAssignment(lines: string[], start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    if (/coolify\.traefik\.middlewares\s*[:=]/.test(lines[index]!)) return index
  }
  return -1
}

function rewriteMiddlewareAssignment(line: string, fallbackIndent: string) {
  const listMatch = line.match(
    /^(\s*- \s*)(["']?)coolify\.traefik\.middlewares\s*=\s*(.*?)(\2)\s*$/,
  )
  if (listMatch) {
    const quote = listMatch[2] || '"'
    return `${listMatch[1]}${quote}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}=${mergeMiddlewareCsv(unquote(listMatch[3]!))}${quote}`
  }

  const mapMatch = line.match(
    /^(\s*)(?:["']?coolify\.traefik\.middlewares["']?)\s*:\s*(["']?)(.*?)(\2)\s*$/,
  )
  if (mapMatch) {
    const quote = mapMatch[2] || ''
    return `${mapMatch[1]}${COOLIFY_TRAEFIK_MIDDLEWARE_LABEL}: ${quote}${mergeMiddlewareCsv(unquote(mapMatch[3]!))}${quote}`
  }

  return `${fallbackIndent}- "${GATE_ASSIGNMENT}"`
}

function mergeMiddlewareCsv(value: string) {
  const middlewares = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item === BILLING_GATE_TRAEFIK_MIDDLEWARE || !isDockerBillingMiddleware(item))
  if (!middlewares.includes(BILLING_GATE_TRAEFIK_MIDDLEWARE)) {
    middlewares.push(BILLING_GATE_TRAEFIK_MIDDLEWARE)
  }
  return middlewares.join(',')
}

function nextSiblingIndex(lines: string[], start: number, indent: number, limit = lines.length) {
  for (let index = start + 1; index < limit; index += 1) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (leadingWhitespace(line).length <= indent) return index
  }
  return limit
}

function inferChildIndent(lines: string[], headerIndex: number, blockEnd: number, serviceIndent: string) {
  for (let index = headerIndex + 1; index < blockEnd; index += 1) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = leadingWhitespace(line)
    if (indent.length > serviceIndent.length) return indent
  }
  return `${serviceIndent}  `
}

function leadingWhitespace(line: string) {
  return line.match(/^\s*/)?.[0] ?? ''
}

function unquote(value: string) {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
