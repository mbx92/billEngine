import type { InfrastructureNodeNetwork } from '../../database/schema'
import { DomainError } from '../../utils/errors'

export function validateDeploymentNetwork(
  networkName: string,
  capabilities: string[],
  inventory: InfrastructureNodeNetwork[],
) {
  if (networkName === 'oc-private') return
  if (['bridge', 'host', 'none'].includes(networkName)) {
    throw DomainError.validation(
      'Gunakan Docker network bridge buatan sendiri; network bawaan bridge, host, dan none tidak didukung.',
    )
  }
  if (!capabilities.includes('network-inventory')) {
    throw DomainError.invalidState(
      'Pemilihan Docker network membutuhkan OC Agent 0.12.9 atau lebih baru.',
    )
  }
  const network = inventory.find((candidate) => candidate.name === networkName)
  if (!network) {
    throw DomainError.validation('Docker network tidak ditemukan pada node yang dipilih.')
  }
  if (network.driver !== 'bridge' || network.scope !== 'local') {
    throw DomainError.validation(
      'Deployment saat ini hanya mendukung Docker network bridge dengan scope local.',
    )
  }
}
