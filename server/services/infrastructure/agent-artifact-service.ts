import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { constants } from 'node:fs'
import { DomainError } from '../../utils/errors'

export const REMOTE_UPDATE_MINIMUM_VERSION = '0.8.0'
export const SUPPORTED_AGENT_ARCHITECTURES = ['amd64', 'arm64'] as const
export type SupportedAgentArchitecture = (typeof SUPPORTED_AGENT_ARCHITECTURES)[number]

export interface AgentArtifactMetadata {
  architecture: SupportedAgentArchitecture
  version: string
  filename: string
  path: string
  checksum: string
  size: number
}

interface AgentArtifactManifest {
  version: string
  artifacts: Partial<
    Record<SupportedAgentArchitecture, { filename: string; sha256: string; size: number }>
  >
}

export function configuredAgentReleaseVersion() {
  const version = String(useRuntimeConfig().agentReleaseVersion || '').trim()
  if (!isSemanticVersion(version)) {
    throw new Error('NUXT_AGENT_RELEASE_VERSION harus berupa semantic version, misalnya 0.8.0.')
  }
  return version
}

export function isSupportedAgentArchitecture(
  architecture: string | null,
): architecture is SupportedAgentArchitecture {
  return SUPPORTED_AGENT_ARCHITECTURES.includes(architecture as SupportedAgentArchitecture)
}

export async function readAgentArtifact(
  architecture: SupportedAgentArchitecture,
): Promise<{ metadata: AgentArtifactMetadata; binary: Buffer }> {
  const version = configuredAgentReleaseVersion()
  const directory = artifactDirectory()
  const manifest = await readManifest(directory)
  if (manifest.version !== version) {
    throw DomainError.external(
      `Manifest agent berisi versi ${manifest.version}, tetapi control plane menawarkan ${version}. Build ulang artifact agent.`,
    )
  }
  const artifact = manifest.artifacts[architecture]
  const expectedFilename = `oc-agent-linux-${architecture}`
  if (!artifact || artifact.filename !== expectedFilename) {
    throw DomainError.external(`Artifact ${expectedFilename} tidak tercatat pada manifest agent.`)
  }
  const path = resolve(directory, expectedFilename)

  let binary: Buffer
  try {
    binary = await readFile(path)
  } catch (error) {
    if (isMissingFile(error)) {
      throw DomainError.external(
        `Binary ${expectedFilename} belum tersedia. Jalankan npm run agent:build:linux:all pada control plane.`,
      )
    }
    throw error
  }

  const checksum = createHash('sha256').update(binary).digest('hex')
  if (binary.byteLength !== artifact.size || checksum !== artifact.sha256) {
    throw DomainError.external(
      `Artifact ${expectedFilename} tidak cocok dengan manifest. Build ulang artifact agent.`,
    )
  }

  return {
    binary,
    metadata: {
      architecture,
      version,
      filename: expectedFilename,
      path,
      checksum,
      size: binary.byteLength,
    },
  }
}

export async function isAgentArtifactReady(architecture: string | null) {
  if (!isSupportedAgentArchitecture(architecture)) return false
  try {
    const directory = artifactDirectory()
    const manifest = await readManifest(directory)
    const artifact = manifest.artifacts[architecture]
    if (
      manifest.version !== configuredAgentReleaseVersion() ||
      artifact?.filename !== `oc-agent-linux-${architecture}`
    ) {
      return false
    }
    await access(resolve(directory, artifact.filename), constants.R_OK)
    return artifact.size > 0 && /^[a-f0-9]{64}$/.test(artifact.sha256)
  } catch {
    return false
  }
}

export function compareSemanticVersions(left: string | null, right: string | null) {
  const leftParts = parseSemanticVersion(left)
  const rightParts = parseSemanticVersion(right)
  if (!leftParts || !rightParts) return null
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  return 0
}

export function supportsRemoteAgentUpdate(version: string | null) {
  const comparison = compareSemanticVersions(version, REMOTE_UPDATE_MINIMUM_VERSION)
  return comparison !== null && comparison >= 0
}

function artifactDirectory() {
  const config = useRuntimeConfig()
  return resolve(process.cwd(), config.agentArtifactDirectory || 'dist')
}

async function readManifest(directory: string): Promise<AgentArtifactManifest> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(resolve(directory, 'oc-agent-manifest.json'), 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) {
      throw DomainError.external(
        'Manifest artifact agent belum tersedia. Jalankan npm run agent:build:linux:all.',
      )
    }
    throw error
  }
  if (!isManifest(value)) throw DomainError.external('Manifest artifact agent tidak valid.')
  return value
}

function isManifest(value: unknown): value is AgentArtifactManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    !isSemanticVersion(value.version) ||
    !('artifacts' in value) ||
    typeof value.artifacts !== 'object' ||
    value.artifacts === null
  ) {
    return false
  }
  return Object.entries(value.artifacts).every(
    ([architecture, artifact]) =>
      SUPPORTED_AGENT_ARCHITECTURES.includes(architecture as SupportedAgentArchitecture) &&
      typeof artifact === 'object' &&
      artifact !== null &&
      'filename' in artifact &&
      artifact.filename === `oc-agent-linux-${architecture}` &&
      'sha256' in artifact &&
      typeof artifact.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(artifact.sha256) &&
      'size' in artifact &&
      typeof artifact.size === 'number' &&
      Number.isSafeInteger(artifact.size) &&
      artifact.size > 0,
  )
}

function isSemanticVersion(version: string) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
}

function parseSemanticVersion(version: string | null) {
  if (!version || !isSemanticVersion(version)) return null
  const [major, minor, patch] = version.split('-', 1)[0]!.split('.').map(Number)
  return [major!, minor!, patch!] as const
}

function isMissingFile(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
