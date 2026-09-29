import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptCredential, encryptCredential } from '../../server/utils/credentials'

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
})
