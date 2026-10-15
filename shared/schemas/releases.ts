import { z } from 'zod'

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Slug hanya boleh berisi lowercase, angka, dan tanda hubung.')

const registryHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/, 'Host registry tidak valid.')

const imageRepositorySchema = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/, 'Image repository tidak valid.')

export const createContainerRegistrySchema = z.object({
  name: z.string().trim().min(1).max(160),
  host: registryHostSchema,
  username: z.string().trim().min(1).max(255),
  token: z.string().trim().min(1).max(4096),
})

export const createDeployableApplicationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: slugSchema,
  repositoryUrl: z.string().trim().url().max(2048),
  defaultBranch: z.string().trim().min(1).max(255).default('main'),
  dockerfilePath: z.string().trim().min(1).max(1024).default('Dockerfile'),
  buildContext: z.string().trim().min(1).max(1024).default('.'),
  imageRepository: imageRepositorySchema,
  registryId: z.string().uuid(),
  autoDeploy: z.boolean().default(false),
})

export const createApplicationReleaseSchema = z.object({
  version: z.string().trim().min(1).max(160),
  commitSha: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-f0-9]{7,64}$/),
  imageDigest: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^sha256:[a-f0-9]{64}$/),
})

export const releaseCallbackSchema = createApplicationReleaseSchema.extend({
  applicationSlug: slugSchema,
})

export const rolloutApplicationReleaseSchema = z.object({
  resourceIds: z.array(z.string().uuid()).min(1).max(100),
  trackLatest: z.boolean().default(false),
})

export type CreateContainerRegistryInput = z.infer<typeof createContainerRegistrySchema>
export type CreateDeployableApplicationInput = z.infer<typeof createDeployableApplicationSchema>
export type CreateApplicationReleaseInput = z.infer<typeof createApplicationReleaseSchema>
export type ReleaseCallbackInput = z.infer<typeof releaseCallbackSchema>
export type RolloutApplicationReleaseInput = z.infer<typeof rolloutApplicationReleaseSchema>
