import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import {
  applicationReleases,
  containerRegistries,
  customers,
  deployableApplications,
  infrastructureNodes,
  infrastructureOperations,
  infrastructureResources,
  infrastructureTemplates,
  invoiceItems,
  invoices,
  plans,
  resourceRoutes,
  serviceResources,
  services,
  settings,
} from './schema'

if (process.env.NODE_ENV === 'production') {
  throw new Error('Development seed is disabled in production.')
}

const databaseUrl = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('NUXT_DATABASE_URL (or legacy DATABASE_URL) is required.')
}

const pool = new pg.Pool({ connectionString: databaseUrl })
const database = drizzle(pool)
const now = new Date()
const today = dateInTimeZone(now, 'Asia/Makassar')
const imageDigest = `sha256:${'d'.repeat(64)}`
const imageRepository = 'registry.example.test/demo/customer-status-app'
const imageReference = `${imageRepository}@${imageDigest}`

const demoPlans = [
  {
    id: '11000000-0000-4000-8000-000000000001',
    name: 'Demo Starter',
    description: 'Paket simulasi untuk satu instance aplikasi kecil.',
    priceAmount: 99_000n,
    inclusions: ['1 aplikasi', '0,25 vCPU', 'RAM 256 MiB'],
    includedResourceCount: 1,
    includedCpuCores: '0.250',
    includedMemoryBytes: 268_435_456n,
  },
  {
    id: '11000000-0000-4000-8000-000000000002',
    name: 'Demo Growth',
    description: 'Paket simulasi dengan resource menengah.',
    priceAmount: 249_000n,
    inclusions: ['1 aplikasi', '0,5 vCPU', 'RAM 512 MiB'],
    includedResourceCount: 1,
    includedCpuCores: '0.500',
    includedMemoryBytes: 536_870_912n,
  },
  {
    id: '11000000-0000-4000-8000-000000000003',
    name: 'Demo Business',
    description: 'Paket simulasi dengan resource lebih besar.',
    priceAmount: 499_000n,
    inclusions: ['1 aplikasi', '1 vCPU', 'RAM 1 GiB'],
    includedResourceCount: 1,
    includedCpuCores: '1.000',
    includedMemoryBytes: 1_073_741_824n,
  },
] as const

const demoCustomers = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    customerNumber: 'CUS-000001',
    name: 'Ayu Pratama',
    companyName: 'Toko Langit Demo',
    email: 'ayu@demo.test',
    phone: '+62 811 0000 0001',
    city: 'Denpasar',
    province: 'Bali',
    notes: 'Customer simulasi dengan layanan berjalan normal.',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    customerNumber: 'CUS-000002',
    name: 'Bima Santoso',
    companyName: 'Klinik Sehat Demo',
    email: 'bima@demo.test',
    phone: '+62 811 0000 0002',
    city: 'Makassar',
    province: 'Sulawesi Selatan',
    notes: 'Customer simulasi dalam grace period karena invoice overdue.',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    customerNumber: 'CUS-000003',
    name: 'Citra Lestari',
    companyName: 'Studio Karya Demo',
    email: 'citra@demo.test',
    phone: '+62 811 0000 0003',
    city: 'Mataram',
    province: 'Nusa Tenggara Barat',
    notes: 'Customer simulasi dengan layanan dan aplikasi suspended.',
  },
] as const

