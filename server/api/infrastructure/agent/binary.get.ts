import { z } from 'zod'
import { readAgentArtifact } from '../../../services/infrastructure/agent-artifact-service'

const querySchema = z.object({
  arch: z.enum(['amd64', 'arm64']),
  checksum: z.enum(['0', '1']).default('0'),
})

export default defineEventHandler(async (event) => {
  const query = querySchema.parse(getQuery(event))
  const { binary, metadata } = await readAgentArtifact(query.arch)

  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'x-oc-agent-version', metadata.version)
  setResponseHeader(event, 'x-oc-agent-sha256', metadata.checksum)
  if (query.checksum === '1') {
    setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
    return `${metadata.checksum}  ${metadata.filename}\n`
  }

  setResponseHeaders(event, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${metadata.filename}"`,
    'content-length': binary.byteLength,
  })
  return send(event, binary)
})
