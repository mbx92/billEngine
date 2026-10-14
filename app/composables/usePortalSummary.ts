import type { InvoiceStatus } from '#shared/constants/domain'
import type { ApiPortalSummary } from '#shared/types/api'

export async function usePortalSummary() {
  const format = useFormat()
  const { data, status, error, refresh } = await useFetch<{ data: ApiPortalSummary }>(
    '/api/portal/summary',
  )
  const portal = computed(() => data.value?.data)
  const invoices = computed(() => portal.value?.invoices ?? [])
  const services = computed(() => portal.value?.services ?? [])
  const openInvoices = computed(() =>
    invoices.value.filter((invoice) => invoice.status === 'unpaid' || invoice.status === 'overdue'),
  )
  const overdueInvoices = computed(() =>
    invoices.value.filter((invoice) => invoice.status === 'overdue'),
  )
  const activeServices = computed(() =>
    services.value.filter((service) => service.status === 'active'),
  )
  const openBalanceLabel = computed(() => {
    const balances = portal.value?.openBalance ?? []
    if (balances.length === 0) return null
    return balances.map((row) => format.money(row.amount, row.currency)).join(' · ')
  })

  return {
    format,
    portal,
    invoices,
    services,
    openInvoices,
    overdueInvoices,
    activeServices,
    openBalanceLabel,
    status,
    error,
    refresh,
  }
}

export function invoiceFilterTabs(invoices: ApiPortalSummary['invoices']) {
  const counts = {
    unpaid: 0,
    overdue: 0,
    paid: 0,
    cancelled: 0,
    draft: 0,
  }
  for (const invoice of invoices) counts[invoice.status] += 1

  return [
    { value: '' as const, label: 'Semua', count: invoices.length },
    { value: 'unpaid' as InvoiceStatus, label: 'Belum dibayar', count: counts.unpaid },
    { value: 'overdue' as InvoiceStatus, label: 'Jatuh tempo', count: counts.overdue },
    { value: 'paid' as InvoiceStatus, label: 'Lunas', count: counts.paid },
    { value: 'cancelled' as InvoiceStatus, label: 'Dibatalkan', count: counts.cancelled },
  ]
}
