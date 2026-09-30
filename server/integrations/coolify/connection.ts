import { CoolifyClient } from './client'
import { normalizeBaseUrl } from '../../repositories/coolify-resources'
import { decryptCredential } from '../../utils/credentials'

export interface CoolifyConnection {
  baseUrl: string
  tokenEncrypted: string | null
}

export function clientForCoolifyConnection(connection: CoolifyConnection) {
  if (connection.tokenEncrypted) {
    return new CoolifyClient(connection.baseUrl, decryptCredential(connection.tokenEncrypted))
  }

  const config = useRuntimeConfig()
  if (
    config.coolifyApiUrl &&
    config.coolifyApiToken &&
    normalizeBaseUrl(String(config.coolifyApiUrl)) === normalizeBaseUrl(connection.baseUrl)
  ) {
    return new CoolifyClient(connection.baseUrl, String(config.coolifyApiToken))
  }

  throw new Error('COOLIFY_CREDENTIALS_MISSING')
}
