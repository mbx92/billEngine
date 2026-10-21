import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/infrastructure.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class ServersScreen extends StatefulWidget {
  const ServersScreen({super.key});

  @override
  State<ServersScreen> createState() => _ServersScreenState();
}

class _ServersScreenState extends State<ServersScreen> {
  late final ItemController<List<InfraNode>> _nodes;
  final _action = ActionController();

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _nodes = ItemController<List<InfraNode>>(fetch: api.nodes);
    _nodes.load();
  }

  @override
  void dispose() {
    _nodes.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _enroll() async {
    final values = await showRecordForm(
      context,
      title: 'Daftarkan node Ubuntu',
      description:
          'Buat enrollment token, install OC Agent pada Ubuntu Server, lalu jalankan servicenya.',
      submitLabel: 'Buat token',
      fields: [
        FieldSpec.text('nodeName', 'Nama node', required: true),
        FieldSpec.select(
          'environment',
          'Environment',
          options: const {
            'development': 'Development',
            'staging': 'Staging',
          },
          initial: 'staging',
          required: true,
        ),
        FieldSpec.select(
          'role',
          'Peran node',
          options: const {
            'deployment': 'Deployment',
            'builder': 'Image builder',
            'hybrid': 'Hybrid',
          },
          initial: 'deployment',
        ),
        FieldSpec.text('region', 'Region (label)', hint: 'Contoh: jkt-1'),
      ],
    );
    if (values == null || !mounted) return;

    final api = context.read<ApiService>();
    try {
      final result = await api.createNodeEnrollment(<String, dynamic>{
        'nodeName': values['nodeName'],
        'environment': values['environment'],
        'role': values['role'] ?? 'deployment',
        'expiresInMinutes': 30,
        'labels': <String, String>{
          if (values['region'] != null) 'region': values['region'] as String,
        },
      });
      if (!mounted) return;
      final token = result['token']?.toString() ?? '';
      await _showEnrollment(context, values['nodeName'] as String, token);
      await _nodes.refresh();
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
    }
  }

  Future<void> _showEnrollment(BuildContext context, String nodeName, String token) {
    final controlPlane = context.read<ApiService>().baseUrl;
    final command =
        "curl -fsSL '$controlPlane/install/oc-agent.sh' | sudo bash -s -- --url '$controlPlane'";

    return showDialog<void>(
      context: context,
      builder: (context) {
        final colors = context.colors;
        return AlertDialog(
          backgroundColor: colors.surface,
          insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          title: const Text(
            'Enrollment token',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Token hanya ditampilkan satu kali. Jalankan installer pada $nodeName.',
                  style: TextStyle(fontSize: 12, height: 1.5, color: colors.muted),
                ),
                const SizedBox(height: 12),
                _copyBlock(context, 'TOKEN', token, monospace: true),
                const SizedBox(height: 10),
                _copyBlock(context, 'PERINTAH INSTALLER', command, monospace: true),
                const SizedBox(height: 10),
                Text(
                  'Agent hanya dapat di-enroll dari Ubuntu Server dan protocol harus sesuai.',
                  style: TextStyle(fontSize: 10.5, height: 1.5, color: colors.muted),
                ),
              ],
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Selesai'),
            ),
          ],
        );
      },
    );
  }

  Widget _copyBlock(
    BuildContext context,
    String label,
    String value, {
    bool monospace = false,
  }) {
    final colors = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 9.5,
                  letterSpacing: 1,
                  fontWeight: FontWeight.w700,
                  color: colors.muted,
                ),
              ),
            ),
            TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: value));
                if (context.mounted) showAppSnack(context, '$label disalin.');
              },
              icon: const Icon(Icons.copy, size: 13),
              label: const Text('Salin', style: TextStyle(fontSize: 11)),
            ),
          ],
        ),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: colors.canvas,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: colors.line),
          ),
          child: SelectableText(
            value,
            style: TextStyle(
              fontSize: 11,
              height: 1.5,
              fontFamily: monospace ? 'monospace' : null,
              color: colors.ink,
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _agentAction(InfraNode node, String action) async {
    final label = action == 'upgrade' ? 'Upgrade' : 'Rollback';
    final confirmed = await confirmAction(
      context,
      title: '$label agent ${node.name}?',
      message: action == 'upgrade'
          ? 'Node akan diarahkan ke versi ${node.availableAgentVersion}. Operasi masuk antrean agent.'
          : 'Node akan dikembalikan ke versi ${node.previousAgentVersion ?? 'sebelumnya'}.',
      confirmLabel: label,
    );
    if (!confirmed || !mounted) return;

    final api = context.read<ApiService>();
    final ok = await _action.run(() async {
      if (action == 'upgrade') {
        await api.upgradeNode(node.id);
      } else {
        await api.rollbackNode(node.id);
      }
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, '$label ${node.name} masuk antrean.');
      await _nodes.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Gagal mengantrekan $action.', error: true);
    }
  }

  Future<void> _changeRole(InfraNode node) async {
    final role = await showDialog<String>(
      context: context,
      builder: (context) {
        final colors = context.colors;
        return SimpleDialog(
          backgroundColor: colors.surface,
          title: const Text(
            'Peran node',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
          children: [
            for (final entry in const <String, String>{
              'deployment': 'Deployment — menerima workload dan gateway',
              'builder': 'Image builder — hanya pekerjaan build',
              'hybrid': 'Hybrid — workload sekaligus build',
            }.entries)
              SimpleDialogOption(
                onPressed: () => Navigator.of(context).pop(entry.key),
                child: Row(
                  children: [
                    Icon(
                      entry.key == node.role ? Icons.radio_button_checked : Icons.radio_button_off,
                      size: 16,
                      color: entry.key == node.role ? colors.brand : colors.muted,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(entry.value, style: const TextStyle(fontSize: 12.5)),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
    if (role == null || role == node.role || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().updateNodeRole(node.id, role),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Peran ${node.name} diperbarui.');
      await _nodes.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Peran node gagal diperbarui.', error: true);
    }
  }

  Future<void> _revoke(InfraNode node) async {
    final confirmed = await confirmAction(
      context,
      title: 'Cabut kredensial node?',
      message:
          '${node.name} tidak akan bisa mengirim heartbeat atau menerima operasi lagi. '
          'Resource yang berjalan tidak otomatis dihapus.',
      confirmLabel: 'Cabut',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    final ok = await _action.run(() => context.read<ApiService>().revokeNode(node.id));
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Kredensial node dicabut.');
      await _nodes.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Node gagal dicabut.', error: true);
    }
  }

  Future<void> _images(InfraNode node) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _ImagesSheet(node: node, onDeleted: _nodes.refresh),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      floatingAction: FloatingActionButton.extended(
        onPressed: _action.isPending ? null : _enroll,
        icon: const Icon(Icons.dns_outlined, size: 18),
        label: const Text('Node'),
      ),
      child: ChangeNotifierProvider<ItemController<List<InfraNode>>>.value(
        value: _nodes,
        child: Consumer<ItemController<List<InfraNode>>>(
          builder: (context, controller, _) {
            final nodes = controller.value ?? const <InfraNode>[];
            final online = nodes.where((node) => node.status == 'online').length;
            final offline = nodes.length - online;

            return RefreshIndicator(
              onRefresh: controller.refresh,
              child: ListView(
                children: [
                  SectionHeader(
                    eyebrow: 'Infrastructure',
                    title: 'Servers',
                    subtitle:
                        'Node Ubuntu yang menjalankan OC Agent, gateway, dan workload pelanggan.',
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: StatTile(
                          label: 'Online',
                          value: '$online',
                          detail: '${nodes.length} node terdaftar',
                          tone: 'success',
                          icon: Icons.check_circle_outline,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: StatTile(
                          label: 'Offline / revoked',
                          value: '$offline',
                          detail: 'Perlu perhatian',
                          tone: offline > 0 ? 'warning' : 'neutral',
                          icon: Icons.error_outline,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  if (controller.isLoading && !controller.isLoaded)
                    const LoadingList(count: 3, height: 180)
                  else if (controller.error != null && nodes.isEmpty)
                    AppCard(
                      child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                    )
                  else if (nodes.isEmpty)
                    AppCard(
                      child: EmptyState(
                        title: 'Belum ada node Ubuntu',
                        description:
                            'Buat enrollment token, install OC Agent pada Ubuntu Server, lalu jalankan servicenya.',
                        icon: Icons.dns_outlined,
                        action: FilledButton(
                          onPressed: _enroll,
                          child: const Text('Daftarkan node'),
                        ),
                      ),
                    )
                  else
                    for (final node in nodes) ...[
                      _NodeCard(
                        node: node,
                        busy: _action.isPending,
                        onUpgrade: () => _agentAction(node, 'upgrade'),
                        onRollback: () => _agentAction(node, 'rollback'),
                        onRole: () => _changeRole(node),
                        onRevoke: () => _revoke(node),
                        onImages: () => _images(node),
                      ),
                      const SizedBox(height: 10),
                    ],
                  if (controller.error != null && nodes.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        controller.error!,
                        style: TextStyle(fontSize: 11.5, color: colors.danger),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _NodeCard extends StatelessWidget {
  const _NodeCard({
    required this.node,
    required this.busy,
    required this.onUpgrade,
    required this.onRollback,
    required this.onRole,
    required this.onRevoke,
    required this.onImages,
  });

  final InfraNode node;
  final bool busy;
  final VoidCallback onUpgrade;
  final VoidCallback onRollback;
  final VoidCallback onRole;
  final VoidCallback onRevoke;
  final VoidCallback onImages;

  String _memoryUsage() {
    if (node.memoryUsedBytes == null || node.capacityMemoryBytes == null) return '—';
    final used = double.tryParse(node.memoryUsedBytes!) ?? 0;
    final total = double.tryParse(node.capacityMemoryBytes!) ?? 0;
    if (total <= 0) return '—';
    return '${Fmt.number((used / total) * 100, decimals: 1)}%';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final cpu = node.cpuUsageBasisPoints == null
        ? '—'
        : Fmt.basisPoints(node.cpuUsageBasisPoints);
    final disk = node.diskUsageBasisPoints == null
        ? '—'
        : Fmt.basisPoints(node.diskUsageBasisPoints);

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
            padding: const EdgeInsets.fromLTRB(14, 12, 6, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.dns_outlined, size: 14, color: colors.muted),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              node.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: colors.ink,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${Fmt.label(node.environment)} · ${Fmt.label(node.role)}'
                        '${node.isDraining ? ' · draining' : ''}',
                        style: TextStyle(fontSize: 11, color: colors.muted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    StatusPill.status(node.status, dense: true),
                    if (node.upgradeAvailable)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: StatusPill(
                          label: 'Update ${node.availableAgentVersion}',
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
                    switch (value) {
                      case 'upgrade':
                        onUpgrade();
                      case 'rollback':
                        onRollback();
                      case 'role':
                        onRole();
                      case 'revoke':
                        onRevoke();
                      case 'images':
                        onImages();
                    }
                  },
                  itemBuilder: (context) => [
                    if (node.upgradeAvailable && node.remoteUpdateSupported)
                      const PopupMenuItem(value: 'upgrade', child: Text('Upgrade agent')),
                    if (node.previousAgentVersion != null)
                      const PopupMenuItem(value: 'rollback', child: Text('Rollback agent')),
                    const PopupMenuItem(value: 'role', child: Text('Ubah peran')),
                    const PopupMenuItem(value: 'images', child: Text('Docker images')),
                    if (node.isActive)
                      const PopupMenuItem(value: 'revoke', child: Text('Cabut kredensial')),
                  ],
                ),
              ],
            ),
          ),
          Divider(height: 1, color: colors.line),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    StatusPill(
                      label: 'agent ${node.agentVersion.isEmpty ? '—' : node.agentVersion}',
                      tone: 'info',
                      dense: true,
                    ),
                    StatusPill(
                      label: 'gateway ${node.gatewayStatus}',
                      tone: StatusPill.statusTone(node.gatewayStatus),
                      dense: true,
                    ),
                    StatusPill(
                      label: '${node.resourceCount} resource',
                      tone: 'muted',
                      dense: true,
                    ),
                    StatusPill(
                      label: 'disk ${Fmt.label(node.diskWatermark)}',
                      tone: switch (node.diskWatermark) {
                        'critical' => 'danger',
                        'warning' => 'warning',
                        'normal' => 'success',
                        _ => 'muted',
                      },
                      dense: true,
                    ),
                    if (node.stuckOperationCount > 0)
                      StatusPill(
                        label: '${node.stuckOperationCount} operasi macet',
                        tone: 'danger',
                        dense: true,
                      ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _usage(context, 'CPU', cpu),
                    _usage(context, 'RAM', _memoryUsage()),
                    _usage(context, 'Disk', disk),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Kapasitas ${Fmt.cpu(node.capacityCpuMilli == null ? null : node.capacityCpuMilli! / 1000)}'
                        ' · ${Fmt.bytes(node.capacityMemoryBytes)}',
                        style: TextStyle(fontSize: 10.5, color: colors.muted),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Heartbeat ${Fmt.relativeTime(node.lastHeartbeatAt)} · '
                  'inventory ${Fmt.relativeTime(node.lastInventoryAt)}',
                  style: TextStyle(fontSize: 10.5, color: colors.muted),
                ),
                if (node.osRelease.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      '${node.osRelease} · ${node.architecture} · docker ${node.dockerVersion ?? '—'}',
                      style: TextStyle(fontSize: 10.5, color: colors.muted),
                    ),
                  ),
                if (node.lastError != null || node.gatewayLastError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      node.lastError ?? node.gatewayLastError!,
                      style: TextStyle(fontSize: 10.5, height: 1.4, color: colors.danger),
                    ),
                  ),
                if (node.agentLastUpdateError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Agent update: ${node.agentLastUpdateError}',
                      style: TextStyle(fontSize: 10.5, height: 1.4, color: colors.warning),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _usage(BuildContext context, String label, String value) {
    final colors = context.colors;
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 9,
              letterSpacing: 0.6,
              fontWeight: FontWeight.w600,
              color: colors.muted,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: colors.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _ImagesSheet extends StatefulWidget {
  const _ImagesSheet({required this.node, required this.onDeleted});

  final InfraNode node;
  final Future<void> Function() onDeleted;

  @override
  State<_ImagesSheet> createState() => _ImagesSheetState();
}

class _ImagesSheetState extends State<_ImagesSheet> {
  late List<DockerImage> _images;
  String? _deleting;

  @override
  void initState() {
    super.initState();
    _images = List<DockerImage>.of(widget.node.images);
  }

  Future<void> _delete(DockerImage image) async {
    final confirmed = await confirmAction(
      context,
      title: 'Hapus image?',
      message: 'Image ${image.id.substring(0, image.id.length.clamp(0, 19))}… akan dihapus dari '
          '${widget.node.name}. Image yang masih dipakai container tidak dapat dihapus.',
      confirmLabel: 'Hapus',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    setState(() => _deleting = image.id);
    try {
      await context.read<ApiService>().deleteNodeImage(widget.node.id, image.id);
      if (!mounted) return;
      setState(() {
        _images = _images.where((row) => row.id != image.id).toList(growable: false);
        _deleting = null;
      });
      await widget.onDeleted();
      if (mounted) showAppSnack(context, 'Image dihapus.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _deleting = null);
      showAppSnack(context, '$error', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
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
                          'Docker images',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                        Text(
                          '${_images.length} image · ${widget.node.name}',
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
              child: _images.isEmpty
                  ? const EmptyState(
                      title: 'Belum ada image',
                      description: 'Inventory image terbaca dari heartbeat agent.',
                      icon: Icons.inventory_2_outlined,
                    )
                  : ListView.separated(
                      controller: scrollController,
                      padding: const EdgeInsets.all(14),
                      itemCount: _images.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final image = _images[index];
                        final name = image.references.isEmpty
                            ? image.id
                            : image.references.first;
                        return Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: colors.canvas,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: colors.line),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  color: colors.ink,
                                ),
                              ),
                              const SizedBox(height: 5),
                              Row(
                                children: [
                                  StatusPill(
                                    label: image.used
                                        ? 'dipakai ${image.containerCount}'
                                        : 'tidak dipakai',
                                    tone: image.used ? 'info' : 'muted',
                                    dense: true,
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    Fmt.bytes(image.sizeBytes),
                                    style: TextStyle(fontSize: 10.5, color: colors.muted),
                                  ),
                                  const Spacer(),
                                  if (!image.used)
                                    TextButton(
                                      onPressed: _deleting == image.id
                                          ? null
                                          : () => _delete(image),
                                      style: TextButton.styleFrom(
                                        minimumSize: const Size(0, 30),
                                        foregroundColor: colors.danger,
                                      ),
                                      child: Text(
                                        _deleting == image.id ? 'Menghapus…' : 'Hapus',
                                        style: const TextStyle(fontSize: 11),
                                      ),
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
      },
    );
  }
}
