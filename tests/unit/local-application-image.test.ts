import { describe, expect, it } from 'vitest'
import { applicationSpecSchema } from '../../shared/schemas/infrastructure'
import { createDeployableApplicationSchema } from '../../shared/schemas/releases'
import {
  releaseImageSource,
  validateLocalImageNode,
} from '../../server/services/infrastructure/local-image'

const nodeId = '00000000-0000-4000-8000-000000000001'
const otherNodeId = '00000000-0000-4000-8000-000000000002'
const imageId = `sha256:${'a'.repeat(64)}`
const application = {
  name: 'Serene Book',
  slug: 'serene-book',
  repositoryUrl: 'https://github.com/mbx92/serene-book',
}

describe('local application images', () => {
  it('defaults new applications to local storage without requiring registry credentials', () => {
    const input = createDeployableApplicationSchema.parse({ ...application, buildNodeId: nodeId })
    expect(input.imageStorage).toBe('local')
    expect(input.registryId).toBeUndefined()
    expect(input.imageRepository).toBeUndefined()
  })

  it('requires an origin server for local applications and credentials for registry applications', () => {
    expect(createDeployableApplicationSchema.safeParse(application).success).toBe(false)
    expect(
      createDeployableApplicationSchema.safeParse({ ...application, imageStorage: 'registry' })
        .success,
    ).toBe(false)
    expect(
      createDeployableApplicationSchema.safeParse({
        ...application,
        imageStorage: 'registry',
        registryId: nodeId,
        imageRepository: 'registry.example.test/serene-book',
      }).success,
    ).toBe(true)
  })

  it('preserves local placement and pull policy through template spec parsing', () => {
    const source = releaseImageSource({ imageReference: imageId, localNodeId: nodeId })
    const spec = applicationSpecSchema.parse({
      source,
      limits: { cpuMilli: 500, memoryBytes: '536870912' },
    })
    expect(spec.source).toEqual({ type: 'image', reference: imageId, nodeId, pullPolicy: 'never' })
    expect(() => validateLocalImageNode(spec.source, nodeId, ['local-image-build'])).not.toThrow()
    expect(() => validateLocalImageNode(spec.source, otherNodeId, ['local-image-build'])).toThrow(
      'server tempat image dibangun',
    )
    expect(() => validateLocalImageNode(spec.source, nodeId, ['image-build'])).toThrow('0.12.0')
  })

  it('rejects mutable local tags and missing origin metadata', () => {
    for (const source of [
      { type: 'image', reference: 'oc-local/serene-book:latest', pullPolicy: 'never', nodeId },
      { type: 'image', reference: imageId, pullPolicy: 'never' },
      { type: 'image', reference: imageId, nodeId },
    ]) {
      expect(
        applicationSpecSchema.safeParse({
          source,
          limits: { cpuMilli: 500, memoryBytes: '536870912' },
        }).success,
      ).toBe(false)
    }
  })

  it('keeps registry deployment sources compatible with existing agents', () => {
    const source = releaseImageSource({
      imageReference: `registry.example.test/serene-book@${imageId}`,
      localNodeId: null,
    })
    expect(source).toEqual({
      type: 'image',
      reference: `registry.example.test/serene-book@${imageId}`,
    })
    expect(() => validateLocalImageNode(source, otherNodeId, [])).not.toThrow()
  })

  it('preserves registry mode for existing API clients that omit imageStorage', () => {
    const input = createDeployableApplicationSchema.parse({
      ...application,
      registryId: nodeId,
      imageRepository: 'registry.example.test/serene-book',
    })
    expect(input.imageStorage).toBe('registry')
  })
})
