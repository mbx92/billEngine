import { addDays } from '../billing/cycles'
import { generateInvoicePdf } from '../invoices/invoice-pdf-service'
import { InvoiceRepository } from '../../repositories/invoices'
import { EmailDeliveryRepository } from '../../repositories/email-deliveries'
import { ResendEmailClient } from '../../integrations/email/resend-client'
import { DomainError } from '../../utils/errors'

type EmailKind = 'invoice_issued' | 'due_reminder' | 'overdue_reminder'

export class EmailNotificationService {
  constructor(
    private readonly invoices = new InvoiceRepository(),
    private readonly deliveries = new EmailDeliveryRepository(),
  ) {}

  async sendInvoice(invoiceId: string, kind: EmailKind, idempotencySuffix?: string) {
    const config = useRuntimeConfig()
    if (!config.resendApiKey || !config.emailFrom) {
      throw DomainError.invalidState(
        'Email belum dikonfigurasi. Isi NUXT_RESEND_API_KEY dan NUXT_EMAIL_FROM.',
      )
    }

    const detail = await this.invoices.findDetail(invoiceId)
    if (!detail) throw DomainError.notFound('Invoice tidak ditemukan.')
    if (detail.invoice.status === 'draft' || detail.invoice.status === 'cancelled') {
      throw DomainError.invalidState('Invoice ini tidak dapat dikirim.')
    }

    const subject = emailSubject(kind, detail.invoice.invoiceNumber, detail.invoice.dueDate)
    const idempotencyKey = [kind, invoiceId, idempotencySuffix].filter(Boolean).join(':')
    const delivery = await this.deliveries.reserve({
      invoiceId,
      kind,
      recipient: detail.invoice.customerEmail,
      subject,
      idempotencyKey,
    })
    if (delivery.status === 'sent') return { status: 'already_sent' as const, delivery }

    await this.deliveries.markAttempt(delivery.id)
    try {
      const pdf = await generateInvoicePdf(detail)
      const result = await new ResendEmailClient(String(config.resendApiKey)).send({
        from: String(config.emailFrom),
        to: detail.invoice.customerEmail,
        subject,
        html: invoiceEmailHtml(kind, detail.invoice),
        idempotencyKey,
        attachment: {
          filename: `${detail.invoice.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`,
          content: pdf.toString('base64'),
        },
      })
      await this.deliveries.markSent(delivery.id, result.id)
      return { status: 'sent' as const, deliveryId: delivery.id }
    } catch (error) {
      await this.deliveries.markFailed(delivery.id, error)
      throw error
    }
  }

  async sendReminders(asOf: string) {
    const candidates = await this.invoices.listReminderCandidates(addDays(asOf, 3))
    const result = { sent: 0, skipped: 0, failed: 0 }

    for (const invoice of candidates) {
      const kind: EmailKind = invoice.dueDate < asOf ? 'overdue_reminder' : 'due_reminder'
      try {
        const delivery = await this.sendInvoice(invoice.id, kind, asOf)
        if (delivery.status === 'sent') result.sent += 1
        else result.skipped += 1
      } catch {
        result.failed += 1
      }
    }

    return result
  }
}

function emailSubject(kind: EmailKind, invoiceNumber: string, dueDate: string) {
  if (kind === 'due_reminder') return `Pengingat invoice ${invoiceNumber} jatuh tempo ${dueDate}`
  if (kind === 'overdue_reminder') return `Invoice ${invoiceNumber} telah jatuh tempo`
  return `Invoice ${invoiceNumber}`
}

function invoiceEmailHtml(
  kind: EmailKind,
  invoice: {
    customerName: string
    invoiceNumber: string
    currency: string
    totalAmount: bigint
    balanceDue: bigint
    dueDate: string
    sellerName: string
  },
) {
  const intro =
    kind === 'overdue_reminder'
      ? 'Invoice berikut telah melewati tanggal jatuh tempo.'
      : kind === 'due_reminder'
        ? 'Ini adalah pengingat untuk invoice yang akan jatuh tempo.'
        : 'Invoice terbaru Anda terlampir pada email ini.'

  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17202b">
    <p>Halo ${escapeHtml(invoice.customerName)},</p>
    <p>${intro}</p>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 16px 4px 0">Invoice</td><td><strong>${escapeHtml(invoice.invoiceNumber)}</strong></td></tr>
      <tr><td style="padding:4px 16px 4px 0">Total</td><td>${escapeHtml(invoice.currency)} ${invoice.totalAmount.toString()}</td></tr>
      <tr><td style="padding:4px 16px 4px 0">Sisa</td><td>${escapeHtml(invoice.currency)} ${invoice.balanceDue.toString()}</td></tr>
      <tr><td style="padding:4px 16px 4px 0">Jatuh tempo</td><td>${escapeHtml(invoice.dueDate)}</td></tr>
    </table>
    <p>Terima kasih,<br>${escapeHtml(invoice.sellerName)}</p>
  </div>`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
