import PDFDocument from 'pdfkit'
import { billingPeriodMonths, monthlyEquivalent } from '../../../shared/utils/billing-display'
import type { InvoiceRepository } from '../../repositories/invoices'

type InvoiceDetail = NonNullable<Awaited<ReturnType<InvoiceRepository['findDetail']>>>
type PdfDocument = PDFKit.PDFDocument

const COLORS = {
  ink: '#17202b',
  muted: '#667386',
  line: '#dce2e8',
  soft: '#f4f6f8',
  zebra: '#f7f9fb',
  brand: '#15803d',
  brandSoft: '#ecf8ef',
  brandInk: '#166534',
  info: '#1d4ed8',
  warning: '#b45309',
  danger: '#be123c',
  white: '#ffffff',
}

const LAYOUT = {
  pageWidth: 595.28,
  left: 40,
  right: 555,
  width: 515,
  contentTop: 36,
  pageBreakY: 758,
  footerLineY: 778,
  footerTextY: 788,
}

const TABLE = {
  description: { x: 52, width: 208 },
  quantity: { x: 260, width: 42 },
  unit: { x: 302, width: 88 },
  tax: { x: 390, width: 50 },
  total: { x: 440, width: 103 },
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'DRAFT',
  unpaid: 'BELUM DIBAYAR',
  paid: 'LUNAS',
  overdue: 'JATUH TEMPO',
  cancelled: 'DIBATALKAN',
}

const STATUS_COLORS: Record<string, string> = {
  draft: COLORS.muted,
  unpaid: COLORS.info,
  paid: COLORS.brand,
  overdue: COLORS.warning,
  cancelled: COLORS.danger,
}

export async function generateInvoicePdf(detail: InvoiceDetail): Promise<Buffer> {
  const { invoice } = detail
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: LAYOUT.contentTop, right: 40, bottom: 0, left: 40 },
    bufferPages: true,
    info: {
      Title: `Invoice ${invoice.invoiceNumber}`,
      Author: invoice.sellerName,
      Subject: `Invoice untuk ${invoice.customerCompanyName || invoice.customerName}`,
      Keywords: 'invoice, billing',
      CreationDate: invoice.issuedAt ?? invoice.createdAt,
    },
  })

  const chunks: Buffer[] = []
  document.on('data', (chunk: Buffer) => chunks.push(chunk))
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.on('error', reject)
  })

  drawHeader(document, detail)
  drawFacts(document, detail)
  drawParties(document, detail)
  drawItems(document, detail)
  drawSummary(document, detail)
  drawPageChrome(document, invoice.invoiceNumber)
  document.end()

  return completed
}

function drawHeader(document: PdfDocument, detail: InvoiceDetail) {
  const { invoice } = detail
  const markSize = 28
  const markX = LAYOUT.left
  const markY = 28

  fillRect(document, markX, markY, markSize, markSize, COLORS.brandSoft)
  document
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.brandInk)
    .text(sellerInitials(invoice.sellerName), markX, markY + 9, {
      width: markSize,
      align: 'center',
      lineBreak: false,
    })

  const sellerX = markX + markSize + 10
  const sellerWidth = 250
  document
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(COLORS.ink)
    .text(invoice.sellerName, sellerX, markY + 1, { width: sellerWidth })
  const sellerNameBottom = document.y
  const sellerMeta = compactLines([
    invoice.sellerAddress,
    invoice.sellerEmail,
    invoice.sellerTaxId ? `Tax ID ${invoice.sellerTaxId}` : null,
  ])
  document
    .font('Helvetica')
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(sellerMeta, sellerX, sellerNameBottom + 2, { width: sellerWidth, lineGap: 1.5 })
  const sellerBottom = document.y

  const rightWidth = 196
  const rightX = LAYOUT.right - rightWidth
  document
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(COLORS.ink)
    .text('INVOICE', rightX, markY, {
      width: rightWidth,
      align: 'right',
      characterSpacing: 1.2,
      lineBreak: false,
    })
  document
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(invoice.invoiceNumber, rightX, markY + 28, {
      width: rightWidth,
      align: 'right',
      lineBreak: false,
    })

  const status = STATUS_LABELS[invoice.status] ?? invoice.status.toUpperCase()
  const statusColor = STATUS_COLORS[invoice.status] ?? COLORS.muted
  document.font('Helvetica-Bold').fontSize(7)
  const statusWidth = Math.min(rightWidth, Math.max(72, document.widthOfString(status) + 16))
  const statusX = LAYOUT.right - statusWidth
  fillRect(document, statusX, markY + 46, statusWidth, 18, statusColor)
  document
    .fillColor(COLORS.white)
    .text(status, statusX, markY + 51, { width: statusWidth, align: 'center', lineBreak: false })

  document.y = Math.max(sellerBottom, markY + 72) + 16
}

