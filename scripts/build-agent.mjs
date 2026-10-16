import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const agentRoot = resolve(repositoryRoot, 'agent')
const outputDirectory = resolve(repositoryRoot, 'dist')
const agentVersion = readFileSync(resolve(agentRoot, 'internal/version/VERSION'), 'utf8').trim()
const requestedArchitecture = process.argv.includes('--all')
  ? 'all'
  : process.env.OC_AGENT_ARCH || 'amd64'
const architectures = requestedArchitecture === 'all' ? ['amd64', 'arm64'] : [requestedArchitecture]

if (architectures.some((architecture) => !['amd64', 'arm64'].includes(architecture))) {
  throw new Error('OC_AGENT_ARCH must be amd64 or arm64, or use --all.')
}

mkdirSync(outputDirectory, { recursive: true })
const manifestPath = resolve(outputDirectory, 'oc-agent-manifest.json')
/** @type {{version: string, artifacts: Record<string, {filename: string, sha256: string, size: number}>}} */
let manifest = { version: agentVersion, artifacts: {} }
try {
  const existing = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (existing.version === agentVersion && existing.artifacts) manifest = existing
} catch {
  // A missing or stale manifest is replaced after the requested builds complete.
}
for (const architecture of architectures) {
  const outputPath = resolve(outputDirectory, `oc-agent-linux-${architecture}`)
  const result = spawnSync('go', ['build', '-trimpath', '-o', outputPath, './cmd/oc-agent'], {
    cwd: agentRoot,
    env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: architecture },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
  const binary = readFileSync(outputPath)
  manifest.artifacts[architecture] = {
    filename: `oc-agent-linux-${architecture}`,
    sha256: createHash('sha256').update(binary).digest('hex'),
    size: binary.byteLength,
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
