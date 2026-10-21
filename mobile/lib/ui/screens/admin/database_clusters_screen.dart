import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/platform.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class DatabaseClustersScreen extends StatefulWidget {
  const DatabaseClustersScreen({super.key});

  @override
  State<DatabaseClustersScreen> createState() => _DatabaseClustersScreenState();
}

class _DatabaseClustersScreenState extends State<DatabaseClustersScreen> {
  late final ItemController<DatabaseOverview> _overview;
  final _action = ActionController();

  @override
  void initState() {
    super.initState();
    _overview = ItemController<DatabaseOverview>(
      fetch: context.read<ApiService>().databaseOverview,
    );
    _overview.load();
  }

  @override
  void dispose() {
    _overview.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _activate(DatabaseOverview overview) async {
    if (overview.candidates.isEmpty) {
      showAppSnack(
        context,
        'Belum ada resource PostgreSQL yang bisa dijadikan cluster.',
        error: true,
      );
      return;
    }

    final values = await showRecordForm(
      context,
      title: 'Aktivasi database cluster',
      description:
          'Cluster memakai resource PostgreSQL yang sudah berjalan. Agent akan menjalankan preflight '
          'sebelum cluster dipakai untuk provisioning.',
      submitLabel: 'Aktivasi',
      fields: [
        FieldSpec.select(
          'resourceId',
          'Resource PostgreSQL',
          options: {
            for (final candidate in overview.candidates)
              candidate.id: '${candidate.name} · ${candidate.nodeName} '
                  '(${candidate.observedState})',
          },
          required: true,
        ),
        FieldSpec.text('name', 'Nama cluster', hint: 'slug lowercase', required: true),
        FieldSpec.integer(
          'defaultConnectionLimit',
          'Connection limit default',
          initial: '20',
          required: true,
        ),
      ],
    );
    if (values == null || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().activateCluster(<String, dynamic>{
        'resourceId': values['resourceId'],
        'name': values['name'],
        'defaultConnectionLimit': int.tryParse(values['defaultConnectionLimit']?.toString() ?? '') ?? 20,
      }),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Preflight cluster ${values['name']} dijadwalkan.');
      await _overview.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Cluster gagal diaktifkan.', error: true);
    }
  }

  Future<void> _provision(DatabaseOverview overview, DatabaseCluster cluster) async {
    if (overview.eligibleServices.isEmpty) {
      showAppSnack(context, 'Belum ada service aktif untuk diberi database.', error: true);
      return;
    }

    final values = await showRecordForm(
      context,
      title: 'Provision database',
      description:
          'Database dan role dedicated dibuat di ${cluster.name}, lalu credential dikirim ke '
          'aplikasi service.',
      submitLabel: 'Provision',
      fields: [
        FieldSpec.select(
          'serviceId',
          'Service',
          options: {
            for (final service in overview.eligibleServices)
              service.id: '${service.serviceNumber} · ${service.name}',
          },
          required: true,
        ),
        FieldSpec.select(
          'applicationResourceId',
          'Application target',
          options: {
            for (final application in overview.eligibleApplications)
              application.id: '${application.name} · ${application.nodeName}',
          },
          hint: 'Aplikasi yang akan diredeploy dengan credential baru',
        ),
        FieldSpec.text(
          'environmentKey',
          'Environment key',
          initial: 'DATABASE_URL',
          required: true,
        ),
      ],
    );
    if (values == null || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().provisionDatabase(cluster.id, <String, dynamic>{
        'serviceId': values['serviceId'],
        'applicationResourceId': values['applicationResourceId'],
        'environmentKey': values['environmentKey'] ?? 'DATABASE_URL',
      }),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Provisioning database dijadwalkan. Aplikasi akan diredeploy.');
      await _overview.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Provisioning gagal dijadwalkan.', error: true);
    }
  }

  Future<void> _reveal(DatabaseAllocation allocation) async {
    final confirmed = await confirmAction(
      context,
      title: 'Buka credential?',
      message:
          'Connection URI untuk ${allocation.databaseName} akan ditampilkan. Nilai ini memberi akses '
          'penuh ke database.',
      confirmLabel: 'Buka',
    );
    if (!confirmed || !mounted) return;

    try {
      final credential = await context.read<ApiService>().revealDatabaseCredential(allocation.id);
      if (!mounted) return;
      if (credential == null) {
        showAppSnack(context, 'Credential tidak tersedia.', error: true);
        return;
      }
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: context.colors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        builder: (context) => _CredentialSheet(credential: credential),
      );
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
    }
  }