function drawFacts(document: PdfDocument, detail: InvoiceDetail) {
  const { invoice } = detail
  const height = 52
  const y = document.y
  const columns = [
    { title: 'TANGGAL INVOICE', value: formatDate(invoice.issueDate) },
    { title: 'JATUH TEMPO', value: formatDate(invoice.dueDate) },
    { title: 'MATA UANG', value: invoice.currency },
    { title: 'TOTAL TAGIHAN', value: formatMoney(invoice.totalAmount, invoice.currency) },
  ]
  const colWidth = LAYOUT.width / columns.length

  fillRect(document, LAYOUT.left, y, LAYOUT.width, height, COLORS.soft)

  columns.forEach((column, index) => {
    const x = LAYOUT.left + colWidth * index
    if (index > 0) {
      document
        .moveTo(x, y + 12)
        .lineTo(x, y + height - 12)
        .strokeColor(COLORS.line)
        .lineWidth(0.8)
        .stroke()
    }
    label(document, column.title, x + 14, y + 11)
    document
      .font(index === columns.length - 1 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(index === columns.length - 1 ? 10 : 9)
      .fillColor(index === columns.length - 1 ? COLORS.brandInk : COLORS.ink)
      .text(column.value, x + 14, y + 26, {
        width: colWidth - 24,
        lineBreak: false,
      })
  })

  document.y = y + height + 18
}

function drawParties(document: PdfDocument, detail: InvoiceDetail) {
  const { invoice } = detail
  const top = document.y
  const gap = 14
  const colWidth = (LAYOUT.width - gap) / 2
  const rightX = LAYOUT.left + colWidth + gap
  const padding = 14
  const innerWidth = colWidth - padding * 2

  const customerTitle = invoice.customerCompanyName || invoice.customerName
  const customerLines = compactLines([
    invoice.customerCompanyName ? invoice.customerName : null,
    invoice.customerAddress,
    invoice.customerEmail,
    invoice.customerPhone,
    invoice.customerTaxId ? `Tax ID ${invoice.customerTaxId}` : null,
  ])

  document.font('Helvetica-Bold').fontSize(10)
  const titleHeight = document.heightOfString(customerTitle, { width: innerWidth })
  document.font('Helvetica').fontSize(8.5)
  const linesHeight = customerLines
    ? document.heightOfString(customerLines, { width: innerWidth, lineGap: 1.5 })
    : 0
  const leftHeight = padding + 16 + titleHeight + (customerLines ? 6 + linesHeight : 0) + padding
  const summaryRows = 4 + (invoice.paidAt ? 1 : 0)
  const rightHeight = padding + 16 + summaryRows * 18 + padding
  const cardHeight = Math.max(96, leftHeight, rightHeight)

  fillRect(document, LAYOUT.left, top, colWidth, cardHeight, COLORS.soft)
  document.save()
  document.rect(LAYOUT.left, top, 3, cardHeight).fill(COLORS.brand)
  document.restore()
  fillRect(document, rightX, top, colWidth, cardHeight, COLORS.soft)

  label(document, 'DITAGIHKAN KEPADA', LAYOUT.left + padding, top + padding)
  document
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.ink)
    .text(customerTitle, LAYOUT.left + padding, top + padding + 16, { width: innerWidth })
  if (customerLines) {
    document
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.muted)
      .text(customerLines, LAYOUT.left + padding, top + padding + 16 + titleHeight + 4, {
        width: innerWidth,
        lineGap: 1.5,
      })
  }

  label(document, 'RINGKASAN', rightX + padding, top + padding)
  const summary = [
    ['Status', STATUS_LABELS[invoice.status] ?? invoice.status.toUpperCase()],
    ['Total', formatMoney(invoice.totalAmount, invoice.currency)],
    ['Dibayar', formatMoney(invoice.amountPaid, invoice.currency)],
    ['Sisa tagihan', formatMoney(invoice.balanceDue, invoice.currency)],
    invoice.paidAt ? ['Dibayar pada', formatInstantDate(invoice.paidAt)] : null,
  ].filter((row): row is [string, string] => Boolean(row))

  summary.forEach((row, index) => {
    const rowY = top + padding + 20 + index * 18
    document
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.muted)
      .text(row[0], rightX + padding, rowY, { width: 88, lineBreak: false })
    document
      .font(index > 0 ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor(COLORS.ink)
      .text(row[1], rightX + padding + 88, rowY, {
        width: innerWidth - 88,
        align: 'right',
        lineBreak: false,
      })
  })

  document.y = top + cardHeight + 20
}

