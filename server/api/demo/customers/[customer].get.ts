import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDatabase } from '../../../database/client'
import {
  customers,
  infrastructureResources,
  invoiceItems,
  invoices,
  serviceResources,
  services,
} from '../../../database/schema'
import { overdueAccessWindow } from '../../../services/billing/access-policy'
import { SettingsService } from '../../../services/settings/settings-service'
import { todayIsoDate } from '../../../utils/clock'
import { DomainError } from '../../../utils/errors'

const demoCustomerSchema = z.enum(['demo-customer-1', 'demo-customer-2', 'demo-customer-3'])

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const slug = demoCustomerSchema.parse(getRouterParam(event, 'customer'))
  const database = useDatabase()
  const [row] = await database
    .select({
      customerName: customers.companyName,
      contactName: customers.name,
      serviceNumber: services.serviceNumber,
      planName: services.planName,
      serviceStatus: services.status,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceStatus: invoices.status,
      dueDate: invoices.dueDate,
      balanceDue: invoices.balanceDue,
      resourceState: infrastructureResources.observedState,
    })
    .from(infrastructureResources)
    .innerJoin(serviceResources, eq(serviceResources.resourceId, infrastructureResources.id))
    .innerJoin(services, eq(services.id, serviceResources.serviceId))
    .innerJoin(customers, eq(customers.id, services.customerId))
    .innerJoin(invoiceItems, eq(invoiceItems.serviceId, services.id))
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .where(eq(infrastructureResources.externalId, slug))
    .orderBy(desc(invoices.createdAt))
    .limit(1)

  if (!row) throw DomainError.notFound('Customer demo tidak ditemukan.')

  const billingSettings = await new SettingsService().getBillingSettings()
  const today = todayIsoDate(billingSettings.billingTimezone)
  const accessWindow =
    row.balanceDue > 0n && (row.invoiceStatus === 'unpaid' || row.invoiceStatus === 'overdue')
      ? overdueAccessWindow(row.dueDate, today, billingSettings.overdueGraceDays)
      : null

  return {
    data: {
      slug,
      customerName: row.customerName || row.contactName,
      contactName: row.contactName,
      serviceNumber: row.serviceNumber,
      planName: row.planName || 'Custom plan',
      serviceStatus: row.serviceStatus,
      invoiceNumber: row.invoiceNumber,
      invoiceStatus: row.invoiceStatus,
      balanceDue: row.balanceDue.toString(),
      daysPastDue: accessWindow?.daysPastDue ?? 0,
      graceEndsAt: accessWindow?.graceEndsAt ?? null,
      state: accessWindow?.state ?? 'normal',
      resourceState: row.resourceState,
      portalUrl: `/login?redirect=${encodeURIComponent(`/portal/invoices/${row.invoiceId}`)}`,
    },
  }
})
