import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decryptInfrastructureCredential,
  encryptInfrastructureCredential,
} from '../../server/utils/credentials'

describe('stored infrastructure credentials', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the dedicated infrastructure key when configured', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      infraCredentialsKey: 'infrastructure-key',
      betterAuthSecret: 'application-fallback-key',
    }))

    const encrypted = encryptInfrastructureCredential('database-password')
    expect(encrypted).not.toContain('database-password')
    expect(decryptInfrastructureCredential(encrypted)).toBe('database-password')
  })

  it('can decrypt fallback-key credentials after a dedicated key is introduced', () => {
    let dedicatedKey = ''
    vi.stubGlobal('useRuntimeConfig', () => ({
      infraCredentialsKey: dedicatedKey,
      betterAuthSecret: 'application-fallback-key',
    }))

    const encrypted = encryptInfrastructureCredential('legacy-database-password')
    dedicatedKey = 'new-dedicated-key'
    expect(decryptInfrastructureCredential(encrypted)).toBe('legacy-database-password')
  })
})
