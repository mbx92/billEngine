import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDatabase } from '../../../../database/client'
import { customers, serviceResources, services } from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const resourceId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const [service] = await useDatabase()
    .select({
      id: services.id,
      name: services.name,
      serviceNumber: services.serviceNumber,
      customerName: customers.name,
      planName: services.planName,
      status: services.status,
      billingMode: services.billingMode,
      billingBlocked: services.billingBlocked,
      infrastructureStatus: services.infrastructureStatus,
      infrastructureError: services.infrastructureError,
      activatedAt: services.activatedAt,
      billingStartDate: services.billingStartDate,
      nextDueDate: services.nextDueDate,
      currency: services.currency,
      priceAmount: services.priceAmount,
    })
    .from(serviceResources)
    .innerJoin(services, eq(services.id, serviceResources.serviceId))
    .innerJoin(customers, eq(customers.id, services.customerId))
    .where(eq(serviceResources.resourceId, resourceId))
    .limit(1)
  return {
    data: service
      ? {
          ...service,
          priceAmount: service.priceAmount.toString(),
          activatedAt: service.activatedAt?.toISOString() ?? null,
        }
      : null,
  }
})
