import { z } from 'zod'

export const coolifyApplicationSchema = z
  .object({
    uuid: z.string().min(1),
    name: z.string().min(1),
    status: z.string().nullish(),
    fqdn: z.string().nullish(),
    domains: z.string().nullish(),
    project: z.object({ name: z.string().nullish() }).passthrough().nullish(),
    environment: z.object({ name: z.string().nullish() }).passthrough().nullish(),
    destination: z
      .object({
        server: z
          .object({ uuid: z.string().min(1) })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
    limits_cpus: z.union([z.string(), z.number()]).nullish(),
    limits_cpuset: z.string().nullish(),
    limits_cpu_shares: z.number().int().nullish(),
    limits_memory: z.union([z.string(), z.number()]).nullish(),
    limits_memory_reservation: z.union([z.string(), z.number()]).nullish(),
    limits_memory_swap: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough()

export const coolifyApplicationsSchema = z.union([
  z.array(coolifyApplicationSchema),
  z.object({ data: z.array(coolifyApplicationSchema) }).passthrough(),
])

export type CoolifyApplication = z.infer<typeof coolifyApplicationSchema>

export const coolifyServerSchema = z
  .object({
    uuid: z.string().min(1),
    name: z.string().min(1),
    ip: z.string().nullish(),
    port: z.number().int().nullish(),
    is_reachable: z.boolean().nullish(),
    is_usable: z.boolean().nullish(),
    is_coolify_host: z.boolean().nullish(),
    settings: z
      .object({
        is_reachable: z.boolean().nullish(),
        is_usable: z.boolean().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough()

export const coolifyServersSchema = z.union([
  z.array(coolifyServerSchema),
  z.object({ data: z.array(coolifyServerSchema) }).passthrough(),
])

export type CoolifyServer = z.infer<typeof coolifyServerSchema>
