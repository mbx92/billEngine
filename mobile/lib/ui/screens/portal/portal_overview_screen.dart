import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/state/portal_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class PortalOverviewScreen extends StatelessWidget {
  const PortalOverviewScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<PortalController>();
    return PortalScaffold(
      title: 'Ringkasan',
      index: 0,
      onRefresh: controller.refresh,
      child: _body(context, controller),
    );
  }

  Widget _body(BuildContext context, PortalController controller) {
    final colors = context.colors;
    final summary = controller.value;

    if (controller.isLoading && summary == null) {
      return const LoadingList(count: 4, height: 86);
    }
    if (summary == null) {
      return ErrorState(
        message: controller.error ?? 'Akun ini belum terhubung ke customer.',
        onRetry: controller.refresh,
      );
    }

    final overdue = summary.overdueInvoices;
    final open = summary.openInvoices;

    return ListView(
      children: [
        SectionHeader(
          eyebrow: 'Customer portal',
          title: summary.customer.displayName,
          subtitle: 'Lihat invoice, layanan, dan sisa tagihan akun Anda.',
        ),
        const SizedBox(height: 16),
        if (overdue.isNotEmpty) ...[
          _OverdueBanner(
            count: overdue.length,
            onTap: () => context.go('/portal/invoices/${overdue.first.id}'),
          ),
          const SizedBox(height: 12),
        ],
        Row(
          children: [
            Expanded(
              child: StatTile(
                label: 'Sisa tagihan',
                value: open.isEmpty
                    ? 'Lunas'
                    : Fmt.money(
                        summary.openBalance.isEmpty ? '0' : summary.openBalance.first.amount,
                        summary.openBalance.isEmpty ? 'IDR' : summary.openBalance.first.currency,
                      ),
                detail: open.isEmpty ? 'Tidak ada tagihan terbuka' : '${open.length} invoice terbuka',
                tone: open.isEmpty ? 'success' : 'warning',
                icon: Icons.account_balance_wallet_outlined,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: StatTile(
                label: 'Layanan aktif',
                value: Fmt.count(summary.activeServices.length),
                detail: '${Fmt.count(summary.services.length)} total layanan',
                icon: Icons.inventory_2_outlined,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        StatTile(
          label: 'Nomor akun',
          value: summary.customer.customerNumber,
          detail: summary.customer.email,
          icon: Icons.badge_outlined,
        ),
        const SizedBox(height: 18),
        _SectionCard(
          title: 'Invoice terbuka',
          subtitle: 'Belum dibayar atau jatuh tempo',
          action: TextButton(
            onPressed: () => context.go('/portal/invoices'),
            child: const Text('Semua'),
          ),
          child: open.isEmpty
              ? const EmptyState(
                  title: 'Tidak ada tagihan terbuka',
                  description: 'Invoice baru tampil di sini saat periode billing tiba.',
                  icon: Icons.check_circle_outline,
                )
              : Column(
                  children: [
                    for (final invoice in open.take(6))
                      ListRow(
                        title: invoice.invoiceNumber,
                        subtitle:
                            'Jatuh tempo ${Fmt.date(invoice.dueDate)}'
                            '${invoice.daysPastDue > 0 ? ' · +${invoice.daysPastDue} hari' : ''}',
                        pill: StatusPill.status(invoice.status, dense: true),
                        trailing: MoneyText(
                          invoice.balanceDue,
                          currency: invoice.currency,
                          bold: true,
                          size: 12.5,
                        ),
                        onTap: () => context.go('/portal/invoices/${invoice.id}'),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: 14),
        _SectionCard(
          title: 'Layanan aktif',
          subtitle: 'Langganan yang sedang berjalan',
          action: TextButton(
            onPressed: () => context.go('/portal/services'),
            child: const Text('Semua'),
          ),
          child: summary.activeServices.isEmpty
              ? const EmptyState(
                  title: 'Belum ada layanan aktif',
                  description: 'Layanan yang terhubung ke akun ini akan tampil di sini.',
                  icon: Icons.inventory_2_outlined,
                )
              : Column(
                  children: [
                    for (final service in summary.activeServices.take(6))
                      ListRow(
                        title: service.name,
                        subtitle:
                            '${service.serviceNumber}'
                            '${service.planName != null ? ' · ${service.planName}' : ''}\n'
                            '${service.nextDueDate != null ? 'Tagihan ${Fmt.date(service.nextDueDate)}' : Fmt.billingCycle(service.billingCycle)}',
                        trailing: Text(
                          '${Fmt.money(service.priceAmount, service.currency)}/${Fmt.billingCycleUnit(service.billingCycle)}',
                          textAlign: TextAlign.right,
                          style: TextStyle(fontSize: 11.5, color: colors.muted),
                        ),
                        onTap: () => context.go('/portal/services'),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _OverdueBanner extends StatelessWidget {
  const _OverdueBanner({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.warning.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded, size: 18, color: colors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Ada invoice jatuh tempo',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: colors.warning,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '$count invoice belum dilunasi. Unduh PDF dan selesaikan pembayaran '
                  'agar layanan tidak dibatasi.',
                  style: TextStyle(fontSize: 11.5, height: 1.45, color: colors.muted),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: onTap,
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 34)),
                  child: const Text('Lihat invoice', style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.title,
    required this.subtitle,
    required this.child,
    this.action,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: colors.ink,
                        ),
                      ),
                      Text(subtitle, style: TextStyle(fontSize: 11, color: colors.muted)),
                    ],
                  ),
                ),
                ?action,
              ],
            ),
          ),
          Divider(height: 1, color: colors.line),
          child,
        ],
      ),
    );
  }
}
