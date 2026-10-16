import { describe, expect, it } from 'vitest'
import {
  compareSemanticVersions,
  supportsRemoteAgentUpdate,
} from '../../server/services/infrastructure/agent-artifact-service'

describe('agent artifact version policy', () => {
  it('orders semantic agent versions numerically', () => {
    expect(compareSemanticVersions('0.8.0', '0.8.0')).toBe(0)
    expect(compareSemanticVersions('0.7.9', '0.8.0')).toBe(-1)
    expect(compareSemanticVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareSemanticVersions('invalid', '0.8.0')).toBeNull()
  })

  it('requires the updater bootstrap version', () => {
    expect(supportsRemoteAgentUpdate('0.7.2')).toBe(false)
    expect(supportsRemoteAgentUpdate('0.8.0')).toBe(true)
    expect(supportsRemoteAgentUpdate('1.0.0')).toBe(true)
  })
})