function drawItems(document: PdfDocument, detail: InvoiceDetail) {
  label(document, 'RINCIAN TAGIHAN', LAYOUT.left, document.y)
  document.y += 14
  drawTableHeader(document)

  detail.items.forEach((item, index) => {
    const period =
      item.servicePeriodStart && item.servicePeriodEnd
        ? `${formatDate(item.servicePeriodStart)} - ${formatDate(item.servicePeriodEnd)}`
        : null
    const months = billingPeriodMonths(item.servicePeriodStart, item.servicePeriodEnd)
    const breakdown =
      months > 1
        ? `Rata-rata ${formatMoney(monthlyEquivalent(item.unitPriceAmount, months), invoiceCurrency(detail))} / bulan x ${months} bulan`
        : null

    document.font('Helvetica-Bold').fontSize(9)
    const descriptionHeight = document.heightOfString(item.description, {
      width: TABLE.description.width,
    })
    const periodHeight = period ? 12 : 0
    const breakdownHeight = breakdown ? 12 : 0
    const rowHeight = Math.max(38, descriptionHeight + periodHeight + breakdownHeight + 18)

    if (document.y + rowHeight > LAYOUT.pageBreakY) {
      document.addPage()
      document.y = LAYOUT.contentTop
      drawTableHeader(document)
    }

    const y = document.y
    document
      .rect(LAYOUT.left, y, LAYOUT.width, rowHeight)
      .fill(index % 2 === 0 ? COLORS.white : COLORS.zebra)
    document
      .moveTo(LAYOUT.left, y + rowHeight)
      .lineTo(LAYOUT.right, y + rowHeight)
      .strokeColor(COLORS.line)
      .lineWidth(0.6)
      .stroke()

    let textY = y + 10
    document
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(item.description, TABLE.description.x, textY, { width: TABLE.description.width })
    textY += descriptionHeight
    if (period) {
      document
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(period, TABLE.description.x, textY + 2, { width: TABLE.description.width })
      textY += periodHeight
    }
    if (breakdown) {
      document
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.brandInk)
        .text(breakdown, TABLE.description.x, textY + 2, { width: TABLE.description.width })
    }

    const valueY = y + 12
    document.font('Helvetica').fontSize(8.5).fillColor(COLORS.ink)
    document.text(formatQuantity(item.quantity), TABLE.quantity.x, valueY, {
      width: TABLE.quantity.width,
      align: 'center',
    })
    document.text(
      formatMoney(item.unitPriceAmount, invoiceCurrency(detail)),
      TABLE.unit.x,
      valueY,
      {
        width: TABLE.unit.width,
        align: 'right',
      },
    )
    document.fillColor(COLORS.muted).text(formatTaxRate(item.taxRate), TABLE.tax.x, valueY, {
      width: TABLE.tax.width,
      align: 'right',
    })
    document
      .font('Helvetica-Bold')
      .fillColor(COLORS.ink)
      .text(formatMoney(item.totalAmount, invoiceCurrency(detail)), TABLE.total.x, valueY, {
        width: TABLE.total.width,
        align: 'right',
      })

    document.y = y + rowHeight
  })
}

function drawTableHeader(document: PdfDocument) {
  const y = document.y
  const height = 28
  fillRect(document, LAYOUT.left, y, LAYOUT.width, height, COLORS.ink)
  document.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.white)
  document.text('DESKRIPSI', TABLE.description.x, y + 11, {
    width: TABLE.description.width,
    characterSpacing: 0.4,
  })
  document.text('QTY', TABLE.quantity.x, y + 11, {
    width: TABLE.quantity.width,
    align: 'center',
    characterSpacing: 0.4,
  })
  document.text('HARGA', TABLE.unit.x, y + 11, {
    width: TABLE.unit.width,
    align: 'right',
    characterSpacing: 0.4,
  })
  document.text('PAJAK', TABLE.tax.x, y + 11, {
    width: TABLE.tax.width,
    align: 'right',
    characterSpacing: 0.4,
  })
  document.text('TOTAL', TABLE.total.x, y + 11, {
    width: TABLE.total.width,
    align: 'right',
    characterSpacing: 0.4,
  })
  document.y = y + height
}

