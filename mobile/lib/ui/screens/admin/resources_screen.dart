import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/infrastructure.dart';
import 'package:billengine_mobile/models/platform.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

const Map<String, String> _lifecycleActions = <String, String>{
  'application.start': 'Start',
  'application.stop': 'Stop',
  'application.restart': 'Restart',
  'application.redeploy': 'Redeploy',
  'application.delete': 'Delete',
};

class ResourcesScreen extends StatefulWidget {
  const ResourcesScreen({super.key});

  @override
  State<ResourcesScreen> createState() => _ResourcesScreenState();
}

class _ResourcesScreenState extends State<ResourcesScreen> {
  late final ItemController<List<InfraResource>> _resources;
  final _action = ActionController();
  String _filter = '';
  String _search = '';

  @override
  void initState() {
    super.initState();
    _resources = ItemController<List<InfraResource>>(fetch: context.read<ApiService>().resources);
    _resources.load();
  }

  @override
  void dispose() {
    _resources.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _operation(InfraResource resource, String action) async {
    final label = _lifecycleActions[action] ?? action;
    final destructive = action == 'application.delete';
    final confirmed = await confirmAction(
      context,
      title: '$label ${resource.name}?',
      message: destructive
          ? 'Resource akan dihapus dari ${resource.nodeName}. Data pada volume persistent tetap tersimpan.'
          : 'Operasi $label akan dikirim ke agent ${resource.nodeName}.',
      confirmLabel: label,
      destructive: destructive,
    );
    if (!confirmed || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().resourceOperation(resource.id, action),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, '$label ${resource.name} masuk antrean.');
      await _resources.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Operasi gagal diantrekan.', error: true);
    }
  }

