import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import {
  coolifyResources,
  invoiceItems,
  invoices,
  serviceResources,
  services,
} from '../database/schema'
import { hostsFromCoolifyFqdn } from '../services/billing/access-policy'

export class BillingAccessRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findServiceByHost(host: string) {
    const candidates = await this.database
      .select({
        id: services.id,
        name: services.name,
        serviceNumber: services.serviceNumber,
        status: services.status,
        fqdn: coolifyResources.fqdn,
      })
      .from(serviceResources)
      .innerJoin(services, eq(services.id, serviceResources.serviceId))
      .innerJoin(coolifyResources, eq(coolifyResources.id, serviceResources.resourceId))
      .where(
        and(
          eq(coolifyResources.resourceType, 'application'),
          eq(coolifyResources.classification, 'billable'),
        ),
      )

    const hostMatches = candidates.filter((candidate) =>
      hostsFromCoolifyFqdn(candidate.fqdn).includes(host),
    )
    // A resource may be reassigned after cancellation. The new contract owns access;
    // a cancelled contract still blocks until it is unlinked or replaced.
    const currentMatches = hostMatches.filter((candidate) => candidate.status !== 'cancelled')
    const matches = currentMatches.length > 0 ? currentMatches : hostMatches
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
          // Access follows invoice status and due date, including zero-value trials
          // and fully discounted invoices. Amount alone never settles an invoice.
          lt(invoices.dueDate, asOf),
        ),
      )
      .orderBy(asc(invoices.dueDate), asc(invoices.createdAt))
      .limit(1)

    return invoice ?? null
  }
}
