import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/plan.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class PlansScreen extends StatefulWidget {
  const PlansScreen({super.key});

  @override
  State<PlansScreen> createState() => _PlansScreenState();
}

class _PlansScreenState extends State<PlansScreen> {
  late final ListController<Plan> _list;
  final _action = ActionController();

  static const Map<String, String> _cycles = <String, String>{
    'one_time': 'Sekali bayar',
    'monthly': 'Bulanan',
    'quarterly': 'Tiga bulanan',
    'semi_annually': 'Enam bulanan',
    'annually': 'Tahunan',
  };

  static const Map<String, String> _databaseModes = <String, String>{
    'none': 'Tanpa database',
    'shared': 'Shared cluster',
    'dedicated': 'Dedicated cluster',
  };

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _list = ListController<Plan>(
      fetch: (page, perPage) async {
        final result = await api.plans(page: page, perPage: perPage);
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

  List<FieldSpec> _fields({Plan? plan, String currency = 'IDR'}) {
    final memoryMb = plan?.includedMemoryBytes == null
        ? null
        : (double.tryParse(plan!.includedMemoryBytes!) ?? 0) ~/ (1024 * 1024);
    return [
      FieldSpec.text('name', 'Nama plan', initial: plan?.name, required: true),
      FieldSpec.multiline('description', 'Deskripsi', initial: plan?.description),
      FieldSpec.text('currency', 'Mata uang', initial: plan?.currency ?? currency, required: true),
      FieldSpec.integer('priceAmount', 'Harga', initial: plan?.priceAmount, required: true),
      FieldSpec.select(
        'billingCycle',
        'Siklus billing',
        options: _cycles,
        initial: plan?.billingCycle ?? 'monthly',
        required: true,
      ),
      FieldSpec.select(
        'databaseMode',
        'Mode database',
        options: _databaseModes,
        initial: plan?.databaseMode ?? 'none',
      ),
      FieldSpec.integer(
        'includedResourceCount',
        'Kuota resource',
        initial: plan?.includedResourceCount?.toString(),
        hint: 'Opsional — jumlah aplikasi yang termasuk',
      ),
      FieldSpec.decimal(
        'includedCpuCores',
        'Kuota CPU (core)',
        initial: plan?.includedCpuCores,
      ),
      FieldSpec.integer(
        'includedMemoryMb',
        'Kuota RAM (MB)',
        initial: memoryMb == null || memoryMb <= 0 ? null : '$memoryMb',
      ),
      FieldSpec.multiline(
        'inclusions',
        'Benefit plan',
        initial: plan?.inclusions.join('\n'),
        hint: 'Satu benefit per baris',
        required: true,
      ),
      if (plan != null) FieldSpec.toggle('isActive', 'Plan aktif', initial: plan.isActive),
    ];
  }

  Future<void> _save({Plan? plan}) async {
    final settings = context.read<SettingsController>();
    final values = await showRecordForm(
      context,
      title: plan == null ? 'Tambah plan' : 'Edit plan',
      description: 'Tentukan harga, siklus billing, dan benefit yang termasuk dalam plan.',
      submitLabel: plan == null ? 'Simpan plan' : 'Simpan perubahan',
      fields: _fields(plan: plan, currency: settings.currency),
    );
    if (values == null || !mounted) return;

    final inclusions = (values['inclusions'] as String? ?? '')
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList(growable: false);

    final memoryMb = values['includedMemoryMb'] as String?;
    final payload = <String, dynamic>{
      'name': values['name'],
      'currency': values['currency'],
      'priceAmount': values['priceAmount'],
      'billingCycle': values['billingCycle'],
      'databaseMode': values['databaseMode'] ?? 'none',
      'inclusions': inclusions,
      if (values['description'] != null) 'description': values['description'],
      if (values['includedResourceCount'] != null)
        'includedResourceCount': values['includedResourceCount'],
      if (values['includedCpuCores'] != null) 'includedCpuCores': values['includedCpuCores'],
      if (memoryMb != null) 'includedMemoryBytes': '${(int.parse(memoryMb) * 1024 * 1024)}',
      if (plan != null) 'isActive': values['isActive'] ?? plan.isActive,
    };

    final ok = await _action.run(() async {
      final api = context.read<ApiService>();
      if (plan == null) {
        await api.createPlan(payload);
      } else {
        await api.updatePlan(plan.id, payload);
      }
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Plan ${values['name']} berhasil disimpan.');
      await _list.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Plan gagal disimpan.', error: true);
    }
  }

  Future<void> _toggle(Plan plan) async {
    final ok = await _action.run(
      () => context.read<ApiService>().updatePlan(plan.id, {'isActive': !plan.isActive}),
    );
    if (!mounted) return;
    if (ok) {
      await _list.refresh();
      if (mounted) {
        showAppSnack(context, 'Plan ${plan.name} ${plan.isActive ? 'dinonaktifkan' : 'diaktifkan'}.');
      }
    } else {
      showAppSnack(context, _action.error ?? 'Status plan gagal diperbarui.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      floatingAction: FloatingActionButton.extended(
        onPressed: _action.isPending ? null : () => _save(),
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Plan'),
      ),
      child: ChangeNotifierProvider<ListController<Plan>>.value(
        value: _list,
        child: Consumer<ListController<Plan>>(
          builder: (context, controller, _) {
            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Commercial',
                  title: 'Plans',
                  subtitle: 'Katalog harga dan benefit yang diterima customer sebelum service dibuat.',
                  trailing: StatusPill(
                    label: '${controller.meta.total} total',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 14),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 3, height: 150)
                else if (controller.error != null && controller.rows.isEmpty)
                  ErrorState(message: controller.error!, onRetry: controller.refresh)
                else if (controller.rows.isEmpty)
                  EmptyState(
                    title: 'Belum ada plan',
                    description: 'Tambahkan plan pertama sebelum membuat service.',
                    action: FilledButton(onPressed: () => _save(), child: const Text('Tambah plan')),
                  )
                else
                  for (final plan in controller.rows) ...[
                    Container(
                      decoration: BoxDecoration(
                        color: colors.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: plan.isActive ? colors.line : colors.danger.withValues(alpha: 0.25),
                        ),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(14, 12, 8, 10),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        plan.name,
                                        style: TextStyle(
                                          fontSize: 14.5,
                                          fontWeight: FontWeight.w600,
                                          color: colors.ink,
                                        ),
                                      ),
                                      if (plan.description != null)
                                        Padding(
                                          padding: const EdgeInsets.only(top: 2),
                                          child: Text(
                                            plan.description!,
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
                                PopupMenuButton<String>(
                                  icon: const Icon(Icons.more_vert, size: 18),
                                  onSelected: (value) {
                                    if (value == 'edit') {
                                      _save(plan: plan);
                                    } else if (value == 'toggle') {
                                      _toggle(plan);
                                    }
                                  },
                                  itemBuilder: (context) => [
                                    const PopupMenuItem(value: 'edit', child: Text('Edit plan')),
                                    PopupMenuItem(
                                      value: 'toggle',
                                      child: Text(plan.isActive ? 'Nonaktifkan' : 'Aktifkan'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                  children: [
                                    MoneyText(
                                      plan.priceAmount,
                                      currency: plan.currency,
                                      bold: true,
                                      size: 18,
                                    ),
                                    const SizedBox(width: 5),
                                    Text(
                                      '/ ${Fmt.billingCycleUnit(plan.billingCycle)}',
                                      style: TextStyle(fontSize: 11.5, color: colors.muted),
                                    ),
                                    const Spacer(),
                                    StatusPill(
                                      label: plan.isActive ? 'Aktif' : 'Nonaktif',
                                      tone: plan.isActive ? 'success' : 'muted',
                                      dense: true,
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: [
                                    if (plan.includedResourceCount != null)
                                      StatusPill(
                                        label: '${plan.includedResourceCount} resource',
                                        tone: 'info',
                                        dense: true,
                                      ),
                                    if (plan.includedCpuCores != null)
                                      StatusPill(
                                        label: '${Fmt.cpu(plan.includedCpuCores)} CPU',
                                        tone: 'info',
                                        dense: true,
                                      ),
                                    if (plan.includedMemoryBytes != null)
                                      StatusPill(
                                        label: '${Fmt.bytes(plan.includedMemoryBytes)} RAM',
                                        tone: 'info',
                                        dense: true,
                                      ),
                                    if (plan.databaseMode != 'none')
                                      StatusPill(
                                        label: _databaseModes[plan.databaseMode]!,
                                        tone: 'warning',
                                        dense: true,
                                      ),
                                    StatusPill(
                                      label: '${plan.serviceCount} service',
                                      tone: 'muted',
                                      dense: true,
                                    ),
                                  ],
                                ),
                                if (plan.inclusions.isNotEmpty) ...[
                                  const SizedBox(height: 10),
                                  for (final inclusion in plan.inclusions)
                                    Padding(
                                      padding: const EdgeInsets.only(bottom: 2),
                                      child: Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Icon(Icons.check, size: 12, color: colors.brand),
                                          const SizedBox(width: 5),
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
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}