  Future<void> _secrets(InfraResource resource) async {
    final confirmed = await confirmAction(
      context,
      title: 'Buka secret?',
      message:
          'Nilai environment secret untuk ${resource.name} akan ditampilkan. Pastikan layar tidak '
          'terlihat orang lain.',
      confirmLabel: 'Buka',
    );
    if (!confirmed || !mounted) return;

    try {
      final secrets = await context.read<ApiService>().revealResourceSecrets(resource.id);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: context.colors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        builder: (context) => _SecretsSheet(resource: resource, secrets: secrets),
      );
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
    }
  }

  Future<void> _updateLimits(InfraResource resource) async {
    final values = await showRecordForm(
      context,
      title: 'Ubah limit ${resource.name}',
      description: 'Perubahan limit menyebabkan container dibuat ulang oleh agent.',
      submitLabel: 'Simpan',
      fields: [
        FieldSpec.integer(
          'cpuMilli',
          'CPU (millicore)',
          initial: resource.cpuMilli?.toString(),
          hint: '1000 millicore = 1 core',
          required: true,
        ),
        FieldSpec.integer(
          'memoryMb',
          'Memory (MB)',
          initial: resource.memoryBytes == null
              ? null
              : '${(int.tryParse(resource.memoryBytes!) ?? 0) ~/ (1024 * 1024)}',
          required: true,
        ),
        FieldSpec.select(
          'classification',
          'Klasifikasi',
          options: const {
            'billable': 'Billable',
            'internal': 'Internal',
            'ignored': 'Diabaikan',
          },
          initial: resource.classification,
        ),
      ],
    );
    if (values == null || !mounted) return;

    final memoryMb = int.tryParse(values['memoryMb']?.toString() ?? '');
    final cpuMilli = int.tryParse(values['cpuMilli']?.toString() ?? '');
    if (cpuMilli == null || memoryMb == null) return;

    final ok = await _action.run(
      () => context.read<ApiService>().updateResource(resource.id, <String, dynamic>{
        'name': resource.name,
        'classification': values['classification'] ?? resource.classification,
        'spec': <String, dynamic>{
          'limits': <String, dynamic>{
            'cpuMilli': cpuMilli,
            'memoryBytes': '${memoryMb * 1024 * 1024}',
          },
        },
      }),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Limit ${resource.name} diperbarui.');
      await _resources.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Limit gagal diperbarui.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<List<InfraResource>>>.value(
        value: _resources,
        child: Consumer<ItemController<List<InfraResource>>>(
          builder: (context, controller, _) {
            final all = controller.value ?? const <InfraResource>[];
            final search = _search.toLowerCase();
            final filtered = all.where((resource) {
              final matchesStatus = _filter.isEmpty || resource.observedState == _filter;
              final matchesSearch =
                  search.isEmpty ||
                  resource.name.toLowerCase().contains(search) ||
                  resource.nodeName.toLowerCase().contains(search) ||
                  (resource.templateName?.toLowerCase().contains(search) ?? false);
              return matchesStatus && matchesSearch;
            }).toList(growable: false);

            final running = all.where((resource) => resource.observedState == 'running').length;
            final billable = all.where((resource) => resource.classification == 'billable').length;

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionHeader(
                  eyebrow: 'Infrastructure',
                  title: 'Resources',
                  subtitle: 'Application dan workload yang dikelola OC Agent per node.',
                  trailing: StatusPill(label: '${all.length} total', tone: 'muted', dense: true),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: StatTile(
                        label: 'Running',
                        value: '$running',
                        detail: 'dari ${all.length} resource',
                        tone: 'success',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: StatTile(
                        label: 'Billable',
                        value: '$billable',
                        detail: '${all.length - billable} internal / ignored',
                        tone: 'info',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  onChanged: (value) => setState(() => _search = value.trim()),
                  decoration: const InputDecoration(
                    hintText: 'Cari nama, node, atau template…',
                    prefixIcon: Icon(Icons.search, size: 18),
                  ),
                ),
                const SizedBox(height: 10),
                FilterChipRow(
                  options: const <String>['', 'running', 'stopped', 'degraded', 'failed', 'unknown'],
                  selected: _filter,
                  labelBuilder: (value) =>
                      value.isEmpty ? 'Semua' : StatusPill.statusLabel(value),
                  onChanged: (value) => setState(() => _filter = value),
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: controller.refresh,
                    child: controller.isLoading && !controller.isLoaded
                        ? ListView(children: [LoadingList(count: 5, height: 120)])
                        : controller.error != null && all.isEmpty
                        ? ListView(
                            children: [
                              ErrorState(message: controller.error!, onRetry: controller.refresh),
                            ],
                          )
                        : filtered.isEmpty
                        ? ListView(
                            children: [
                              EmptyState(
                                title: 'Tidak ada resource',
                                description: all.isEmpty
                                    ? 'Deploy template atau buat aplikasi pada node yang online.'
                                    : 'Tidak ada resource yang cocok dengan filter.',
                                icon: Icons.widgets_outlined,
                              ),
                            ],
                          )
                        : ListView.separated(
                            itemCount: filtered.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 9),
                            itemBuilder: (context, index) {
                              final resource = filtered[index];
                              return _ResourceCard(
                                resource: resource,
                                busy: _action.isPending,
                                onOperation: _operation,
                                onSecrets: _secrets,
                                onLimits: _updateLimits,
                              );
                            },
                          ),
                  ),
                ),
                if (controller.error != null && all.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      controller.error!,
                      style: TextStyle(fontSize: 11, color: colors.danger),
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

class _ResourceCard extends StatelessWidget {
  const _ResourceCard({
    required this.resource,
    required this.busy,
    required this.onOperation,
    required this.onSecrets,
    required this.onLimits,
  });

  final InfraResource resource;
  final bool busy;
  final Future<void> Function(InfraResource, String) onOperation;
  final Future<void> Function(InfraResource) onSecrets;
  final Future<void> Function(InfraResource) onLimits;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final drifted = resource.desiredRevision != resource.observedRevision;

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
            padding: const EdgeInsets.fromLTRB(14, 11, 6, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        resource.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: colors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${resource.nodeName} · ${resource.kind}'
                        '${resource.templateName != null ? ' · ${resource.templateName}' : ''}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 11, color: colors.muted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    StatusPill.status(resource.observedState, dense: true),
                    if (drifted)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: StatusPill(
                          label: 'rev ${resource.observedRevision}/${resource.desiredRevision}',
                          tone: 'warning',
                          dense: true,
                        ),
                      ),
                  ],
                ),
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, size: 18),
                  enabled: !busy,
                  onSelected: (value) {
                    if (_lifecycleActions.containsKey(value)) {
                      onOperation(resource, value);
                    } else if (value == 'secrets') {
                      onSecrets(resource);
                    } else if (value == 'limits') {
                      onLimits(resource);
                    }
                  },
                  itemBuilder: (context) => [
                    if (resource.isApplication) ...[
                      if (resource.observedState != 'running')
                        const PopupMenuItem(value: 'application.start', child: Text('Start')),
                      if (resource.observedState == 'running') ...[
                        const PopupMenuItem(value: 'application.stop', child: Text('Stop')),
                        const PopupMenuItem(
                          value: 'application.restart',
                          child: Text('Restart'),
                        ),
                      ],
                      const PopupMenuItem(
                        value: 'application.redeploy',
                        child: Text('Redeploy'),
                      ),
                      const PopupMenuItem(value: 'limits', child: Text('Ubah limit')),
                      const PopupMenuItem(value: 'secrets', child: Text('Buka secret')),
                      const PopupMenuItem(
                        value: 'application.delete',
                        child: Text('Hapus application'),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          Divider(height: 1, color: colors.line),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 8, 14, 11),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    StatusPill(
                      label: Fmt.label(resource.classification),
                      tone: resource.classification == 'billable' ? 'info' : 'muted',
                      dense: true,
                    ),
                    if (resource.cpuMilli != null)
                      StatusPill(
                        label: Fmt.cpu(resource.cpuMilli! / 1000),
                        tone: 'muted',
                        dense: true,
                      ),
                    if (resource.memoryBytes != null)
                      StatusPill(
                        label: Fmt.bytes(resource.memoryBytes),
                        tone: 'muted',
                        dense: true,
                      ),
                    if (resource.billingGateEnabled)
                      const StatusPill(label: 'billing gate', tone: 'warning', dense: true),
                    if (resource.routeHostname != null)
                      StatusPill(
                        label: resource.routeHostname!,
                        tone: resource.routeStatus == 'configured' ? 'success' : 'warning',
                        dense: true,
                      ),
                  ],
                ),
                if (resource.imageReference != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 7),
                    child: Text(
                      resource.imageReference!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontFamily: 'monospace',
                        color: colors.muted,
                      ),
                    ),
                  ),
                if (resource.lastObservedAt != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text(
                      'Diobservasi ${Fmt.relativeTime(resource.lastObservedAt)}',
                      style: TextStyle(fontSize: 10.5, color: colors.muted),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SecretsSheet extends StatefulWidget {
  const _SecretsSheet({required this.resource, required this.secrets});

  final InfraResource resource;
  final List<ResourceSecret> secrets;

  @override
  State<_SecretsSheet> createState() => _SecretsSheetState();
}

class _SecretsSheetState extends State<_SecretsSheet> {
  final Set<String> _visible = <String>{};

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.55,
      maxChildSize: 0.9,
      builder: (context, scrollController) {
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Secret ${widget.resource.name}',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                        Text(
                          'Jangan bagikan nilai ini. Tutup sheet setelah selesai.',
                          style: TextStyle(fontSize: 11, color: colors.muted),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, size: 18),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: colors.line),
            Expanded(
              child: widget.secrets.isEmpty
                  ? const EmptyState(
                      title: 'Tidak ada secret',
                      description: 'Resource ini tidak menyimpan environment secret.',
                      icon: Icons.lock_outline,
                    )
                  : ListView.separated(
                      controller: scrollController,
                      padding: const EdgeInsets.all(14),
                      itemCount: widget.secrets.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final secret = widget.secrets[index];
                        final visible = _visible.contains(secret.environmentKey);
                        return Container(
                          padding: const EdgeInsets.all(11),
                          decoration: BoxDecoration(
                            color: colors.canvas,
                            borderRadius: BorderRadius.circular(9),
                            border: Border.all(color: colors.line),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      secret.environmentKey,
                                      style: TextStyle(
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w700,
                                        fontFamily: 'monospace',
                                        color: colors.muted,
                                      ),
                                    ),
                                  ),
                                  IconButton(
                                    visualDensity: VisualDensity.compact,
                                    onPressed: () => setState(() {
                                      if (visible) {
                                        _visible.remove(secret.environmentKey);
                                      } else {
                                        _visible.add(secret.environmentKey);
                                      }
                                    }),
                                    icon: Icon(
                                      visible
                                          ? Icons.visibility_off_outlined
                                          : Icons.visibility_outlined,
                                      size: 16,
                                    ),
                                  ),
                                  IconButton(
                                    visualDensity: VisualDensity.compact,
                                    onPressed: () async {
                                      await Clipboard.setData(
                                        ClipboardData(text: secret.value),
                                      );
                                      if (context.mounted) {
                                        showAppSnack(context, 'Secret disalin.');
                                      }
                                    },
                                    icon: const Icon(Icons.copy, size: 15),
                                  ),
                                ],
                              ),
                              SelectableText(
                                visible ? secret.value : '••••••••••••',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  height: 1.45,
                                  fontFamily: 'monospace',
                                  color: colors.ink,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}
