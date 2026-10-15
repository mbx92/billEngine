import { and, asc, eq, gt, inArray, lt, ne } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import {
  infrastructureResources,
  invoiceItems,
  invoices,
  resourceRoutes,
  serviceResources,
  services,
} from '../database/schema'
import { normalizeRequestHost } from '../services/billing/access-policy'

export class BillingAccessRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findServiceByHost(host: string) {
    const candidates = await this.database
      .select({
        id: services.id,
        name: services.name,
        serviceNumber: services.serviceNumber,
        status: services.status,
        managedHostname: resourceRoutes.hostname,
        managedDomainStatus: resourceRoutes.observedStatus,
      })
      .from(serviceResources)
      .innerJoin(services, eq(services.id, serviceResources.serviceId))
      .innerJoin(
        infrastructureResources,
        eq(infrastructureResources.id, serviceResources.resourceId),
      )
      .innerJoin(resourceRoutes, eq(resourceRoutes.resourceId, infrastructureResources.id))
      .where(
        and(
          ne(services.status, 'cancelled'),
          eq(infrastructureResources.kind, 'application'),
          eq(resourceRoutes.observedStatus, 'active'),
        ),
      )

    const matches = candidates.filter(
      (candidate) => normalizeRequestHost(candidate.managedHostname) === host,
    )
    const serviceIds = new Set(matches.map((match) => match.id))

    // Ambiguous host ownership must fail open instead of blocking the wrong customer.
    return serviceIds.size === 1 ? matches[0]! : null
  }

  async findOldestOpenOverdueInvoice(serviceId: string, asOf: string) {
    const [invoice] = await this.database
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        dueDate: invoices.dueDate,
        balanceDue: invoices.balanceDue,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(
        and(
          eq(invoiceItems.serviceId, serviceId),
          inArray(invoices.status, ['unpaid', 'overdue']),
          gt(invoices.balanceDue, 0n),
          lt(invoices.dueDate, asOf),
        ),
      )
      .orderBy(asc(invoices.dueDate), asc(invoices.createdAt))
      .limit(1)

    return invoice ?? null
  }
}
