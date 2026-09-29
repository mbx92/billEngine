import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ENCRYPTION_VERSION = 'v1'

export function encryptCredential(plaintext: string) {
  const key = credentialKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export function decryptCredential(payload: string) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] = payload.split(':')
  if (version !== ENCRYPTION_VERSION || !encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new Error('Stored credential has an unsupported format.')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    credentialKey(),
    Buffer.from(encodedIv, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(encodedAuthTag, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function credentialKey() {
  const config = useRuntimeConfig()
  const secret = config.coolifyCredentialsKey || config.betterAuthSecret

  if (!secret) {
    throw new Error('COOLIFY_CREDENTIALS_KEY or BETTER_AUTH_SECRET must be configured.')
  }

  return createHash('sha256').update(String(secret)).digest()
}
