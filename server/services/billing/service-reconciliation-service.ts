import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { useDatabase, type Database, type Transaction } from '../../database/client'
import {
  infrastructureOperations,
  infrastructureResources,
  invoiceItems,
  invoices,
  resourceRoutes,
  serviceResources,
  services,
} from '../../database/schema'
import { SettingsService } from '../settings/settings-service'
import { InfrastructureLifecycleService } from '../infrastructure/lifecycle-service'
import { todayIsoDate } from '../../utils/clock'
import { overdueAccessWindow } from './access-policy'

type BillingSettings = Awaited<ReturnType<SettingsService['getBillingSettings']>>

/** Reconcile persisted business intent, never depend on an HTTP payment callback surviving. */
export class ServiceReconciliationService {
  constructor(private readonly database: Database = useDatabase()) {}

  async run() {
    const settings = await new SettingsService().getBillingSettings()
    let cursor: string | undefined
    for (;;) {
      const batch = await this.database
        .select({ id: services.id })
        .from(services)
        .where(cursor ? gt(services.id, cursor) : undefined)
        .orderBy(asc(services.id))
        .limit(100)
      if (!batch.length) break
      for (const service of batch) {
        try {
          await this.database.transaction((transaction) =>
            this.reconcile(transaction, service.id, settings),
          )
        } catch (error) {
          console.error(
            '[service-reconciliation]',
            service.id,
            error instanceof Error ? error.message : 'failed',
          )
        }
      }
      cursor = batch.at(-1)!.id
    }
  }

  private async reconcile(transaction: Transaction, id: string, settings: BillingSettings) {
    const [service] = await transaction
      .select()
      .from(services)
      .where(eq(services.id, id))
      .for('update', { skipLocked: true })
    if (!service) return
    const today = todayIsoDate(settings.billingTimezone)
    const bills = await transaction
      .select({
        status: invoices.status,
        dueDate: invoices.dueDate,
        balanceDue: invoices.balanceDue,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(eq(invoiceItems.serviceId, id))
    const awaitingFirstPayment =
      service.billingMode === 'prepaid' &&
      service.priceAmount > 0n &&
      !service.activatedAt &&
      !bills.some((bill) => bill.status === 'paid')
    const overdue =
      settings.billingAccessControlEnabled &&
      bills.some(
        (bill) =>
          ['unpaid', 'overdue'].includes(bill.status) &&
          bill.balanceDue > 0n &&
          overdueAccessWindow(bill.dueDate, today, settings.overdueGraceDays)?.state === 'blocked',
      )
    const blocked = awaitingFirstPayment || overdue
    const resources = await transaction
      .select({ resource: infrastructureResources })
      .from(serviceResources)
      .innerJoin(
        infrastructureResources,
        eq(infrastructureResources.id, serviceResources.resourceId),
      )
      .where(and(eq(serviceResources.serviceId, id), isNull(infrastructureResources.deletedAt)))
    if (service.billingBlocked !== blocked) {
      await transaction
        .update(services)
        .set({ billingBlocked: blocked, updatedAt: new Date() })
        .where(eq(services.id, id))
      await new InfrastructureLifecycleService().apply(
        transaction,
        id,
        service.status === 'active' && !blocked ? 'active' : 'suspended',
        null,
      )
      return
    }
    if (!resources.length) {
      await transaction
        .update(services)
        .set({
          infrastructureStatus: service.status === 'active' ? 'pending' : 'ready',
          infrastructureError:
            service.status === 'active' ? 'Hubungkan deployment ke service.' : null,
        })
        .where(eq(services.id, id))
      return
    }
    const target = service.status === 'active' && !blocked ? 'running' : 'stopped'
    if (
      target === 'stopped' &&
      resources.some(
        ({ resource }) => !['stopped', 'deleting', 'deleted'].includes(resource.desiredState),
      )
    ) {
      await new InfrastructureLifecycleService().apply(transaction, id, 'suspended', null)
      return
    }
    const ids = resources.map(({ resource }) => resource.id)
    const operations = await transaction
      .select()
      .from(infrastructureOperations)
      .where(inArray(infrastructureOperations.resourceId, ids))
      .orderBy(desc(infrastructureOperations.createdAt))
    const current = operations.filter(
      (operation) =>
        (target !== 'stopped' ||
          ['application.stop', 'application.delete', 'route.delete'].includes(operation.action)) &&
        [
          'application.ensure',
          'application.redeploy',
          'application.start',
          'application.stop',
          'application.restart',
          'application.delete',
          'route.configure',
          'route.delete',
          'database.service.ensure',
        ].includes(operation.action) &&
        (operation.expectedResourceRevision === null ||
          resources.some(
            ({ resource }) =>
              resource.id === operation.resourceId &&
              resource.desiredRevision === operation.expectedResourceRevision,
          )),
    )
    const pending = current.some((operation) =>
      ['queued', 'dispatched', 'running'].includes(operation.status),
    )
    // A newer attempt of the same action supersedes older errors in the display.
    const latest = new Map<string, (typeof operations)[number]>()
    for (const operation of current) {
      const key = `${operation.resourceId}:${operation.action}`
      if (!latest.has(key)) latest.set(key, operation)
    }
    const failure = [...latest.values()].find((operation) =>
      ['failed', 'expired'].includes(operation.status),
    )
    const routes = await transaction
      .select()
      .from(resourceRoutes)
      .where(inArray(resourceRoutes.resourceId, ids))
    const ready =
      !pending &&
      !failure &&
      resources.every(({ resource }) => {
        if (target === 'stopped')
          return resource.observedState === 'stopped' || resource.externalId.startsWith('pending:')
        if (resource.observedState !== 'running') return false
        if (
          !service.activatedAt &&
          !current.some(
            (operation) =>
              operation.resourceId === resource.id &&
              operation.status === 'succeeded' &&
              operation.result?.ready === true,
          )
        )
          return false
        return (
          resource.classification !== 'billable' ||
          resource.kind !== 'application' ||
          routes.some(
            (route) =>
              route.resourceId === resource.id &&
              route.billingGateEnabled &&
              route.observedStatus === 'active',
          )
        )
      })
    const activated = ready && target === 'running' && !service.activatedAt
    await transaction
      .update(services)
      .set({
        infrastructureStatus: failure ? 'failed' : ready ? 'ready' : 'pending',
        infrastructureError: failure
          ? (failure.errorMessage ?? `Operation ${failure.status}`)
          : null,
        ...(activated
          ? {
              activatedAt: new Date(),
              ...(service.billingMode === 'postpaid'
                ? { billingStartDate: today, nextDueDate: today }
                : {}),
            }
          : {}),
      })
      .where(eq(services.id, id))
  }
}
