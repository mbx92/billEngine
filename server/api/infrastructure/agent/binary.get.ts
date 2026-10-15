import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { DomainError } from '../../../utils/errors'

const querySchema = z.object({
  arch: z.enum(['amd64', 'arm64']),
  checksum: z.enum(['0', '1']).default('0'),
})

export default defineEventHandler(async (event) => {
  const query = querySchema.parse(getQuery(event))
  const config = useRuntimeConfig(event)
  const artifactDirectory = resolve(process.cwd(), config.agentArtifactDirectory || 'dist')
  const filename = `oc-agent-linux-${query.arch}`
  const artifactPath = resolve(artifactDirectory, filename)

  let binary: Buffer
  try {
    binary = await readFile(artifactPath)
  } catch (error) {
    if (isMissingFile(error)) {
      throw DomainError.external(
        `Binary ${filename} belum tersedia. Jalankan agent:build:linux pada control plane.`,
      )
    }
    throw error
  }

  setResponseHeader(event, 'cache-control', 'public, max-age=300')
  if (query.checksum === '1') {
    const checksum = createHash('sha256').update(binary).digest('hex')
    setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
    return `${checksum}  ${filename}\n`
  }

  setResponseHeaders(event, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-length': binary.byteLength,
  })
  return send(event, binary)
})

function isMissingFile(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