function drawSummary(document: PdfDocument, detail: InvoiceDetail) {
  const { invoice } = detail
  const totalsWidth = 248
  const gap = 14
  const leftWidth = LAYOUT.width - totalsWidth - gap
  const showPayments = invoice.amountPaid > 0n
  const totalsHeight = 24 + 40 + 40 + (showPayments ? 44 : 0)

  document.font('Helvetica').fontSize(8.5)
  const notesHeight = invoice.notes
    ? 38 + document.heightOfString(invoice.notes, { width: leftWidth - 28, lineGap: 2 })
    : 64
  const blockHeight = Math.max(totalsHeight, notesHeight)
  if (document.y + blockHeight + 16 > LAYOUT.pageBreakY) {
    document.addPage()
    document.y = LAYOUT.contentTop
  }

  const y = document.y + 16
  fillRect(document, LAYOUT.left, y, leftWidth, blockHeight, COLORS.soft)
  if (invoice.notes) {
    label(document, 'CATATAN', LAYOUT.left + 14, y + 12)
    document
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.ink)
      .text(invoice.notes, LAYOUT.left + 14, y + 28, {
        width: leftWidth - 28,
        lineGap: 2,
      })
  } else {
    label(document, 'PEMBAYARAN', LAYOUT.left + 14, y + 12)
    document
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.muted)
      .text(
        'Mohon selesaikan pembayaran sebelum tanggal jatuh tempo. Terima kasih atas kepercayaan Anda.',
        LAYOUT.left + 14,
        y + 28,
        { width: leftWidth - 28, lineGap: 2 },
      )
  }

  const x = LAYOUT.right - totalsWidth
  fillRect(document, x, y, totalsWidth, blockHeight, COLORS.soft)

  const stackHeight = 20 + 20 + 16 + 32 + (showPayments ? 40 : 0)
  let rowY = y + Math.max(14, (blockHeight - stackHeight) / 2)
  totalRow(
    document,
    'Subtotal',
    formatMoney(invoice.subtotalAmount, invoice.currency),
    x,
    rowY,
    totalsWidth,
  )
  rowY += 20
  totalRow(
    document,
    'Pajak',
    formatMoney(invoice.taxAmount, invoice.currency),
    x,
    rowY,
    totalsWidth,
  )
  rowY += 16

  fillRect(document, x + 10, rowY, totalsWidth - 20, 32, COLORS.brand)
  document.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.white)
  document.text('TOTAL', x + 22, rowY + 11, { width: 70, lineBreak: false })
  document
    .fontSize(10)
    .text(formatMoney(invoice.totalAmount, invoice.currency), x + 90, rowY + 10, {
      width: totalsWidth - 122,
      align: 'right',
      lineBreak: false,
    })
  rowY += 40

  if (showPayments) {
    totalRow(
      document,
      'Dibayar',
      formatMoney(invoice.amountPaid, invoice.currency),
      x,
      rowY,
      totalsWidth,
    )
    rowY += 20
    totalRow(
      document,
      'Sisa tagihan',
      formatMoney(invoice.balanceDue, invoice.currency),
      x,
      rowY,
      totalsWidth,
      true,
    )
  }

  document.y = y + blockHeight
}

function drawPageChrome(document: PdfDocument, invoiceNumber: string) {
  const range = document.bufferedPageRange()
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index)
    document.rect(0, 0, LAYOUT.pageWidth, 6).fill(COLORS.brand)
    document
      .moveTo(LAYOUT.left, LAYOUT.footerLineY)
      .lineTo(LAYOUT.right, LAYOUT.footerLineY)
      .strokeColor(COLORS.line)
      .lineWidth(0.8)
      .stroke()
    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text(`${invoiceNumber}  ·  Dokumen dari snapshot invoice`, LAYOUT.left, LAYOUT.footerTextY, {
        width: 340,
        lineBreak: false,
      })
    document.text(`Halaman ${index + 1} / ${range.count}`, LAYOUT.right - 110, LAYOUT.footerTextY, {
      width: 110,
      align: 'right',
      lineBreak: false,
    })
  }
}

function fillRect(
  document: PdfDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) {
  document.save()
  document.rect(x, y, width, height).fill(color)
  document.restore()
}

function label(document: PdfDocument, text: string, x: number, y: number) {
  document
    .font('Helvetica-Bold')
    .fontSize(7)
    .fillColor(COLORS.muted)
    .text(text, x, y, { characterSpacing: 0.5, lineBreak: false })
}

function totalRow(
  document: PdfDocument,
  title: string,
  value: string,
  x: number,
  y: number,
  width: number,
  emphasize = false,
) {
  document
    .font(emphasize ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(8.5)
    .fillColor(emphasize ? COLORS.ink : COLORS.muted)
    .text(title, x + 16, y, { width: 90, lineBreak: false })
  document
    .fillColor(COLORS.ink)
    .text(value, x + 106, y, { width: width - 126, align: 'right', lineBreak: false })
}

function sellerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  if (!first) return 'IN'
  if (!last) return first.slice(0, 2).toUpperCase()
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function formatInstantDate(value: Date) {
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(value)
}

function formatMoney(value: bigint, currency: string) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace(/\u00a0/g, ' ')
}

function formatQuantity(value: string) {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function formatTaxRate(rate: string | null) {
  if (!rate) return '-'
  const percent = Number(rate) * 100
  if (!Number.isFinite(percent)) return '-'
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(percent)}%`
}

function compactLines(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value?.trim())).join('\n')
}

function invoiceCurrency(detail: InvoiceDetail) {
  return detail.invoice.currency
}
