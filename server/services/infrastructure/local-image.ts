import type { ApplicationSpec } from '../../../shared/schemas/infrastructure'
import { DomainError } from '../../utils/errors'

export function releaseImageSource(release: {
  imageReference: string
  localNodeId: string | null
}): ApplicationSpec['source'] {
  return {
    type: 'image',
    reference: release.imageReference,
    ...(release.localNodeId ? { pullPolicy: 'never' as const, nodeId: release.localNodeId } : {}),
  }
}

export function validateLocalImageNode(
  source: ApplicationSpec['source'],
  nodeId: string,
  capabilities?: string[],
) {
  if (source.type !== 'image' || source.pullPolicy !== 'never') return
  if (source.nodeId !== nodeId) {
    throw DomainError.validation(
      'Image lokal hanya dapat dideploy pada server tempat image dibangun.',
    )
  }
  if (capabilities && !capabilities.includes('local-image-build')) {
    throw DomainError.invalidState(
      'Perbarui agent server ke versi yang mendukung local-image-build (0.12.0+).',
    )
  }
}

export function validateSecretDelivery(spec: ApplicationSpec, capabilities: string[]) {
  if (spec.secretDelivery === 'environment' && !capabilities.includes('secret-environment')) {
    throw DomainError.invalidState(
      'Pengiriman secret sebagai environment variable memerlukan agent 0.12.0+.',
    )
  }
}
