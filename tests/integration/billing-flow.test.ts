import { count, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../../server/database/client'
import { checkDatabaseReadiness } from '../../server/database/readiness'
import * as schema from '../../server/database/schema'
import { invoices, payments, serviceBillingRuns } from '../../server/database/schema'
import { AuditLogRepository } from '../../server/repositories/audit'
import { CreditNoteRepository } from '../../server/repositories/credit-notes'
import { CustomerRepository } from '../../server/repositories/customers'
import { InvoiceRepository } from '../../server/repositories/invoices'
import { BillingAccessRepository } from '../../server/repositories/billing-access'
import { BillingAccessControlService } from '../../server/services/billing/access-control-service'
import { PaymentRepository } from '../../server/repositories/payments'
import { PlanRepository } from '../../server/repositories/plans'
import { ServiceRepository } from '../../server/repositories/services'
import { UserRepository } from '../../server/repositories/users'
import { CustomerService } from '../../server/services/customers/customer-service'
import { CreditNoteService } from '../../server/services/invoices/credit-note-service'
import { InvoiceService } from '../../server/services/invoices/invoice-service'
import { PaymentService } from '../../server/services/payments/payment-service'
import { PlanCatalogService } from '../../server/services/plans/plan-catalog-service'
import { ServiceCatalogService } from '../../server/services/services/service-catalog-service'
import { UserService } from '../../server/services/users/user-service'
import { PortalService } from '../../server/services/portal/portal-service'
import { ReportService } from '../../server/services/reports/report-service'
import { useBillingConfig } from '../../server/utils/billing-config'
import { SettingsService } from '../../server/services/settings/settings-service'
import { SettingsRepository } from '../../server/repositories/settings'
import { InfrastructureReconciliationService } from '../../server/services/infrastructure/reconciliation-service'

vi.mock('../../server/utils/billing-config', () => ({
  useBillingConfig: vi.fn().mockResolvedValue({
    timezone: 'Asia/Makassar',
    currency: 'IDR',
    defaultTaxRate: null,
    billingAutomationEnabled: true,
    companyName: 'BillEngine Test',
    seller: {
      name: 'BillEngine Test',
      email: 'billing@example.test',
      address: 'Test address',
      taxId: null,
    },
  }),
}))

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip
const actor = { userId: null }

describeWithDatabase('billing flow integration', () => {
  let pool: pg.Pool
  let database: Database
  let customers: CustomerService
  let plans: PlanCatalogService
  let services: ServiceCatalogService
  let invoiceService: InvoiceService
  let paymentService: PaymentService
  let creditNoteService: CreditNoteService
  let portalService: PortalService
  let reportService: ReportService
  let userService: UserService

  let enabledConfig: Awaited<ReturnType<typeof useBillingConfig>>

  beforeAll(async () => {
    enabledConfig = await useBillingConfig()
    const databaseName = new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase()
    if (!databaseName.includes('test')) {
      throw new Error('Integration tests require a database whose name contains "test".')
    }

    pool = new pg.Pool({ connectionString: testDatabaseUrl })
    database = drizzle(pool, { schema }) as Database

    const customerRepository = new CustomerRepository(database)
    const planRepository = new PlanRepository(database)
    const serviceRepository = new ServiceRepository(database)
    const invoiceRepository = new InvoiceRepository(database)
    const paymentRepository = new PaymentRepository(database)
    const auditRepository = new AuditLogRepository(database)
    const creditNoteRepository = new CreditNoteRepository(database)

    customers = new CustomerService(customerRepository)
    plans = new PlanCatalogService(planRepository)
    services = new ServiceCatalogService(
      database,
      serviceRepository,
      auditRepository,
      planRepository,
    )
    invoiceService = new InvoiceService(
      database,
      invoiceRepository,
      customerRepository,
      serviceRepository,
      auditRepository,
    )
    paymentService = new PaymentService(
      database,
      paymentRepository,
      invoiceRepository,
      auditRepository,
    )
    creditNoteService = new CreditNoteService(
      database,
      creditNoteRepository,
      invoiceRepository,
      paymentRepository,
      auditRepository,
    )
    portalService = new PortalService(customerRepository, serviceRepository, invoiceRepository)
    reportService = new ReportService(database)
    userService = new UserService(
      database,
      new UserRepository(database),
      customerRepository,
      auditRepository,
    )
  })

  beforeEach(async () => {
    vi.mocked(useBillingConfig).mockReset().mockResolvedValue(enabledConfig)
    vi.unstubAllGlobals()
    await pool.query(`
      truncate table
        audit_logs,
        email_deliveries,
        credit_notes,
        payments,
        invoice_items,
        service_billing_runs,
        invoices,
        service_resources,
        services,
        plans,
        customers,
        coolify_resources,
        coolify_nodes,
        coolify_servers,
        document_sequences,
        job_runs,
        settings,
        sessions,
        accounts,
        verifications,
        users
      restart identity cascade
    `)
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('reports ready after all bundled migrations have been applied', async () => {
    await expect(checkDatabaseReadiness(pool)).resolves.toEqual({
      ready: true,
      checks: { database: 'ok', migrations: 'ok' },
    })
  })

  async function createCustomerPlanAndService(billingStartDate = '2026-01-01', suffix = '') {
    const customer = await customers.create({
      name: 'Integration Customer',
      companyName: 'Integration Company',
      email: 'customer@example.test',
      countryCode: 'ID',
    })
    const plan = await plans.create({
      name: `Managed Cloud${suffix}`,
      description: 'Integration test plan',
      currency: 'IDR',
      priceAmount: 1_000_000n,
      billingCycle: 'monthly',
      inclusions: ['Managed infrastructure'],
    })
    const service = await services.create(
      {
        customerId: customer.id,
        planId: plan.id,
        name: 'Production workload',
        billingStartDate,
        invoiceLeadDays: 0,
        paymentDueDays: 7,
        taxRate: '0',
        resourceIds: [],
      },
      actor,
    )

    return { customer, plan, service }
  }

  async function createManualInvoice() {
    const { customer, service } = await createCustomerPlanAndService()
    return invoiceService.createManual(
      {
        customerId: customer.id,
        issueDate: '2026-01-01',
        dueDate: '2099-01-31',
        items: [
          {
            serviceId: service.id,
            description: 'Managed Cloud - January',
            quantity: '1',
            unitPriceAmount: 1_000_000n,
            taxRate: '0',
          },
        ],
      },
      actor,
    )
  }

  it('covers customer → plan → service → invoice → partial/full payment → refund', async () => {
    const invoice = await createManualInvoice()
    expect(invoice).toMatchObject({
      status: 'unpaid',
      totalAmount: 1_000_000n,
      amountPaid: 0n,
      balanceDue: 1_000_000n,
    })

    const partial = await paymentService.record(
      {
        invoiceId: invoice.id,
        amount: 400_000n,
        method: 'bank_transfer',
        status: 'completed',
      },
      actor,
    )
    expect(partial.invoice).toMatchObject({
      status: 'unpaid',
      amountPaid: 400_000n,
      balanceDue: 600_000n,
    })

    const credit = await creditNoteService.create(
      invoice.id,
      { amount: 100_000n, reason: 'Service credit' },
      actor,
    )
    expect(credit.invoice).toMatchObject({
      status: 'unpaid',
      creditedAmount: 100_000n,
      amountPaid: 400_000n,
      balanceDue: 500_000n,
    })

    const full = await paymentService.record(
      {
        invoiceId: invoice.id,
        amount: 500_000n,
        method: 'bank_transfer',
        status: 'completed',
      },
      actor,
    )
    expect(full.invoice).toMatchObject({
      status: 'paid',
      amountPaid: 900_000n,
      balanceDue: 0n,
    })

    const refund = await paymentService.record(
      {
        invoiceId: invoice.id,
        amount: 150_000n,
        method: 'bank_transfer',
        status: 'refunded',
      },
      actor,
    )
    expect(refund.invoice).toMatchObject({
      status: 'unpaid',
      amountPaid: 750_000n,
      balanceDue: 150_000n,
    })

    const portal = await portalService.summary(invoice.customerId)
    expect(portal.invoices).toHaveLength(1)
    expect(portal.openBalance).toEqual([{ currency: 'IDR', amount: '150000' }])

    const report = await reportService.summary({ from: '2026-01-01', to: '2026-12-31' })
    expect(report.invoiced).toEqual([{ currency: 'IDR', amount: '1000000', count: 1 }])
    expect(report.collected).toEqual([{ currency: 'IDR', amount: '750000' }])
    expect(report.outstanding).toEqual([{ currency: 'IDR', amount: '150000' }])
  })

  it('serializes concurrent payments so an invoice cannot be overpaid', async () => {
    const invoice = await createManualInvoice()
    const payment = {
      invoiceId: invoice.id,
      amount: 1_000_000n,
      method: 'bank_transfer',
      status: 'completed' as const,
    }

    const results = await Promise.allSettled([
      paymentService.record(payment, actor),
      paymentService.record(payment, actor),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const [storedInvoice] = await database
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoice.id))
    const [paymentCount] = await database
      .select({ total: count() })
      .from(payments)
      .where(eq(payments.invoiceId, invoice.id))
    expect(storedInvoice).toMatchObject({
      status: 'paid',
      amountPaid: 1_000_000n,
      balanceDue: 0n,
    })
    expect(paymentCount?.total).toBe(1)
  })

  function manualInput(customerId: string, serviceId?: string, dated = true) {
    return {
      customerId,
      issueDate: '2026-01-01',
      dueDate: '2026-01-31',
      items: [
        {
          serviceId,
          description: 'Manual January subscription',
          quantity: '1',
          unitPriceAmount: 1_000_000n,
          ...(dated ? { servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-01-31' } : {}),
        },
      ],
    }
  }

  it.each(['unpaid', 'paid', 'cancelled'] as const)(
    'recognizes a pre-existing %s manual invoice and bills only the next period',
    async (status) => {
      const { customer, service } = await createCustomerPlanAndService()
      const manual = await invoiceService.createManual(manualInput(customer.id, service.id), actor)
      await database.update(invoices).set({ status }).where(eq(invoices.id, manual.id))
      // Manual creation does not need a marker for legacy coverage to be recognized.
      expect(await database.select().from(serviceBillingRuns)).toHaveLength(0)
      const january = await invoiceService.generateRecurring(
        { asOf: '2026-01-01', limit: 100 },
        actor,
      )
      expect(january.created).toHaveLength(0)
      expect(january.skipped[0]?.reason).toContain(manual.invoiceNumber)
      expect(
        (await database.select().from(schema.services).where(eq(schema.services.id, service.id)))[0]
          ?.nextDueDate,
      ).toBe('2026-02-01')
      const february = await invoiceService.generateRecurring(
        { asOf: '2026-02-01', limit: 100 },
        actor,
      )
      expect(february.created).toHaveLength(1)
    },
  )

  it('holds an undated service invoice without advancing or blocking unrelated services', async () => {
    const { customer, service } = await createCustomerPlanAndService()
    await invoiceService.createManual(manualInput(customer.id, service.id, false), actor)
    const other = await createCustomerPlanAndService('2026-01-01', ' other')
    const result = await invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor)
    expect(result.created.map((row) => row.serviceId)).toEqual([other.service.id])
    expect(result.skipped).toEqual([
      expect.objectContaining({
        serviceId: service.id,
        reason: expect.stringContaining('belum memiliki periode'),
      }),
    ])
    expect(
      (await database.select().from(schema.services).where(eq(schema.services.id, service.id)))[0]
        ?.nextDueDate,
    ).toBe('2026-01-01')
  })

  it('resumes safely when an undated manual invoice receives its service period', async () => {
    const { customer, service } = await createCustomerPlanAndService()
    const manual = await invoiceService.createManual(
      manualInput(customer.id, service.id, false),
      actor,
    )
    await invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor)
    await invoiceService.update(manual.id, manualInput(customer.id, service.id), actor)
    const result = await invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor)
    expect(result.created).toHaveLength(0)
    expect(
      (await database.select().from(schema.services).where(eq(schema.services.id, service.id)))[0]
        ?.nextDueDate,
    ).toBe('2026-02-01')
  })

  it('does not let an unlinked custom invoice suppress a subscription', async () => {
    const { customer } = await createCustomerPlanAndService()
    await invoiceService.createManual(manualInput(customer.id), actor)
    expect(
      (await invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor)).created,
    ).toHaveLength(1)
  })

  it('prevents overlapping manual and recurring invoices racing for a period', async () => {
    const { customer, service } = await createCustomerPlanAndService()
    await Promise.allSettled([
      invoiceService.createManual(manualInput(customer.id, service.id), actor),
      invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor),
    ])
    const rows = await database.select().from(invoices).where(eq(invoices.customerId, customer.id))
    expect(rows).toHaveLength(1)
  })

  it('rejects recurring when disabled and rechecks a switch changed during the batch', async () => {
    await createCustomerPlanAndService()
    vi.mocked(useBillingConfig).mockResolvedValue({
      ...enabledConfig,
      billingAutomationEnabled: false,
    })
    await expect(
      invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor),
    ).rejects.toMatchObject({ code: 'STATE_INVALID' })
    vi.mocked(useBillingConfig).mockResolvedValueOnce(enabledConfig)
    const result = await invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor)
    expect(result.created).toHaveLength(0)
    expect(result.skipped[0]?.reason).toContain('nonaktif')
    expect(await database.select().from(invoices)).toHaveLength(0)
    expect(await database.select().from(serviceBillingRuns)).toHaveLength(0)
  })

  it('persists disabled Settings despite enabled environment defaults', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      billingAutomationEnabled: true,
      billingAccessControlEnabled: true,
    }))
    const settings = new SettingsService(
      database,
      new SettingsRepository(database),
      new AuditLogRepository(database),
    )
    const before = await settings.getBillingSettings()
    expect(before.billingAutomationEnabled).toBe(true)
    await settings.updateBillingSettings(
      {
        companyName: 'Test Company',
        companyEmail: null,
        companyAddress: null,
        companyTaxId: null,
        billingTimezone: 'Asia/Makassar',
        billingCurrency: 'IDR',
        defaultTaxRate: null,
        billingAutomationEnabled: false,
        billingAccessControlEnabled: false,
        overdueGraceDays: 7,
        graceNoticeIntervalHours: 24,
      },
      actor,
    )
    expect(await settings.getBillingSettings()).toMatchObject({
      billingAutomationEnabled: false,
      billingAccessControlEnabled: false,
    })
    await createCustomerPlanAndService()
    vi.mocked(useBillingConfig).mockImplementation(async (transaction) => ({
      ...enabledConfig,
      billingAutomationEnabled: (await settings.getBillingSettings(transaction))
        .billingAutomationEnabled,
    }))
    await expect(
      invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor),
    ).rejects.toMatchObject({ code: 'STATE_INVALID' })
    expect(await database.select().from(invoices)).toHaveLength(0)
  })

  it('deletes a cancelled service after invoice deletion without reopening the billed period', async () => {
    const { service } = await createCustomerPlanAndService()
    const other = await createCustomerPlanAndService('2026-01-01', ' other')
    const generated = await invoiceService.generateRecurring(
      { asOf: '2026-01-01', limit: 100 },
      actor,
    )
    const invoiceId = generated.created.find((row) => row.serviceId === service.id)!.invoiceId
    await invoiceService.cancel(invoiceId, actor)
    await invoiceService.removeCancelled(invoiceId, actor)

    expect(
      await database
        .select()
        .from(serviceBillingRuns)
        .where(eq(serviceBillingRuns.serviceId, service.id)),
    ).toEqual([expect.objectContaining({ invoiceId: null, periodStart: '2026-01-01' })])
    expect(
      (await invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor)).created,
    ).toHaveLength(0)
    await expect(services.removeCancelled(service.id, actor)).rejects.toMatchObject({
      code: 'STATE_INVALID',
    })
    await services.transition(
      service.id,
      { status: 'cancelled', reason: 'Remove unused service' },
      actor,
    )

    await expect(services.removeCancelled(service.id, actor)).resolves.toMatchObject({
      id: service.id,
    })
    expect(
      await database.select().from(schema.services).where(eq(schema.services.id, service.id)),
    ).toHaveLength(0)
    expect(
      await database
        .select()
        .from(serviceBillingRuns)
        .where(eq(serviceBillingRuns.serviceId, service.id)),
    ).toHaveLength(0)
    expect(
      await database
        .select()
        .from(serviceBillingRuns)
        .where(eq(serviceBillingRuns.serviceId, other.service.id)),
    ).toHaveLength(1)
    expect(
      await database
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.entityId, service.id)),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'service.deleted' })]))
  })

  it.each(['unpaid', 'cancelled'] as const)(
    'preserves a cancelled service while a %s recurring invoice still exists',
    async (status) => {
      const { service } = await createCustomerPlanAndService()
      const generated = await invoiceService.generateRecurring(
        { asOf: '2026-01-01', limit: 100 },
        actor,
      )
      const invoiceId = generated.created[0]!.invoiceId
      if (status === 'cancelled') await invoiceService.cancel(invoiceId, actor)
      await services.transition(
        service.id,
        { status: 'cancelled', reason: 'Customer cancelled' },
        actor,
      )
      await expect(services.removeCancelled(service.id, actor)).rejects.toMatchObject({
        code: 'STATE_INVALID',
      })
      expect(
        await database.select().from(schema.services).where(eq(schema.services.id, service.id)),
      ).toHaveLength(1)
      expect(
        await database
          .select()
          .from(serviceBillingRuns)
          .where(eq(serviceBillingRuns.serviceId, service.id)),
      ).toHaveLength(1)
      expect(await database.select().from(invoices).where(eq(invoices.id, invoiceId))).toHaveLength(
        1,
      )
    },
  )

  it('protects manual invoice items even without a billing period record', async () => {
    const invoice = await createManualInvoice()
    const [item] = await database
      .select()
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, invoice.id))
    const serviceId = item!.serviceId!
    await database.delete(serviceBillingRuns).where(eq(serviceBillingRuns.serviceId, serviceId))
    await invoiceService.cancel(invoice.id, actor)
    await services.transition(
      serviceId,
      { status: 'cancelled', reason: 'Customer cancelled' },
      actor,
    )
    await expect(services.removeCancelled(serviceId, actor)).rejects.toMatchObject({
      code: 'STATE_INVALID',
    })
    expect(
      await database
        .select()
        .from(schema.invoiceItems)
        .where(eq(schema.invoiceItems.invoiceId, invoice.id)),
    ).toHaveLength(1)
  })

  it('creates at most one recurring invoice for the same service period', async () => {
    const { customer, service } = await createCustomerPlanAndService('2026-01-01')

    const results = await Promise.all([
      invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor),
      invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor),
    ])

    const [runCount] = await database
      .select({ total: count() })
      .from(serviceBillingRuns)
      .where(eq(serviceBillingRuns.serviceId, service.id))
    const [invoiceCount] = await database
      .select({ total: count() })
      .from(invoices)
      .where(eq(invoices.customerId, customer.id))

    expect(results.flatMap((result) => result.created)).toHaveLength(1)
    expect(runCount?.total).toBe(1)
    expect(invoiceCount?.total).toBe(1)
  })

  it('repairs a stale recurring schedule when that service period is already invoiced', async () => {
    const { service } = await createCustomerPlanAndService('2026-01-01')

    await invoiceService.generateRecurring({ asOf: '2026-01-01', limit: 100 }, actor)
    await database
      .update(schema.services)
      .set({ nextDueDate: '2026-01-01' })
      .where(eq(schema.services.id, service.id))

    const repaired = await invoiceService.generateRecurring(
      { asOf: '2026-01-01', limit: 100 },
      actor,
    )
    const [storedService] = await database
      .select({ nextDueDate: schema.services.nextDueDate })
      .from(schema.services)
      .where(eq(schema.services.id, service.id))

    expect(repaired.created).toHaveLength(0)
    expect(repaired.skipped).toEqual([
      {
        serviceId: service.id,
        reason: 'invoice periode ini sudah ada; jadwal billing diperbaiki',
      },
    ])
    expect(storedService?.nextDueDate).toBe('2026-02-01')
  })

  it.each(['free', 'discount', 'recurring'] as const)(
    'applies grace and blocking to a zero-value %s invoice using status and due date',
    async (kind) => {
      const { customer, service } = await createCustomerPlanAndService()
      const [server] = await database
        .insert(schema.coolifyServers)
        .values({ name: 'Gate test', baseUrl: 'https://coolify.example.test' })
        .returning()
      const [resource] = await database
        .insert(schema.coolifyResources)
        .values({
          coolifyServerId: server!.id,
          coolifyUuid: 'trial-app',
          resourceType: 'application',
          name: 'Trial app',
          classification: 'billable',
          fqdn: 'https://trial.example.test',
        })
        .returning()
      await database
        .insert(schema.serviceResources)
        .values({ serviceId: service.id, resourceId: resource!.id })
      let invoiceId: string
      if (kind === 'recurring') {
        await database
          .update(schema.services)
          .set({ priceAmount: 0n })
          .where(eq(schema.services.id, service.id))
        const generated = await invoiceService.generateRecurring(
          { asOf: '2026-01-01', limit: 100 },
          actor,
        )
        invoiceId = generated.created[0]!.invoiceId
      } else {
        const invoice = await invoiceService.createManual(
          {
            customerId: customer.id,
            issueDate: '2026-01-01',
            dueDate: '2026-01-08',
            discountPercent: kind === 'discount' ? '1' : undefined,
            items: [
              {
                serviceId: service.id,
                description: 'Trial access',
                quantity: '1',
                unitPriceAmount: kind === 'discount' ? 100_000n : 0n,
                taxRate: '0',
              },
            ],
          },
          actor,
        )
        invoiceId = invoice.id
      }
      const [stored] = await database.select().from(invoices).where(eq(invoices.id, invoiceId))
      expect(stored).toMatchObject({ status: 'unpaid', totalAmount: 0n, balanceDue: 0n })
      const gate = new BillingAccessControlService(new BillingAccessRepository(database), {
        getBillingSettings: async () => ({
          billingAccessControlEnabled: true,
          billingTimezone: 'Asia/Makassar',
          overdueGraceDays: 7,
          graceNoticeIntervalHours: 24,
        }),
      } as never)
      await expect(
        gate.evaluate('trial.example.test', 'test-secret', '2026-01-08'),
      ).resolves.toMatchObject({ state: 'normal' })
      await expect(
        gate.evaluate('trial.example.test', 'test-secret', '2026-01-09'),
      ).resolves.toMatchObject({ state: 'grace', invoice: { id: invoiceId } })
      await invoiceService.markOverdue('2026-01-09', actor)
      await expect(
        gate.evaluate('trial.example.test', 'test-secret', '2026-01-15'),
      ).resolves.toMatchObject({ state: 'grace' })
      await expect(
        gate.evaluate('trial.example.test', 'test-secret', '2026-01-16'),
      ).resolves.toMatchObject({ state: 'blocked' })
      for (const status of ['draft', 'paid', 'cancelled'] as const) {
        await database.update(invoices).set({ status }).where(eq(invoices.id, invoiceId))
        await expect(
          gate.evaluate('trial.example.test', 'test-secret', '2026-01-16'),
        ).resolves.toMatchObject({ state: 'normal' })
      }
    },
  )

  it('allows editing an invoice to a 100% discount without settling its status', async () => {
    const invoice = await createManualInvoice()
    const [item] = await database
      .select()
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, invoice.id))
    await invoiceService.update(
      invoice.id,
      {
        customerId: invoice.customerId,
        issueDate: '2026-01-01',
        dueDate: '2099-01-31',
        discountPercent: '1',
        items: [
          {
            serviceId: item!.serviceId!,
            description: 'Discounted service',
            quantity: '1',
            unitPriceAmount: 1_000_000n,
            taxRate: '0',
          },
        ],
      },
      actor,
    )
    const [stored] = await database.select().from(invoices).where(eq(invoices.id, invoice.id))
    expect(stored).toMatchObject({
      status: 'unpaid',
      totalAmount: 0n,
      balanceDue: 0n,
      discountAmount: 1_000_000n,
    })
    expect(await database.select().from(payments)).toHaveLength(0)
  })

  it('uses synced Coolify domains instead of legacy managed domain records', async () => {
    const { service } = await createCustomerPlanAndService('2026-01-01')
    const [server] = await database
      .insert(schema.coolifyServers)
      .values({ name: 'Domain Coolify', baseUrl: 'https://coolify.domain.test' })
      .returning()
    const [resource] = await database
      .insert(schema.coolifyResources)
      .values({
        coolifyServerId: server!.id,
        coolifyUuid: 'managed-domain-resource',
        resourceType: 'application',
        name: 'Managed domain resource',
        fqdn: 'https://customer.ocnetworks.web.id',
      })
      .returning()
    await database.insert(schema.serviceResources).values({
      serviceId: service.id,
      resourceId: resource!.id,
    })
    await database.insert(schema.resourceDomains).values({
      resourceId: resource!.id,
      hostname: 'obsolete.ocnetworks.web.id',
      type: 'platform',
      status: 'active',
    })

    await expect(
      new BillingAccessRepository(database).findServiceByHost('customer.ocnetworks.web.id'),
    ).resolves.toMatchObject({ id: service.id, serviceNumber: service.serviceNumber })
    await expect(
      new BillingAccessRepository(database).findServiceByHost('obsolete.ocnetworks.web.id'),
    ).resolves.toBeNull()
    await services.transition(
      service.id,
      { status: 'cancelled', reason: 'Customer cancelled' },
      actor,
    )
    await expect(
      new BillingAccessRepository(database).findServiceByHost('customer.ocnetworks.web.id'),
    ).resolves.toMatchObject({ id: service.id, status: 'cancelled' })
  })

  it('stops recurring billing while suspended and resumes without losing the schedule', async () => {
    const { service } = await createCustomerPlanAndService('2026-01-01')

    await services.transition(
      service.id,
      { status: 'suspended', reason: 'Awaiting customer confirmation' },
      actor,
    )
    const suspendedRun = await invoiceService.generateRecurring(
      { asOf: '2026-01-01', limit: 100 },
      actor,
    )
    expect(suspendedRun.created).toHaveLength(0)

    await services.transition(
      service.id,
      { status: 'active', reason: 'Customer confirmed continuation' },
      actor,
    )
    const resumedRun = await invoiceService.generateRecurring(
      { asOf: '2026-01-01', limit: 100 },
      actor,
    )
    expect(resumedRun.created).toHaveLength(1)
  })

  it('connects Coolify allocation to a service plan and reports compliance', async () => {
    const customer = await customers.create({
      name: 'Infrastructure Customer',
      email: 'infrastructure@example.test',
      countryCode: 'ID',
    })
    const plan = await plans.create({
      name: 'Infrastructure Plan',
      currency: 'IDR',
      priceAmount: 750_000n,
      billingCycle: 'monthly',
      inclusions: ['Managed infrastructure'],
      includedResourceCount: 1,
      includedCpuCores: '2',
      includedMemoryBytes: 2_147_483_648n,
    })
    const [server] = await database
      .insert(schema.coolifyServers)
      .values({ name: 'Integration Coolify', baseUrl: 'https://coolify.example.test' })
      .returning()
    if (!server) throw new Error('Failed to prepare Coolify server.')
    const [resource] = await database
      .insert(schema.coolifyResources)
      .values({
        coolifyServerId: server.id,
        coolifyUuid: 'integration-resource',
        resourceType: 'application',
        name: 'customer-production',
        status: 'running',
        classification: 'billable',
        limitsCpus: '2',
        limitsMemoryBytes: 2_147_483_648n,
      })
      .returning()
    if (!resource) throw new Error('Failed to prepare Coolify resource.')

    const createdService = await services.create(
      {
        customerId: customer.id,
        planId: plan.id,
        name: 'Production infrastructure',
        billingStartDate: '2026-01-01',
        invoiceLeadDays: 0,
        paymentDueDays: 7,
        resourceIds: [resource.id],
      },
      actor,
    )

    const result = await services.list(1, 10)
    expect(result.rows[0]).toMatchObject({
      planResourceCount: 1,
      planCpuCores: '2.000',
      planMemoryBytes: '2147483648',
      infrastructure: {
        status: 'matched',
        actual: { resourceCount: 1, cpuCores: '2', memoryBytes: '2147483648' },
      },
    })

    await database
      .update(schema.coolifyResources)
      .set({ limitsCpus: '1', limitsMemoryBytes: 1_073_741_824n })
      .where(eq(schema.coolifyResources.id, resource.id))

    const preview = await new InfrastructureReconciliationService(database).preview(
      createdService.id,
    )
    expect(preview).toMatchObject({
      canApply: true,
      restartRequired: true,
      expectedResourceCount: 1,
      actualResourceCount: 1,
      resources: [
        {
          id: resource.id,
          currentCpuCores: '1.000',
          desiredCpuCores: '2',
          currentMemoryBytes: '1073741824',
          desiredMemoryBytes: '2147483648',
          changed: true,
        },
      ],
    })

    const updateApplicationLimits = vi.fn().mockResolvedValue({ uuid: 'integration-resource' })
    const restartApplication = vi.fn().mockResolvedValue({ message: 'queued' })
    const resourceSync = {
      syncServer: vi.fn().mockImplementation(async () => {
        await database
          .update(schema.coolifyResources)
          .set({ limitsCpus: '2', limitsMemoryBytes: 2_147_483_648n })
          .where(eq(schema.coolifyResources.id, resource.id))
      }),
    }
    const reconciler = new InfrastructureReconciliationService(
      database,
      undefined,
      undefined,
      undefined,
      resourceSync as never,
      () => ({ updateApplicationLimits, restartApplication }) as never,
    )
    const applied = await reconciler.apply(
      createdService.id,
      { fingerprint: preview.fingerprint, restartRunning: true },
      actor,
    )

    expect(updateApplicationLimits).toHaveBeenCalledWith('integration-resource', {
      cpuCores: '2',
      memoryBytes: 2_147_483_648n,
    })
    expect(restartApplication).toHaveBeenCalledWith('integration-resource')
    expect(applied).toMatchObject({
      status: 'completed',
      updatedCount: 1,
      restartedCount: 1,
      failedCount: 0,
      preview: { canApply: false, blockingReason: 'Seluruh resource sudah sesuai dengan plan.' },
    })
  })

  it('changes a legacy service to a plan and serializes bigint audit snapshots', async () => {
    const customer = await customers.create({
      name: 'Legacy Customer',
      email: 'legacy@example.test',
      countryCode: 'ID',
    })
    const plan = await plans.create({
      name: 'Legacy Migration Plan',
      currency: 'IDR',
      priceAmount: 900_000n,
      billingCycle: 'monthly',
      inclusions: ['Managed infrastructure'],
      includedResourceCount: 1,
      includedCpuCores: '1',
      includedMemoryBytes: 1_073_741_824n,
    })
    const [legacyService] = await database
      .insert(schema.services)
      .values({
        customerId: customer.id,
        planId: null,
        planName: null,
        serviceNumber: 'SVC-LEGACY-001',
        name: 'Legacy workload',
        currency: 'IDR',
        priceAmount: 500_000n,
        billingCycle: 'monthly',
        billingStartDate: '2026-01-01',
        nextDueDate: '2026-01-01',
      })
      .returning()
    if (!legacyService) throw new Error('Failed to prepare legacy service.')

    const updated = await services.update(legacyService.id, { planId: plan.id }, actor)

    expect(updated).toMatchObject({
      planId: plan.id,
      planName: 'Legacy Migration Plan',
      priceAmount: 900_000n,
      planMemoryBytes: 1_073_741_824n,
    })
    const [auditEntry] = await database
      .select({ beforeData: schema.auditLogs.beforeData, afterData: schema.auditLogs.afterData })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, legacyService.id))
      .limit(1)
    expect(auditEntry).toMatchObject({
      beforeData: { priceAmount: '500000' },
      afterData: { priceAmount: '900000', planMemoryBytes: '1073741824' },
    })
  })

  it('creates a customer portal user and protects the last super admin', async () => {
    const customer = await customers.create({
      name: 'Portal Customer',
      email: 'portal-customer@example.test',
      countryCode: 'ID',
    })
    const [admin] = await database
      .insert(schema.users)
      .values({
        name: 'Root Admin',
        email: 'root@example.test',
        emailVerified: true,
        role: 'super_admin',
      })
      .returning()
    if (!admin) throw new Error('Failed to prepare admin test user.')

    const portalUser = await userService.create(
      {
        name: 'Customer User',
        email: 'portal@example.test',
        password: 'integration-password-123',
        role: 'customer',
        customerId: customer.id,
      },
      admin.id,
    )
    expect(portalUser).toMatchObject({ role: 'customer', customerId: customer.id })

    await expect(
      userService.updateAccess(admin.id, { role: 'admin' }, admin.id),
    ).rejects.toMatchObject({ code: 'STATE_INVALID' })
  })
})
