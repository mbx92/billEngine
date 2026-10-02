import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decryptCredential,
  decryptInfrastructureCredential,
  encryptCredential,
  encryptInfrastructureCredential,
} from '../../server/utils/credentials'

describe('stored Coolify credentials', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('encrypts and decrypts API tokens without storing plaintext', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      coolifyCredentialsKey: 'a-dedicated-test-key-that-is-long-enough',
    }))

    const encrypted = encryptCredential('coolify-api-token')

    expect(encrypted).not.toContain('coolify-api-token')
    expect(decryptCredential(encrypted)).toBe('coolify-api-token')
  })

  it('uses the dedicated infrastructure key when configured', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      infraCredentialsKey: 'infrastructure-key',
      coolifyCredentialsKey: 'coolify-key',
    }))

    const encrypted = encryptInfrastructureCredential('database-password')
    expect(encrypted).not.toContain('database-password')
    expect(decryptInfrastructureCredential(encrypted)).toBe('database-password')
  })

  it('can decrypt fallback-key credentials after a dedicated key is introduced', () => {
    let dedicatedKey = ''
    vi.stubGlobal('useRuntimeConfig', () => ({
      infraCredentialsKey: dedicatedKey,
      coolifyCredentialsKey: 'legacy-key',
    }))

    const encrypted = encryptInfrastructureCredential('legacy-database-password')
    dedicatedKey = 'new-dedicated-key'
    expect(decryptInfrastructureCredential(encrypted)).toBe('legacy-database-password')
  })
})
