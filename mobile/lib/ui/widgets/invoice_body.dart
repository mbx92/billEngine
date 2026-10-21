import 'package:flutter/material.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

/// Renders the seller/customer blocks, line items, totals, and payment history
/// of an invoice. Shared by the admin detail screen and the customer portal so
/// both always present identical numbers.
class InvoiceBody extends StatelessWidget {
  const InvoiceBody({
    super.key,
    required this.detail,
    this.showTaxColumn = true,
    this.compact = false,
  });

  final InvoiceDetail detail;
  final bool showTaxColumn;
  final bool compact;

  String _taxLabel(String? rate) {
    if (rate == null || rate.isEmpty) return '—';
    final numeric = double.tryParse(rate);
    if (numeric == null) return '—';
    return '${Fmt.number(numeric * 100, decimals: 2)}%';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final invoice = detail.invoice;
    final currency = invoice.currency;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: colors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _party(context, 'DARI', detail.sellerName, <String?>[
                detail.sellerAddress,
                detail.sellerEmail,
                if (detail.sellerTaxId != null) 'Tax ID: ${detail.sellerTaxId}',
              ]),
              Divider(height: 22, color: colors.line),
              _party(
                context,
                'DITAGIHKAN KEPADA',
                invoice.customerDisplayName,
                <String?>[
                  if (invoice.customerCompanyName != null) invoice.customerName,
                  detail.customerEmail,
                  detail.customerPhone,
                  detail.customerAddress,
                  if (detail.customerTaxId != null) 'Tax ID: ${detail.customerTaxId}',
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: colors.line),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (final item in detail.items) _lineItem(context, item, currency),
              Divider(height: 1, color: colors.line),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  children: [
                    _totalRow(context, 'Subtotal', detail.subtotalAmount, currency),
                    if (detail.discountAmount != '0')
                      _totalRow(
                        context,
                        detail.discountPercent != null
                            ? 'Diskon (${_taxLabel(detail.discountPercent)})'
                            : 'Diskon',
                        detail.discountAmount,
                        currency,
                        negative: true,
                        color: colors.danger,
                      ),
                    if (detail.taxAmount != '0')
                      _totalRow(context, 'Pajak', detail.taxAmount, currency),
                    Divider(height: 18, color: colors.line),
                    _totalRow(
                      context,
                      'Total',
                      invoice.totalAmount,
                      currency,
                      bold: true,
                      size: 15,
                    ),
                    _totalRow(context, 'Dibayar', invoice.amountPaid, currency),
                    if (detail.creditedAmount != '0')
                      _totalRow(
                        context,
                        'Credit note',
                        detail.creditedAmount,
                        currency,
                        negative: true,
                      ),
                    Divider(height: 18, color: colors.line),
                    _totalRow(
                      context,
                      'Sisa tagihan',
                      invoice.balanceDue,
                      currency,
                      bold: true,
                      color: invoice.balanceDue == '0' ? colors.muted : colors.ink,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (detail.notes != null && detail.notes!.trim().isNotEmpty) ...[
          const SizedBox(height: 12),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CATATAN',
                  style: TextStyle(
                    fontSize: 10,
                    letterSpacing: 1,
                    fontWeight: FontWeight.w700,
                    color: colors.muted,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  detail.notes!,
                  style: TextStyle(fontSize: 12.5, height: 1.5, color: colors.ink),
                ),
              ],
            ),
          ),
        ],
        if (detail.payments.isNotEmpty || detail.creditNotes.isNotEmpty) ...[
          const SizedBox(height: 12),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (detail.payments.isNotEmpty) ...[
                  _label(context, 'Pembayaran'),
                  for (final payment in detail.payments)
                    _historyRow(
                      context,
                      leading: payment.paymentNumber,
                      middle: Fmt.dateTime(payment.paidAt),
                      trailing: Fmt.money(payment.amount, payment.currency),
                      pill: StatusPill.status(payment.status, dense: true),
                    ),
                ],
                if (detail.payments.isNotEmpty && detail.creditNotes.isNotEmpty)
                  Divider(height: 18, color: colors.line),
                if (detail.creditNotes.isNotEmpty) ...[
                  _label(context, 'Credit notes'),
                  for (final credit in detail.creditNotes)
                    _historyRow(
                      context,
                      leading: credit.creditNoteNumber,
                      middle: credit.reason,
                      trailing: '-${Fmt.money(credit.amount, currency)}',
                      trailingColor: colors.danger,
                    ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _party(BuildContext context, String label, String name, List<String?> lines) {
    final colors = context.colors;
    final visible = lines.where((line) => line != null && line.trim().isNotEmpty).cast<String>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 10,
            letterSpacing: 1,
            fontWeight: FontWeight.w700,
            color: colors.muted,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          name,
          style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: colors.ink),
        ),
        for (final line in visible)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(line, style: TextStyle(fontSize: 11.5, height: 1.4, color: colors.muted)),
          ),
      ],
    );
  }

  Widget _lineItem(BuildContext context, InvoiceItem item, String currency) {
    final colors = context.colors;
    final quantity = double.tryParse(item.quantity) ?? 0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  item.description,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    height: 1.4,
                    color: colors.ink,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                Fmt.money(item.totalAmount, currency),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 10,
            runSpacing: 2,
            children: [
              Text(
                '${Fmt.number(quantity, decimals: quantity % 1 == 0 ? 0 : 2)} × ${Fmt.money(item.unitPriceAmount, currency)}',
                style: TextStyle(fontSize: 11, color: colors.muted),
              ),
              if (item.taxRate != null)
                Text(
                  'Pajak ${_taxLabel(item.taxRate)}',
                  style: TextStyle(fontSize: 11, color: colors.muted),
                ),
            ],
          ),
          if (item.servicePeriodStart != null && item.servicePeriodEnd != null)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                '${Fmt.date(item.servicePeriodStart)} – ${Fmt.date(item.servicePeriodEnd)}',
                style: TextStyle(
                  fontSize: 10.5,
                  color: colors.muted,
                  fontFamily: 'monospace',
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _totalRow(
    BuildContext context,
    String label,
    String amount,
    String currency, {
    bool bold = false,
    bool negative = false,
    Color? color,
    double size = 12.5,
  }) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: size,
                fontWeight: bold ? FontWeight.w600 : FontWeight.w400,
                color: bold ? colors.ink : colors.muted,
              ),
            ),
          ),
          Text(
            '${negative ? '-' : ''}${Fmt.money(amount, currency)}',
            style: TextStyle(
              fontSize: size,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
              color: color ?? colors.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _label(BuildContext context, String text) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          letterSpacing: 1,
          fontWeight: FontWeight.w700,
          color: colors.muted,
        ),
      ),
    );
  }

  Widget _historyRow(
    BuildContext context, {
    required String leading,
    required String middle,
    required String trailing,
    Color? trailingColor,
    Widget? pill,
  }) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  leading,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: colors.ink,
                    fontFamily: 'monospace',
                  ),
                ),
                Text(
                  middle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 10.5, color: colors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (pill != null) ...[pill, const SizedBox(width: 8)],
          Text(
            trailing,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: trailingColor ?? colors.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
