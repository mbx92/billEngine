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

const imageRepositorySchema = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .trim()
          .replace(/^https?:\/\//i, '')
          .replace(/\/+$/, '')
          .toLowerCase()
      : value,
  z
    .string()
    .min(3)
    .max(500)
    .regex(
      /^[a-z0-9][a-z0-9._:/-]*$/,
      'Gunakan format registry/owner/image, contoh ghcr.io/mbx92/my-app.',
    ),
)

const relativeBuildPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').some((segment) => segment === '..'),
    'Path build harus relatif dan tidak boleh keluar dari repository.',
  )

export const createContainerRegistrySchema = z.object({
  name: z.string().trim().min(1).max(160),
  host: registryHostSchema,
  username: z.string().trim().min(1).max(255),
  token: z.string().trim().min(1).max(4096),
})

export const updateContainerRegistrySchema = z.object({
  name: z.string().trim().min(1).max(160),
  username: z.string().trim().min(1).max(255),
  token: z.string().trim().min(1).max(4096),
})

export const createDeployableApplicationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: slugSchema,
  repositoryUrl: z.string().trim().url().max(2048),
  defaultBranch: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Nama branch tidak valid.')
    .refine((value) => !value.includes('..') && !value.includes('//'), 'Nama branch tidak valid.')
    .default('main'),
  dockerfilePath: relativeBuildPathSchema.default('Dockerfile'),
  buildContext: relativeBuildPathSchema.default('.'),
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

export const queueApplicationBuildSchema = z.object({
  version: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Versi build tidak valid.')
    .optional(),
})

export type CreateContainerRegistryInput = z.infer<typeof createContainerRegistrySchema>
export type UpdateContainerRegistryInput = z.infer<typeof updateContainerRegistrySchema>
export type CreateDeployableApplicationInput = z.infer<typeof createDeployableApplicationSchema>
export type CreateApplicationReleaseInput = z.infer<typeof createApplicationReleaseSchema>
export type ReleaseCallbackInput = z.infer<typeof releaseCallbackSchema>
export type RolloutApplicationReleaseInput = z.infer<typeof rolloutApplicationReleaseSchema>
export type QueueApplicationBuildInput = z.infer<typeof queueApplicationBuildSchema>
