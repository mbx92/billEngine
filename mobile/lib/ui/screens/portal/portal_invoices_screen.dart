import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/portal.dart';
import 'package:billengine_mobile/state/portal_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class PortalInvoicesScreen extends StatefulWidget {
  const PortalInvoicesScreen({super.key});

  @override
  State<PortalInvoicesScreen> createState() => _PortalInvoicesScreenState();
}

class _PortalInvoicesScreenState extends State<PortalInvoicesScreen> {
  String _filter = '';

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<PortalController>();
    final summary = controller.value;

    return PortalScaffold(
      title: 'Invoice',
      index: 1,
      onRefresh: controller.refresh,
      child: _body(context, controller, summary),
    );
  }

  Widget _body(BuildContext context, PortalController controller, PortalSummary? summary) {
    if (controller.isLoading && summary == null) {
      return const LoadingList(count: 5, height: 76);
    }
    if (summary == null) {
      return ErrorState(
        message: controller.error ?? 'Server tidak dapat membaca invoice akun ini.',
        onRetry: controller.refresh,
      );
    }

    final invoices = summary.invoices;
    final visible = _filter.isEmpty
        ? invoices
        : invoices.where((invoice) => invoice.status == _filter).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(
          eyebrow: 'Customer portal',
          title: 'Invoice',
          subtitle: 'Unduh PDF dan cek sisa tagihan untuk setiap invoice.',
        ),
        const SizedBox(height: 14),
        FilterChipRow(
          options: <String>['', 'unpaid', 'overdue', 'paid', 'draft', 'cancelled'],
          selected: _filter,
          labelBuilder: (value) {
            if (value.isEmpty) return 'Semua ${invoices.length}';
            final count = invoices.where((invoice) => invoice.status == value).length;
            return '${StatusPill.statusLabel(value)} $count';
          },
          onChanged: (value) => setState(() => _filter = value),
        ),
        const SizedBox(height: 12),
        if (visible.isEmpty)
          const Expanded(
            child: EmptyState(
              title: 'Belum ada invoice',
              description:
                  'Invoice baru akan tampil setelah periode billing atau invoice manual diterbitkan.',
              icon: Icons.description_outlined,
            ),
          )
        else
          Expanded(
            child: ListView.separated(
              itemCount: visible.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final invoice = visible[index];
                return AppSurface(
                  onTap: () => context.go('/portal/invoices/${invoice.id}'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              invoice.invoiceNumber,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w700,
                                fontFamily: 'monospace',
                                color: context.colors.brand,
                              ),
                            ),
                          ),
                          StatusPill.status(invoice.status, dense: true),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Terbit ${Fmt.date(invoice.issueDate)}',
                                  style: TextStyle(fontSize: 11, color: context.colors.muted),
                                ),
                                Text(
                                  'Jatuh tempo ${Fmt.date(invoice.dueDate)}'
                                  '${invoice.daysPastDue > 0 ? ' · +${invoice.daysPastDue} hari' : ''}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: invoice.daysPastDue > 0
                                        ? context.colors.warning
                                        : context.colors.muted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(
                                Fmt.money(invoice.totalAmount, invoice.currency),
                                style: TextStyle(
                                  fontSize: 11,
                                  color: context.colors.muted,
                                  decoration: TextDecoration.lineThrough,
                                  fontFeatures: const [FontFeature.tabularFigures()],
                                ),
                              ),
                              MoneyText(
                                invoice.balanceDue,
                                currency: invoice.currency,
                                bold: true,
                                size: 14,
                                color: invoice.balanceDue == '0'
                                    ? context.colors.muted
                                    : context.colors.ink,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}