  Future<void> _allocationAction(DatabaseAllocation allocation, String action) async {
    final rotate = action == 'rotate';    final confirmed = await confirmAction(
      context,
      title: rotate ? 'Rotasi credential?' : 'Retry provisioning?',
      message: rotate
          ? 'Password role ${allocation.roleName} diganti dan aplikasi diredeploy dengan credential '
                'baru. Koneksi lama akan putus.'
          : 'Agent akan mengulang pembuatan database dan role untuk ${allocation.databaseName}.',
      confirmLabel: rotate ? 'Rotasi' : 'Retry',
      destructive: rotate,
    );
    if (!confirmed || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().allocationAction(allocation.id, action),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, rotate ? 'Rotasi credential dijadwalkan.' : 'Retry dijadwalkan.');
      await _overview.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Operasi gagal dijadwalkan.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<DatabaseOverview>>.value(
        value: _overview,
        child: Consumer<ItemController<DatabaseOverview>>(
          builder: (context, controller, _) {
            final overview = controller.value ?? DatabaseOverview.empty;
            final backupsByAllocation = <String, List<ClusterBackup>>{};
            for (final backup in overview.backups) {
              backupsByAllocation
                  .putIfAbsent(backup.serviceDatabaseId, () => <ClusterBackup>[])
                  .add(backup);
            }

            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Infrastructure',
                  title: 'Database clusters',
                  subtitle:
                      'Cluster PostgreSQL native dengan database dan role dedicated per service.',
                  trailing: StatusPill(
                    label: '${overview.clusters.length} cluster',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _action.isPending ? null : () => _activate(overview),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Aktivasi cluster'),
                  ),
                ),
                const SizedBox(height: 14),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 3, height: 150)
                else if (controller.error != null && overview.clusters.isEmpty)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else if (overview.clusters.isEmpty)
                  const AppCard(
                    child: EmptyState(
                      title: 'Belum ada cluster',
                      description:
                          'Deploy PostgreSQL lewat template, lalu aktifkan resource tersebut sebagai '
                          'database cluster.',
                      icon: Icons.storage_outlined,
                    ),
                  )
                else
                  for (final cluster in overview.clusters) ...[
                    _ClusterCard(
                      cluster: cluster,
                      busy: _action.isPending,
                      onProvision: () => _provision(overview, cluster),
                    ),
                    const SizedBox(height: 10),
                  ],
                if (overview.allocations.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  SectionHeader(
                    eyebrow: 'Provisioning',
                    title: 'Service databases',
                    subtitle: 'Database dan role yang dipakai aplikasi customer.',
                  ),
                  const SizedBox(height: 10),
                  for (final allocation in overview.allocations) ...[
                    _AllocationCard(
                      allocation: allocation,
                      backups: backupsByAllocation[allocation.id] ?? const <ClusterBackup>[],
                      busy: _action.isPending,
                      onReveal: () => _reveal(allocation),
                      onAction: (action) => _allocationAction(allocation, action),
                    ),
                    const SizedBox(height: 8),
                  ],
                ],
                if (controller.error != null && overview.clusters.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
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

class _ClusterCard extends StatelessWidget {
  const _ClusterCard({
    required this.cluster,
    required this.busy,
    required this.onProvision,
  });

  final DatabaseCluster cluster;
  final bool busy;
  final VoidCallback onProvision;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final provisioningReady = cluster.isActive &&
        cluster.status == 'active' &&
        cluster.resourceState == 'running' &&
        (cluster.nodeStatus == 'online' || cluster.nodeStatus == 'degraded');

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      cluster.name,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: colors.ink,
                      ),
                    ),
                    Text(
                      '${cluster.engine} ${cluster.mode} · ${cluster.primaryResourceName}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11, color: colors.muted),
                    ),
                  ],
                ),
              ),
              StatusPill.status(cluster.status, dense: true),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              StatusPill(
                label: '${cluster.nodeName} · ${cluster.nodeStatus}',
                tone: cluster.nodeStatus == 'online' ? 'success' : 'warning',
                dense: true,
              ),
              StatusPill(
                label: 'resource ${cluster.resourceState}',
                tone: cluster.resourceState == 'running' ? 'success' : 'muted',
                dense: true,
              ),
              StatusPill(label: 'agent ${cluster.agentVersion}', tone: 'muted', dense: true),
              StatusPill(
                label: 'limit ${cluster.defaultConnectionLimit}',
                tone: 'muted',
                dense: true,
              ),
            ],
          ),
          if (cluster.lastError != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                cluster.lastError!,
                style: TextStyle(fontSize: 11, height: 1.4, color: colors.danger),
              ),
            ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: busy || !provisioningReady ? null : onProvision,
              icon: const Icon(Icons.add_box_outlined, size: 15),
              label: const Text('Provision database'),
            ),
          ),
        ],
      ),
    );
  }
}

