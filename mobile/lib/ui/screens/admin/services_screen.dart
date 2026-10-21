import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/service.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class ServicesScreen extends StatefulWidget {
  const ServicesScreen({super.key});

  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  late final ListController<Service> _list;
  final _action = ActionController();
  String _filter = '';

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _list = ListController<Service>(
      fetch: (page, perPage) async {
        final result = await api.services(page: page, perPage: perPage);
        return (rows: result.rows, meta: result.meta);
      },
    );
    _list.load();
  }

  @override
  void dispose() {
    _list.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final api = context.read<ApiService>();
    final settings = context.read<SettingsController>();

    ServiceOptions options;
    try {
      options = await api.serviceOptions();
    } catch (error) {
      if (mounted) showAppSnack(context, 'Opsi service tidak dapat dimuat: $error', error: true);
      return;
    }
    if (!mounted) return;

    if (options.plans.isEmpty || options.customers.isEmpty) {
      showAppSnack(
        context,
        'Tambahkan minimal satu customer dan satu plan terlebih dahulu.',
        error: true,
      );
      return;
    }

    final values = await showRecordForm(
      context,
      title: 'Service baru',
      description: 'Hubungkan customer dengan plan dan resource yang sudah berjalan.',
      submitLabel: 'Buat service',
      fields: [
        FieldSpec.select(
          'customerId',
          'Customer',
          options: {
            for (final customer in options.customers) customer.id: customer.displayName,
          },
          required: true,
        ),
        FieldSpec.select(
          'planId',
          'Plan',
          options: {
            for (final plan in options.plans)
              plan.id: '${plan.name} · ${Fmt.money(plan.priceAmount, plan.currency)}',
          },
          required: true,
        ),
        FieldSpec.text('name', 'Nama service', required: true),
        FieldSpec.multiline('description', 'Deskripsi'),
        FieldSpec.date(
          'billingStartDate',
          'Tanggal mulai billing',
          initial: Fmt.todayIso(),
          required: true,
        ),
        FieldSpec.date('nextDueDate', 'Jadwal invoice pertama', initial: Fmt.todayIso()),
        FieldSpec.integer('invoiceLeadDays', 'Generate invoice (hari sebelum)', initial: '0'),
        FieldSpec.integer('paymentDueDays', 'Batas pembayaran (hari)', initial: '7'),
        FieldSpec.decimal(
          'taxRate',
          'Tax rate (0–1)',
          initial: settings.value.defaultTaxRate,
        ),
      ],
    );
    if (values == null || !mounted) return;

    final payload = <String, dynamic>{
      'customerId': values['customerId'],
      'planId': values['planId'],
      'name': values['name'],
      'billingStartDate': values['billingStartDate'],
      'invoiceLeadDays': values['invoiceLeadDays'] ?? '0',
      'paymentDueDays': values['paymentDueDays'] ?? '7',
      if (values['description'] != null) 'description': values['description'],
      if (values['nextDueDate'] != null) 'nextDueDate': values['nextDueDate'],
      if (values['taxRate'] != null) 'taxRate': values['taxRate'],
    };

    final ok = await _action.run(() => api.createService(payload));
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Service ${values['name']} berhasil dibuat.');
      await _list.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Service gagal dibuat.', error: true);
    }
  }

  Future<void> _transition(Service service, String status) async {
    final reason = await showReasonDialog(
      context,
      title: switch (status) {
        'suspended' => 'Suspend service',
        'active' => 'Aktifkan service',
        _ => 'Batalkan service',
      },
      label: 'Alasan',
      confirmLabel: 'Simpan',
    );
    if (reason == null || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().transitionService(
        service.id,
        status: status,
        reason: reason,
      ),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Status ${service.name} diperbarui.');
      await _list.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Status service gagal diperbarui.', error: true);
    }
  }

  Future<void> _delete(Service service) async {
    final confirmed = await confirmAction(
      context,
      title: 'Hapus service?',
      message:
          '${service.serviceNumber} · ${service.name} akan dihapus. Service harus berstatus '
          'cancelled dan tidak boleh memiliki invoice terbuka.',
      confirmLabel: 'Hapus',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    final ok = await _action.run(() => context.read<ApiService>().deleteService(service.id));
    if (!mounted) return;
    if (ok) {
      _list.removeWhere((row) => row.id == service.id);
      showAppSnack(context, 'Service dihapus.');
    } else {
      showAppSnack(context, _action.error ?? 'Service tidak dapat dihapus.', error: true);
    }
  }

  Future<void> _infrastructure(Service service) async {
    final api = context.read<ApiService>();

    // Fetch the reconciliation preview before offering to apply it.
    try {
      final result = await api.serviceInfrastructure(service.id);
      if (!mounted) return;
      final apply = await showDialog<bool>(
        context: context,
        builder: (context) => _ReconciliationDialog(preview: result),
      );
      if (apply != true || !mounted) return;
      await api.applyServiceInfrastructure(service.id, fingerprint: result.fingerprint);
      if (!mounted) return;
      showAppSnack(context, 'Perubahan infrastruktur dijadwalkan.');
      await _list.refresh();
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final counts = <String, int>{
      '': _list.rows.length,
      'active': _list.rows.where((row) => row.status == 'active').length,
      'suspended': _list.rows.where((row) => row.status == 'suspended').length,
      'cancelled': _list.rows.where((row) => row.status == 'cancelled').length,
    };

    return AdminScaffold(
      floatingAction: FloatingActionButton.extended(
        onPressed: _action.isPending ? null : _create,
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Service'),
      ),
      child: ChangeNotifierProvider<ListController<Service>>.value(
        value: _list,
        child: Consumer<ListController<Service>>(
          builder: (context, controller, _) {
            final visible = _filter.isEmpty
                ? controller.rows
                : controller.rows.where((row) => row.status == _filter).toList(growable: false);

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionHeader(
                  eyebrow: 'Commercial',
                  title: 'Services',
                  subtitle: 'Langganan customer, siklus billing, dan resource yang terhubung.',
                  trailing: StatusPill(
                    label: '${controller.meta.total} total',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 12),
                FilterChipRow(
                  options: const <String>['', 'active', 'suspended', 'cancelled'],
                  selected: _filter,
                  labelBuilder: (value) {
                    if (value.isEmpty) return 'Semua ${counts[''] ?? 0}';
                    return '${StatusPill.statusLabel(value)} ${counts[value] ?? 0}';
                  },
                  onChanged: (value) => setState(() => _filter = value),
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: controller.refresh,
                    child: controller.isLoading && !controller.isLoaded
                        ? ListView(children: [LoadingList(count: 4, height: 120)])
                        : controller.error != null && controller.rows.isEmpty
                        ? ListView(
                            children: [
                              ErrorState(message: controller.error!, onRetry: controller.refresh),
                            ],
                          )
                        : visible.isEmpty
                        ? ListView(
                            children: [
                              EmptyState(
                                title: _filter.isEmpty ? 'Belum ada service' : 'Tidak ada service',
                                description: _filter.isEmpty
                                    ? 'Buat service dari customer dan plan yang sudah ada.'
                                    : 'Tidak ada service dengan status ini.',
                                icon: Icons.inventory_2_outlined,
                                action: _filter.isEmpty
                                    ? FilledButton(
                                        onPressed: _create,
                                        child: const Text('Buat service'),
                                      )
                                    : null,
                              ),
                            ],
                          )
                        : ListView.separated(
                            itemCount: visible.length + (controller.hasMore && _filter.isEmpty ? 1 : 0),
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              if (index >= visible.length) {
                                controller.loadMore();
                                return const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 14),
                                  child: Center(
                                    child: SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  ),
                                );
                              }
                              final service = visible[index];
                              return _ServiceCard(
                                service: service,
                                busy: _action.isPending,
                                onTransition: _transition,
                                onInfrastructure: _infrastructure,
                                onDelete: _delete,
                              );
                            },
                          ),
                  ),
                ),
                if (_action.error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _action.error!,
                      style: TextStyle(fontSize: 11.5, color: colors.danger),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ServiceCard extends StatelessWidget {
  const _ServiceCard({
    required this.service,
    required this.busy,
    required this.onTransition,
    required this.onInfrastructure,
    required this.onDelete,
  });

  final Service service;
  final bool busy;
  final Future<void> Function(Service, String) onTransition;
  final Future<void> Function(Service) onInfrastructure;
  final Future<void> Function(Service) onDelete;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final allocation = service.infrastructure;

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
            padding: const EdgeInsets.fromLTRB(14, 12, 6, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${service.serviceNumber} · ${service.customerName}',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                          fontFamily: 'monospace',
                          color: colors.muted,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        service.name,
                        style: TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: colors.ink,
                        ),
                      ),
                      if (service.planName != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 1),
                          child: Text(
                            service.planName!,
                            style: TextStyle(fontSize: 11.5, color: colors.muted),
                          ),
                        ),
                    ],
                  ),
                ),
                StatusPill.status(service.status, dense: true),
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, size: 18),
                  enabled: !busy,
                  onSelected: (value) {
                    switch (value) {
                      case 'activate':
                        onTransition(service, 'active');
                      case 'suspend':
                        onTransition(service, 'suspended');
                      case 'cancel':
                        onTransition(service, 'cancelled');
                      case 'infra':
                        onInfrastructure(service);
                      case 'delete':
                        onDelete(service);
                    }
                  },
                  itemBuilder: (context) => [
                    if (service.status != 'active')
                      const PopupMenuItem(value: 'activate', child: Text('Aktifkan')),
                    if (service.status == 'active')
                      const PopupMenuItem(value: 'suspend', child: Text('Suspend')),
                    if (service.status != 'cancelled')
                      const PopupMenuItem(value: 'cancel', child: Text('Batalkan')),
                    const PopupMenuItem(value: 'infra', child: Text('Sinkron infrastruktur')),
                    if (service.status == 'cancelled')
                      const PopupMenuItem(value: 'delete', child: Text('Hapus service')),
                  ],
                ),
              ],
            ),
          ),
          Divider(height: 1, color: colors.line),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    MoneyText(
                      service.priceAmount,
                      currency: service.currency,
                      bold: true,
                      size: 15,
                    ),
                    Text(
                      ' / ${Fmt.billingCycleUnit(service.billingCycle)}',
                      style: TextStyle(fontSize: 11, color: colors.muted),
                    ),
                    const Spacer(),
                    if (service.nextDueDate != null)
                      Text(
                        'Tagihan ${Fmt.date(service.nextDueDate)}',
                        style: TextStyle(fontSize: 11, color: colors.muted),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (service.planDatabaseMode != 'none')
                      StatusPill(
                        label: 'DB ${Fmt.label(service.planDatabaseMode)}',
                        tone: 'warning',
                        dense: true,
                      ),
                    if (service.database != null)
                      StatusPill(
                        label: 'DB ${service.database!.status}',
                        tone: StatusPill.statusTone(service.database!.status),
                        dense: true,
                      ),
                    StatusPill(
                      label: allocation.label,
                      tone: switch (allocation.status) {
                        'matched' => 'success',
                        'over_allocated' || 'mixed' => 'danger',
                        'under_allocated' || 'unknown' => 'warning',
                        _ => 'muted',
                      },
                      dense: true,
                    ),
                    if (service.resources.isNotEmpty)
                      StatusPill(
                        label: '${service.resources.length} resource',
                        tone: 'muted',
                        dense: true,
                      ),
                  ],
                ),
                if (service.suspensionReason != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      service.suspensionReason!,
                      style: TextStyle(fontSize: 11, color: colors.warning),
                    ),
                  ),
                if (service.resources.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  for (final resource in service.resources.take(3))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 3),
                      child: Row(
                        children: [
                          Icon(
                            Icons.widgets_outlined,
                            size: 12,
                            color: colors.muted,
                          ),
                          const SizedBox(width: 5),
                          Expanded(
                            child: Text(
                              resource.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                fontFamily: 'monospace',
                                color: colors.muted,
                              ),
                            ),
                          ),
                          StatusPill.status(resource.status, dense: true),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReconciliationDialog extends StatelessWidget {
  const _ReconciliationDialog({required this.preview});

  final dynamic preview;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final canApply = preview.canApply as bool;
    return AlertDialog(
      backgroundColor: colors.surface,
      title: const Text(
        'Sinkron infrastruktur',
        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              preview.blockingReason as String? ??
                  'Resource akan disesuaikan dengan kuota plan yang berlaku.',
              style: TextStyle(fontSize: 12.5, height: 1.5, color: colors.muted),
            ),
            const SizedBox(height: 12),
            if ((preview.resources as List).isEmpty)
              Text(
                'Tidak ada resource yang terhubung ke service ini.',
                style: TextStyle(fontSize: 12.5, color: colors.muted),
              )
            else
              for (final resource in preview.resources as List)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          resource.name as String,
                          style: TextStyle(fontSize: 12, color: colors.ink),
                        ),
                      ),
                      StatusPill(
                        label: (resource.changed as bool) ? 'Berubah' : 'Sesuai',
                        tone: (resource.changed as bool) ? 'warning' : 'success',
                        dense: true,
                      ),
                    ],
                  ),
                ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Tutup'),
        ),
        FilledButton(
          onPressed: canApply ? () => Navigator.of(context).pop(true) : null,
          child: const Text('Terapkan'),
        ),
      ],
    );
  }
}
