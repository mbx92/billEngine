import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const agentRoot = resolve(repositoryRoot, 'agent')
const outputDirectory = resolve(repositoryRoot, 'dist')
const requestedArchitecture = process.argv.includes('--all')
  ? 'all'
  : process.env.OC_AGENT_ARCH || 'amd64'
const architectures = requestedArchitecture === 'all' ? ['amd64', 'arm64'] : [requestedArchitecture]

if (architectures.some((architecture) => !['amd64', 'arm64'].includes(architecture))) {
  throw new Error('OC_AGENT_ARCH must be amd64 or arm64, or use --all.')
}

mkdirSync(outputDirectory, { recursive: true })
for (const architecture of architectures) {
  const result = spawnSync(
    'go',
    [
      'build',
      '-trimpath',
      '-o',
      resolve(outputDirectory, `oc-agent-linux-${architecture}`),
      './cmd/oc-agent',
    ],
    {
      cwd: agentRoot,
      env: { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: architecture },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
