import type {
  BillingCycle,
  CustomerStatus,
  InvoiceStatus,
  PaymentStatus,
  ResourceClassification,
  ResourceStatus,
  ServiceStatus,
} from '../constants/domain'

export type { ResourceClassification, ServiceStatus }

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface Paginated<T> {
  data: T[]
  meta: {
    page: number
    perPage: number
    total: number
    totalPages: number
  }
}

/**
 * Money and byte counts are serialized as decimal strings.
 * PostgreSQL `bigint` columns are read as BigInt by Drizzle, and Nitro cannot
 * JSON-serialize BigInt, so the API boundary always converts them to strings.
 */
export type DecimalString = string

export interface ApiCustomer {
  id: string
  customerNumber: string
  name: string
  companyName: string | null
  email: string
  status: CustomerStatus
  city: string | null
  countryCode: string
  totalServiceCount: number
  activeServiceCount: number
  createdAt: string
}

export interface ApiServiceResourceLink {
  id: string
  name: string
  status: ResourceStatus
}

export interface ApiService {
  id: string
  serviceNumber: string
  name: string
  status: ServiceStatus
  currency: string
  priceAmount: DecimalString
  billingCycle: BillingCycle
  billingStartDate: string
  nextDueDate: string | null
  customerId: string
  customerName: string
  customerNumber: string
  resources: ApiServiceResourceLink[]
}

export interface ApiServiceOptions {
  customers: Array<{
    id: string
    customerNumber: string
    name: string
    companyName: string | null
    email: string
  }>
  resources: Array<{
    id: string
    name: string
    status: ResourceStatus
    serverName: string
    projectName: string | null
    environmentName: string | null
  }>
}

export interface ApiResourceServiceLink {
  id: string
  serviceNumber: string
  name: string
}

export interface ApiResourceListItem {
  id: string
  name: string
  coolifyUuid: string
  resourceType: string
  status: ResourceStatus
  classification: ResourceClassification
  fqdn: string | null
  projectName: string | null
  environmentName: string | null
  nodeName: string | null
  serverId: string
  serverName: string
  limitsCpus: string | null
  limitsMemoryBytes: DecimalString | null
  lastSeenAt: string | null
  services: ApiResourceServiceLink[]
}

export interface ApiResourceServer {
  id: string
  name: string
  baseUrl: string
  status: string
  isActive: boolean
  lastSyncedAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  resourceCount: number
  credentialSource: 'stored' | 'environment' | 'missing'
  nodes: ApiCoolifyNode[]
}

export interface ApiCoolifyNode {
  id: string
  coolifyUuid: string
  name: string
  address: string | null
  sshPort: number | null
  status: string
  isReachable: boolean
  isUsable: boolean
  isCoolifyHost: boolean
  resourceCount: number
  lastSeenAt: string | null
}

export interface ApiResourceSummary {
  total: number
  running: number
  stopped: number
  degraded: number
  unknown: number
  billable: number
  internal: number
  ignored: number
  notBilled: number
  totalCpuCores: DecimalString | null
  totalMemoryBytes: DecimalString | null
  lastSyncedAt: string | null
}

export interface ApiResourceListResponse {
  data: ApiResourceListItem[]
  summary: ApiResourceSummary
  meta: Paginated<never>['meta']
}

export type ResourceMetricsStatus =
  'available' | 'disabled' | 'unreachable' | 'no_data' | 'unsupported'

export interface ApiResourceUsageMetric {
  resourceId: string
  status: ResourceMetricsStatus
  cpuPercent: number | null
  memoryUsageBytes: DecimalString | null
  sampledAt: string | null
}

export interface ApiResourceMetricsResponse {
  data: ApiResourceUsageMetric[]
}

export interface ApiCoolifySyncResult {
  serverId: string
  processedCount: number
  nodeCount: number
  syncedAt: string
}

export interface ApiActivityListResponse {
  data: ApiActivityEntry[]
  jobRuns: ApiJobRun[]
  meta: Paginated<never>['meta']
}

export interface ApiActivityEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  actorName: string | null
  actorEmail: string | null
  createdAt: string
}

