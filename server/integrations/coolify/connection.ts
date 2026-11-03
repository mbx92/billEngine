import { CoolifyClient } from './client'
import { decryptCredential } from '../../utils/credentials'
import { DomainError } from '../../utils/errors'

export interface CoolifyConnection {
  baseUrl: string
  tokenEncrypted: string | null
}

export function clientForCoolifyConnection(connection: CoolifyConnection) {
  if (connection.tokenEncrypted) {
    return new CoolifyClient(connection.baseUrl, decryptCredential(connection.tokenEncrypted))
  }

  throw DomainError.invalidState(
    'Token koneksi Coolify belum tersimpan. Gunakan Servers → Perbarui token pada koneksi ini.',
  )
}