class _AllocationCard extends StatelessWidget {
  const _AllocationCard({
    required this.allocation,
    required this.backups,
    required this.busy,
    required this.onReveal,
    required this.onAction,
  });

  final DatabaseAllocation allocation;
  final List<ClusterBackup> backups;
  final bool busy;
  final VoidCallback onReveal;
  final ValueChanged<String> onAction;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final canAct = allocation.status == 'failed' || allocation.status == 'provisioning';

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      allocation.databaseName,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'monospace',
                        color: colors.ink,
                      ),
                    ),
                    Text(
                      '${allocation.serviceNumber} · ${allocation.serviceName}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 10.5, color: colors.muted),
                    ),
                  ],
                ),
              ),
              StatusPill.status(allocation.status, dense: true),
            ],
          ),
          const SizedBox(height: 7),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              StatusPill(label: allocation.roleName, tone: 'muted', dense: true),
              StatusPill(label: allocation.environmentKey, tone: 'info', dense: true),
              StatusPill(label: allocation.clusterName, tone: 'muted', dense: true),
              if (allocation.applicationName.isNotEmpty)
                StatusPill(label: allocation.applicationName, tone: 'muted', dense: true),
              if (backups.isNotEmpty)
                StatusPill(
                  label: '${backups.length} backup',
                  tone: 'muted',
                  dense: true,
                ),
            ],
          ),
          if (allocation.lastError != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                allocation.lastError!,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 10.5, height: 1.4, color: colors.danger),
              ),
            ),
          const SizedBox(height: 8),
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 6,
            runSpacing: 6,
            children: [
              if (canAct)
                TextButton(
                  onPressed: busy ? null : () => onAction('retry'),
                  child: const Text('Retry', style: TextStyle(fontSize: 12)),
                ),
              TextButton(
                onPressed: busy ? null : () => onAction('rotate'),
                child: const Text('Rotasi', style: TextStyle(fontSize: 12)),
              ),
              OutlinedButton.icon(
                onPressed: busy ? null : onReveal,
                icon: const Icon(Icons.key_outlined, size: 14),
                label: const Text('Credential', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CredentialSheet extends StatelessWidget {
  const _CredentialSheet({required this.credential});

  final DatabaseCredential credential;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Credential ${credential.databaseName}',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.ink),
            ),
            const SizedBox(height: 4),
            Text(
              'Role ${credential.roleName}. Jangan bagikan nilai ini.',
              style: TextStyle(fontSize: 11.5, color: colors.muted),
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: colors.canvas,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: colors.line),
              ),
              child: SelectableText(
                credential.connectionUri,
                style: TextStyle(
                  fontSize: 11.5,
                  height: 1.5,
                  fontFamily: 'monospace',
                  color: colors.ink,
                ),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: credential.connectionUri));
                if (context.mounted) showAppSnack(context, 'Connection URI disalin.');
              },
              icon: const Icon(Icons.copy, size: 15),
              label: const Text('Salin connection URI'),
            ),
          ],
        ),
      ),
    );
  }
}