export interface ApiJobRun {
  id: string
  jobName: string
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  finishedAt: string | null
  processedCount: number
  errorMessage: string | null
}

export interface ApiDashboard {
  revenue: {
    monthlyRecurring: DecimalString
    currency: string
  }
  customers: {
    total: number
    active: number
  }
  invoices: {
    open: number
    overdue: number
    unpaidBalance: DecimalString
  }
  resources: {
    total: number
    running: number
    billable: number
    notBilled: number
    lastSyncedAt: string | null
  }
  capacity: {
    cpuCores: DecimalString | null
    memoryBytes: DecimalString | null
    resourceCount: number
  }
}

export interface ApiBillingSettings {
  companyName: string
  companyEmail: string | null
  companyAddress: string | null
  companyTaxId: string | null
  billingTimezone: string
  billingCurrency: string
  defaultTaxRate: string | null
  billingAutomationEnabled: boolean
  source: 'environment' | 'database'
  updatedAt: string | null
}

export interface ApiManualInvoiceOptions {
  customers: Array<{
    id: string
    customerNumber: string
    name: string
    companyName: string | null
    email: string
  }>
  services: Array<{
    id: string
    serviceNumber: string
    name: string
    customerId: string
    currency: string
    priceAmount: DecimalString
    billingCycle: BillingCycle
    nextDueDate: string | null
  }>
}

export interface ApiInvoiceListItem {
  id: string
  invoiceNumber: string
  status: InvoiceStatus
  currency: string
  issueDate: string
  dueDate: string
  totalAmount: DecimalString
  amountPaid: DecimalString
  balanceDue: DecimalString
  customerId: string
  customerName: string
  customerCompanyName: string | null
  daysPastDue: number
}

export interface ApiInvoiceSummary {
  counts: Record<InvoiceStatus, number>
  currencies: Array<{ currency: string; balance: DecimalString }>
}

export interface ApiInvoiceListResponse {
  data: ApiInvoiceListItem[]
  summary: ApiInvoiceSummary
  meta: Paginated<never>['meta']
}

export interface ApiInvoiceItem {
  id: string
  serviceId: string | null
  description: string
  quantity: string
  unitPriceAmount: DecimalString
  subtotalAmount: DecimalString
  taxRate: string | null
  taxAmount: DecimalString
  totalAmount: DecimalString
  servicePeriodStart: string | null
  servicePeriodEnd: string | null
}

export interface ApiPayment {
  id: string
  paymentNumber: string
  status: PaymentStatus
  amount: DecimalString
  currency: string
  method: string
  reference: string | null
  notes: string | null
  paidAt: string
  recordedByName: string | null
}

export interface ApiInvoiceDetail {
  invoice: ApiInvoiceListItem & {
    subtotalAmount: DecimalString
    taxAmount: DecimalString
    notes: string | null
    issuedAt: string | null
    paidAt: string | null
    cancelledAt: string | null
    customerEmail: string
    customerPhone: string | null
    customerAddress: string | null
    customerTaxId: string | null
    sellerName: string
    sellerAddress: string | null
    sellerEmail: string | null
    sellerTaxId: string | null
  }
  items: ApiInvoiceItem[]
  payments: ApiPayment[]
}

export interface ApiPaymentListItem extends ApiPayment {
  invoiceId: string
  invoiceNumber: string
  customerName: string
  customerCompanyName: string | null
}

export interface ApiPaymentListResponse {
  data: ApiPaymentListItem[]
  meta: Paginated<never>['meta']
}

export interface ApiPaymentInvoiceOption {
  id: string
  invoiceNumber: string
  status: Extract<InvoiceStatus, 'unpaid' | 'overdue'>
  currency: string
  balanceDue: DecimalString
  dueDate: string
  customerName: string
  customerCompanyName: string | null
}

export interface ApiRecurringRunResult {
  asOf: string
  processed: number
  created: Array<{ serviceId: string; invoiceId: string; invoiceNumber: string }>
  skipped: Array<{ serviceId: string; reason: string }>
  jobRunId: string | null
}