try {
  await database.transaction(async (transaction) => {
    const planRows = []
    for (const plan of demoPlans) {
      const [row] = await transaction
        .insert(plans)
        .values({
          ...plan,
          currency: 'IDR',
          billingCycle: 'monthly',
          databaseMode: 'none',
          isActive: true,
        })
        .onConflictDoUpdate({
          target: plans.name,
          set: {
            description: plan.description,
            currency: 'IDR',
            priceAmount: plan.priceAmount,
            billingCycle: 'monthly',
            inclusions: [...plan.inclusions],
            includedResourceCount: plan.includedResourceCount,
            includedCpuCores: plan.includedCpuCores,
            includedMemoryBytes: plan.includedMemoryBytes,
            databaseMode: 'none',
            isActive: true,
            updatedAt: now,
          },
        })
        .returning()
      if (!row) throw new Error(`Failed to seed plan ${plan.name}.`)
      planRows.push(row)
    }

    const customerRows = []
    for (const customer of demoCustomers) {
      const [row] = await transaction
        .insert(customers)
        .values({ ...customer, countryCode: 'ID', status: 'active' })
        .onConflictDoUpdate({
          target: customers.customerNumber,
          set: {
            name: customer.name,
            companyName: customer.companyName,
            email: customer.email,
            phone: customer.phone,
            city: customer.city,
            province: customer.province,
            countryCode: 'ID',
            status: 'active',
            notes: customer.notes,
            updatedAt: now,
          },
        })
        .returning()
      if (!row) throw new Error(`Failed to seed customer ${customer.customerNumber}.`)
      customerRows.push(row)
    }

    const serviceStates = [
      {
        id: '12000000-0000-4000-8000-000000000001',
        serviceNumber: 'SVC-000001',
        state: 'normal',
        status: 'active' as const,
        description: 'Aplikasi demo berjalan normal dan invoice sudah dibayar.',
        suspendedAt: null,
        suspensionReason: null,
      },
      {
        id: '12000000-0000-4000-8000-000000000002',
        serviceNumber: 'SVC-000002',
        state: 'grace',
        status: 'active' as const,
        description: 'Aplikasi tetap berjalan selama grace period invoice overdue.',
        suspendedAt: null,
        suspensionReason: null,
      },
      {
        id: '12000000-0000-4000-8000-000000000003',
        serviceNumber: 'SVC-000003',
        state: 'blocked',
        status: 'active' as const,
        description: 'Aplikasi tetap berjalan, tetapi akses diblokir oleh billing gate.',
        suspendedAt: null,
        suspensionReason: null,
      },
    ]

    const serviceRows = []
    for (const [index, serviceState] of serviceStates.entries()) {
      const plan = planRows[index]!
      const customer = customerRows[index]!
      const [row] = await transaction
        .insert(services)
        .values({
          id: serviceState.id,
          customerId: customer.id,
          planId: plan.id,
          planName: plan.name,
          planInclusions: plan.inclusions,
          planResourceCount: plan.includedResourceCount,
          planCpuCores: plan.includedCpuCores,
          planMemoryBytes: plan.includedMemoryBytes,
          planDatabaseMode: plan.databaseMode,
          serviceNumber: serviceState.serviceNumber,
          name: 'Customer Status Demo',
          description: serviceState.description,
          status: serviceState.status,
          currency: plan.currency,
          priceAmount: plan.priceAmount,
          billingCycle: plan.billingCycle,
          billingStartDate: addDays(today, -30),
          nextDueDate: addDays(today, 30),
          invoiceLeadDays: 7,
          paymentDueDays: 7,
          suspendedAt: serviceState.suspendedAt,
          suspensionReason: serviceState.suspensionReason,
        })
        .onConflictDoUpdate({
          target: services.serviceNumber,
          set: {
            customerId: customer.id,
            planId: plan.id,
            planName: plan.name,
            planInclusions: plan.inclusions,
            planResourceCount: plan.includedResourceCount,
            planCpuCores: plan.includedCpuCores,
            planMemoryBytes: plan.includedMemoryBytes,
            planDatabaseMode: plan.databaseMode,
            name: 'Customer Status Demo',
            description: serviceState.description,
            status: serviceState.status,
            currency: plan.currency,
            priceAmount: plan.priceAmount,
            billingCycle: plan.billingCycle,
            billingStartDate: addDays(today, -30),
            nextDueDate: addDays(today, 30),
            invoiceLeadDays: 7,
            paymentDueDays: 7,
            suspendedAt: serviceState.suspendedAt,
            suspensionReason: serviceState.suspensionReason,
            cancelledAt: null,
            cancellationReason: null,
            updatedAt: now,
          },
        })
        .returning()
      if (!row) throw new Error(`Failed to seed service ${serviceState.serviceNumber}.`)
      serviceRows.push(row)
    }

    const invoiceScenarios = [
      {
        id: '13000000-0000-4000-8000-000000000001',
        itemId: '14000000-0000-4000-8000-000000000001',
        number: 'INV-DEMO-PAID',
        status: 'paid' as const,
        issueDate: addDays(today, -35),
        dueDate: addDays(today, -28),
        paid: true,
        notes: 'Skenario normal: invoice sudah dibayar.',
      },
      {
        id: '13000000-0000-4000-8000-000000000002',
        itemId: '14000000-0000-4000-8000-000000000002',
        number: 'INV-DEMO-GRACE',
        status: 'overdue' as const,
        issueDate: addDays(today, -10),
        dueDate: addDays(today, -3),
        paid: false,
        notes: 'Skenario grace: overdue 3 hari dari grace period 7 hari.',
      },
      {
        id: '13000000-0000-4000-8000-000000000003',
        itemId: '14000000-0000-4000-8000-000000000003',
        number: 'INV-DEMO-SUSPENDED',
        status: 'overdue' as const,
        issueDate: addDays(today, -17),
        dueDate: addDays(today, -10),
        paid: false,
        notes: 'Skenario suspended: overdue melewati grace period 7 hari.',
      },
    ]

    for (const [index, scenario] of invoiceScenarios.entries()) {
      const customer = customerRows[index]!
      const service = serviceRows[index]!
      const amount = service.priceAmount
      const [existingInvoice] = await transaction
        .select({ status: invoices.status })
        .from(invoices)
        .where(eq(invoices.invoiceNumber, scenario.number))
        .limit(1)
      const preservePaidState = existingInvoice?.status === 'paid'
      const [invoice] = await transaction
        .insert(invoices)
        .values({
          id: scenario.id,
          customerId: customer.id,
          invoiceNumber: scenario.number,
          status: scenario.status,
          currency: 'IDR',
          issueDate: scenario.issueDate,
          dueDate: scenario.dueDate,
          subtotalAmount: amount,
          totalAmount: amount,
          amountPaid: scenario.paid ? amount : 0n,
          balanceDue: scenario.paid ? 0n : amount,
          customerName: customer.name,
          customerCompanyName: customer.companyName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          customerAddress: `${customer.city}, ${customer.province}`,
          sellerName: 'OC Infrastructure Demo',
          notes: scenario.notes,
          issuedAt: new Date(`${scenario.issueDate}T00:00:00+08:00`),
          paidAt: scenario.paid ? new Date(`${scenario.dueDate}T00:00:00+08:00`) : null,
        })
        .onConflictDoUpdate({
          target: invoices.invoiceNumber,
          set: {
            customerId: customer.id,
            customerName: customer.name,
            customerCompanyName: customer.companyName,
            customerEmail: customer.email,
            customerPhone: customer.phone,
            customerAddress: `${customer.city}, ${customer.province}`,
            notes: scenario.notes,
            ...(preservePaidState
              ? {}
              : {
                  status: scenario.status,
                  issueDate: scenario.issueDate,
                  dueDate: scenario.dueDate,
                  subtotalAmount: amount,
                  totalAmount: amount,
                  amountPaid: scenario.paid ? amount : 0n,
                  balanceDue: scenario.paid ? 0n : amount,
                  issuedAt: new Date(`${scenario.issueDate}T00:00:00+08:00`),
                  paidAt: scenario.paid ? new Date(`${scenario.dueDate}T00:00:00+08:00`) : null,
                }),
            updatedAt: now,
          },
        })
        .returning({ id: invoices.id })
      if (!invoice) throw new Error(`Failed to seed invoice ${scenario.number}.`)

      await transaction
        .insert(invoiceItems)
        .values({
          id: scenario.itemId,
          invoiceId: invoice.id,
          serviceId: service.id,
          description: `Customer Status Demo - ${service.planName}`,
          unitPriceAmount: amount,
          subtotalAmount: amount,
          totalAmount: amount,
          servicePeriodStart: addDays(scenario.issueDate, -30),
          servicePeriodEnd: scenario.issueDate,
          metadata: { simulationState: serviceStates[index]!.state },
        })
        .onConflictDoUpdate({
          target: invoiceItems.id,
          set: {
            invoiceId: invoice.id,
            serviceId: service.id,
            description: `Customer Status Demo - ${service.planName}`,
            unitPriceAmount: amount,
            subtotalAmount: amount,
            totalAmount: amount,
            servicePeriodStart: addDays(scenario.issueDate, -30),
            servicePeriodEnd: scenario.issueDate,
            metadata: { simulationState: serviceStates[index]!.state },
          },
        })
    }

    const [node] = await transaction
      .insert(infrastructureNodes)
      .values({
        id: '20000000-0000-4000-8000-000000000001',
        name: 'demo-simulation',
        environment: 'development',
        status: 'online',
        isActive: true,
        agentVersion: '0.10.0-demo',
        protocolVersion: '1',
        osRelease: 'Ubuntu 24.04 (simulated)',
        architecture: 'amd64',
        dockerVersion: 'simulated',
        composeVersion: 'simulated',
        gatewayStatus: 'healthy',
        capacityCpuMilli: 4_000,
        capacityMemoryBytes: 8_589_934_592n,
        capacityDiskBytes: 107_374_182_400n,
        cpuUsageBasisPoints: 1_250,
        memoryUsedBytes: 1_610_612_736n,
        diskUsedBytes: 12_884_901_888n,
        diskUsageBasisPoints: 1_200,
        utilizationObservedAt: now,
        labels: { simulation: 'true', region: 'local' },
        lastHeartbeatAt: now,
        lastInventoryAt: now,
      })
      .onConflictDoUpdate({
        target: [infrastructureNodes.name, infrastructureNodes.environment],
        set: {
          status: 'online',
          isActive: true,
          gatewayStatus: 'healthy',
          utilizationObservedAt: now,
          labels: { simulation: 'true', region: 'local' },
          lastHeartbeatAt: now,
          lastInventoryAt: now,
          updatedAt: now,
        },
      })
      .returning()
    if (!node) throw new Error('Failed to seed simulation node.')

    const [registry] = await transaction
      .insert(containerRegistries)
      .values({
        id: '20000000-0000-4000-8000-000000000010',
        name: 'Demo registry (configure before use)',
        host: 'registry.example.test',
        username: 'demo',
        tokenEncrypted: 'simulation-only-not-a-real-credential',
        isActive: false,
      })
      .onConflictDoUpdate({
        target: containerRegistries.host,
        set: {
          name: 'Demo registry (configure before use)',
          username: 'demo',
          isActive: false,
          updatedAt: now,
        },
      })
      .returning()
    if (!registry) throw new Error('Failed to seed simulation registry.')

    const [application] = await transaction
      .insert(deployableApplications)
      .values({
        id: '20000000-0000-4000-8000-000000000011',
        name: 'Customer Status Demo',
        slug: 'customer-status-demo',
        repositoryUrl: 'https://github.com/mbx92/billEngine.git',
        defaultBranch: 'main',
        dockerfilePath: 'examples/customer-demo-app/Dockerfile',
        buildContext: 'examples/customer-demo-app',
        imageRepository,
        registryId: registry.id,
        autoDeploy: false,
      })
      .onConflictDoUpdate({
        target: deployableApplications.slug,
        set: {
          name: 'Customer Status Demo',
          repositoryUrl: 'https://github.com/mbx92/billEngine.git',
          defaultBranch: 'main',
          dockerfilePath: 'examples/customer-demo-app/Dockerfile',
          buildContext: 'examples/customer-demo-app',
          imageRepository,
          registryId: registry.id,
          autoDeploy: false,
          updatedAt: now,
        },
      })
      .returning()
    if (!application) throw new Error('Failed to seed demo application.')

    const [release] = await transaction
      .insert(applicationReleases)
      .values({
        id: '20000000-0000-4000-8000-000000000012',
        applicationId: application.id,
        version: 'demo-1.0.0',
        commitSha: 'd000000000000000000000000000000000000001',
        imageDigest,
        imageReference,
      })
      .onConflictDoUpdate({
        target: [applicationReleases.applicationId, applicationReleases.version],
        set: { commitSha: 'd000000000000000000000000000000000000001', imageDigest, imageReference },
      })
      .returning()
    if (!release) throw new Error('Failed to seed demo release.')

    const [template] = await transaction
      .insert(infrastructureTemplates)
      .values({
        id: '20000000-0000-4000-8000-000000000013',
        slug: 'customer-status-demo-web',
        name: 'Customer Status Demo Web',
        description: 'Satu image demo yang dapat digunakan ulang untuk banyak customer.',
        category: 'application',
        version: 1,
        applicationId: application.id,
        releasePolicy: 'track_latest',
        isBuiltin: false,
        isActive: true,
        definition: {
          engine: 'generic',
          resourceKind: 'application',
          spec: {
            source: { type: 'image', reference: imageReference },
            limits: { cpuMilli: 250, memoryBytes: '268435456' },
            ports: [{ containerPort: 3000, protocol: 'tcp' }],
            volumes: [],
            restartPolicy: 'unless-stopped',
            healthcheck: { path: '/health', port: 3000, intervalSeconds: 30, timeoutSeconds: 5 },
          },
          parameters: [
            {
              key: 'customerName',
              label: 'Customer name',
              environmentKey: 'CUSTOMER_NAME',
              type: 'string',
              required: true,
              generated: false,
            },
            {
              key: 'serviceState',
              label: 'Service state',
              environmentKey: 'SERVICE_STATE',
              type: 'string',
              required: true,
              generated: false,
              defaultValue: 'normal',
            },
          ],
        },
      })
      .onConflictDoUpdate({
        target: infrastructureTemplates.slug,
        set: {
          name: 'Customer Status Demo Web',
          description: 'Satu image demo yang dapat digunakan ulang untuk banyak customer.',
          applicationId: application.id,
          releasePolicy: 'track_latest',
          isActive: true,
          updatedAt: now,
        },
      })
      .returning()
    if (!template) throw new Error('Failed to seed demo template.')

    const resourceRows = []
    for (const [index, serviceState] of serviceStates.entries()) {
      const customer = customerRows[index]!
      const desiredSpec = {
        source: { type: 'image', reference: imageReference },
        limits: {
          cpuMilli: Number(planRows[index]!.includedCpuCores) * 1_000,
          memoryBytes: planRows[index]!.includedMemoryBytes?.toString(),
        },
        ports: [{ containerPort: 3000, protocol: 'tcp' }],
        environment: {
          CUSTOMER_NAME: customer.companyName ?? customer.name,
          SERVICE_NUMBER: serviceState.serviceNumber,
          SERVICE_STATE: serviceState.state,
        },
        secretReferences: {},
        volumes: [],
        restartPolicy: 'unless-stopped',
        healthcheck: { path: '/health', port: 3000, intervalSeconds: 30, timeoutSeconds: 5 },
      }
      const externalId = `demo-customer-${index + 1}`
      const [resource] = await transaction
        .insert(infrastructureResources)
        .values({
          id: `20000000-0000-4000-8000-00000000002${index + 1}`,
          nodeId: node.id,
          customerId: customer.id,
          templateId: template.id,
          templateVersion: template.version,
          applicationId: application.id,
          releaseId: release.id,
          releasePolicy: 'track_latest',
          externalId,
          kind: 'application',
          name: `customer-status-${index + 1}`,
          classification: 'billable',
          desiredState: 'running',
          observedState: 'running',
          desiredRevision: 1,
          observedRevision: 1,
          imageReference,
          imageDigest,
          desiredSpec,
          observedSpec: desiredSpec,
          labels: {
            'oc.managed': 'true',
            'oc.simulation': 'true',
            'oc.application': application.slug,
            'oc.customer': customer.customerNumber,
          },
          lastObservedAt: now,
        })
        .onConflictDoUpdate({
          target: [infrastructureResources.nodeId, infrastructureResources.externalId],
          set: {
            customerId: customer.id,
            templateId: template.id,
            templateVersion: template.version,
            applicationId: application.id,
            releaseId: release.id,
            releasePolicy: 'track_latest',
            name: `customer-status-${index + 1}`,
            classification: 'billable',
            desiredState: 'running',
            observedState: 'running',
            desiredRevision: 1,
            observedRevision: 1,
            imageReference,
            imageDigest,
            desiredSpec,
            observedSpec: desiredSpec,
            labels: {
              'oc.managed': 'true',
              'oc.simulation': 'true',
              'oc.application': application.slug,
              'oc.customer': customer.customerNumber,
            },
            lastObservedAt: now,
            deletedAt: null,
            updatedAt: now,
          },
        })
        .returning()
      if (!resource) throw new Error(`Failed to seed demo resource ${externalId}.`)
      resourceRows.push(resource)

      await transaction
        .insert(serviceResources)
        .values({ serviceId: serviceRows[index]!.id, resourceId: resource.id })
        .onConflictDoNothing({ target: [serviceResources.serviceId, serviceResources.resourceId] })

      await transaction
        .insert(resourceRoutes)
        .values({
          id: `20000000-0000-4000-8000-00000000003${index + 1}`,
          resourceId: resource.id,
          hostname: `customer-${index + 1}.demo.localhost`,
          targetPort: 3000,
          tlsEnabled: false,
          billingGateEnabled: true,
          middleware: ['billing-gate'],
          desiredStatus: 'active',
          observedStatus: 'active',
          lastObservedAt: now,
        })
        .onConflictDoUpdate({
          target: resourceRoutes.hostname,
          set: {
            resourceId: resource.id,
            targetPort: 3000,
            tlsEnabled: false,
            billingGateEnabled: true,
            middleware: ['billing-gate'],
            desiredStatus: 'active',
            observedStatus: 'active',
            lastObservedAt: now,
            updatedAt: now,
          },
        })
    }

    for (const [index, resource] of resourceRows.entries()) {
      await transaction
        .insert(infrastructureOperations)
        .values({
          id: `20000000-0000-4000-8000-00000000004${index + 1}`,
          nodeId: node.id,
          resourceId: resource.id,
          idempotencyKey: `demo-seed:application.ensure:${index + 1}`,
          action: 'application.ensure',
          status: 'succeeded',
          expectedResourceRevision: 1,
          payload: { simulation: true, customer: demoCustomers[index]!.customerNumber },
          result: { containerId: `demo-container-${index + 1}` },
          attemptCount: 1,
          maxAttempts: 5,
          nextAttemptAt: now,
          expiresAt: new Date(now.getTime() + 15 * 60_000),
          startedAt: now,
          completedAt: now,
        })
        .onConflictDoUpdate({
          target: infrastructureOperations.idempotencyKey,
          set: {
            nodeId: node.id,
            resourceId: resource.id,
            status: 'succeeded',
            result: { containerId: `demo-container-${index + 1}` },
            attemptCount: 1,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          },
        })
    }

    const [storedSettings] = await transaction
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'billing.configuration'))
      .limit(1)
    const existingSettings = isRecord(storedSettings?.value) ? storedSettings.value : {}
    const demoSettings = {
      companyName: 'OC Infrastructure Demo',
      companyEmail: 'billing@demo.test',
      companyAddress: 'Development environment',
      companyTaxId: null,
      billingTimezone: 'Asia/Makassar',
      billingCurrency: 'IDR',
      defaultTaxRate: null,
      billingAutomationEnabled: false,
      graceNoticeIntervalHours: 24,
      ...existingSettings,
      billingAccessControlEnabled: true,
      overdueGraceDays: 7,
    }
    await transaction
      .insert(settings)
      .values({ key: 'billing.configuration', isSecret: false, value: demoSettings })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: demoSettings, isSecret: false, updatedAt: now },
      })
  })

  console.info('Development simulation seeded: 3 customers, 3 plans, 3 services, 1 shared app.')
} finally {
  await pool.end()
}

function dateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
