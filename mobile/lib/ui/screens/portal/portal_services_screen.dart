import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/state/portal_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class PortalServicesScreen extends StatelessWidget {
  const PortalServicesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<PortalController>();
    return PortalScaffold(
      title: 'Layanan',
      index: 2,
      onRefresh: controller.refresh,
      child: _body(context, controller),
    );
  }

  Widget _body(BuildContext context, PortalController controller) {
    final colors = context.colors;
    final summary = controller.value;

    if (controller.isLoading && summary == null) {
      return const LoadingList(count: 3, height: 160);
    }
    if (summary == null) {
      return ErrorState(
        message: controller.error ?? 'Server tidak dapat membaca layanan akun ini.',
        onRetry: controller.refresh,
      );
    }

    return ListView(
      children: [
        SectionHeader(
          eyebrow: 'Customer portal',
          title: 'Layanan',
          subtitle: 'Langganan, paket, dan jadwal tagihan berikutnya pada akun Anda.',
        ),
        const SizedBox(height: 16),
        if (summary.services.isEmpty)
          const EmptyState(
            title: 'Belum ada layanan',
            description: 'Layanan yang terhubung ke akun ini akan tampil di sini.',
            icon: Icons.inventory_2_outlined,
          )
        else
          for (final service in summary.services) ...[
            Container(
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
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    service.serviceNumber,
                                    style: TextStyle(
                                      fontSize: 10.5,
                                      letterSpacing: 0.6,
                                      fontWeight: FontWeight.w700,
                                      fontFamily: 'monospace',
                                      color: colors.muted,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    service.name,
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600,
                                      color: colors.ink,
                                    ),
                                  ),
                                  if (service.planName != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 2),
                                      child: Text(
                                        service.planName!,
                                        style: TextStyle(fontSize: 11.5, color: colors.muted),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 10),
                            StatusPill.status(service.status),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                          decoration: BoxDecoration(
                            color: colors.canvas,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: colors.line),
                          ),
                          child: Column(
                            children: [
                              KeyValueRow(
                                label: 'Harga',
                                value:
                                    '${Fmt.money(service.priceAmount, service.currency)} / ${Fmt.billingCycleUnit(service.billingCycle)}',
                                mono: true,
                              ),
                              KeyValueRow(
                                label: 'Siklus',
                                value: Fmt.billingCycle(service.billingCycle),
                              ),
                              KeyValueRow(
                                label: 'Tagihan berikutnya',
                                value: service.nextDueDate == null
                                    ? '—'
                                    : Fmt.date(service.nextDueDate),
                              ),
                              if (service.billingStartDate.isNotEmpty)
                                KeyValueRow(
                                  label: 'Mulai billing',
                                  value: Fmt.date(service.billingStartDate),
                                ),
                            ],
                          ),
                        ),
                        if (service.description != null &&
                            service.description!.trim().isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Text(
                            service.description!,
                            style: TextStyle(fontSize: 11.5, height: 1.5, color: colors.muted),
                          ),
                        ],
                        if (service.planInclusions.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          for (final inclusion in service.planInclusions)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 3),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Icon(Icons.check, size: 13, color: colors.brand),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      inclusion,
                                      style: TextStyle(
                                        fontSize: 11.5,
                                        height: 1.4,
                                        color: colors.muted,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                        if (service.suspensionReason != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Text(
                              service.suspensionReason!,
                              style: TextStyle(
                                fontSize: 11.5,
                                height: 1.4,
                                color: colors.warning,
                              ),
                            ),
                          ),
                        if (service.resources.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Text(
                            'RESOURCE',
                            style: TextStyle(
                              fontSize: 9.5,
                              letterSpacing: 1,
                              fontWeight: FontWeight.w700,
                              color: colors.muted,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              for (final resource in service.resources)
                                StatusPill(
                                  label: resource.name,
                                  tone: 'muted',
                                  dense: true,
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],
      ],
    );
  }
}
