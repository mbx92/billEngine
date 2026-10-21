import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/platform.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class BackupsScreen extends StatefulWidget {
  const BackupsScreen({super.key});

  @override
  State<BackupsScreen> createState() => _BackupsScreenState();
}

class _BackupsScreenState extends State<BackupsScreen> {
  late final ItemController<BackupOverview> _overview;
  final _action = ActionController();
  Timer? _timer;
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    _overview = ItemController<BackupOverview>(
      fetch: context.read<ApiService>().backupOverview,
    );
    _overview.load();
    _timer = Timer.periodic(const Duration(seconds: 6), (_) {
      final runs = _overview.value?.runs ?? const <BackupRun>[];
      final active = runs.any(
        (run) => const <String>['queued', 'creating', 'restoring', 'deleting'].contains(run.status),
      );
      if (mounted && active) _overview.load(refresh: true);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _overview.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _createTarget() async {
    final values = await showRecordForm(
      context,
      title: 'Storage target S3',
      description: 'Endpoint S3 compatible untuk menyimpan dump database.',
      submitLabel: 'Simpan target',
      fields: [
        FieldSpec.text('name', 'Nama target', required: true),
        FieldSpec.text('endpoint', 'Endpoint', hint: 'https://s3.example.com', required: true),
        FieldSpec.text('region', 'Region', initial: 'auto', required: true),
        FieldSpec.text('bucket', 'Bucket', required: true),
        FieldSpec.text('prefix', 'Prefix object', initial: 'oc-backups'),
        FieldSpec.toggle('pathStyle', 'Path style URL'),
        FieldSpec.text('accessKey', 'Access key', required: true),
        FieldSpec.password('secretKey', 'Secret key', required: true),
      ],
    );
    if (values == null || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().createBackupTarget(<String, dynamic>{
        ...values,
        'pathStyle': values['pathStyle'] ?? false,
      }),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Storage target ${values['name']} disimpan.');
      await _overview.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Storage target gagal dibuat.', error: true);
    }
  }

  Future<void> _createPolicy(BackupOverview overview, {BackupSource? source}) async {
    if (overview.targets.isEmpty) {
      showAppSnack(context, 'Buat storage target terlebih dahulu.', error: true);
      return;
    }
    if (overview.sources.isEmpty) {
      showAppSnack(context, 'Belum ada service database untuk dibackup.', error: true);
      return;
    }

    final values = await showRecordForm(
      context,
      title: 'Backup policy',
      description: 'Jadwal backup otomatis untuk satu database service.',
      submitLabel: 'Simpan policy',
      fields: [
        FieldSpec.text(
          'name',
          'Nama policy',
          initial: source == null ? null : '${source.databaseName}-daily',
          required: true,
        ),
        FieldSpec.select(
          'serviceDatabaseId',
          'Database',
          options: {
            for (final candidate in overview.sources)
              candidate.id: '${candidate.databaseName} · ${candidate.serviceNumber}',
          },
          initial: source?.id ?? overview.sources.first.id,
          required: true,
        ),
        FieldSpec.select(
          'storageTargetId',
          'Storage target',
          options: {
            for (final target in overview.targets) target.id: '${target.name} · ${target.bucket}',
          },
          initial: overview.targets.first.id,
          required: true,
        ),
        FieldSpec.integer('intervalMinutes', 'Interval (menit)', initial: '1440', required: true),
        FieldSpec.integer('retentionCount', 'Retensi (jumlah backup)', initial: '14', required: true),
        FieldSpec.email('alertEmail', 'Email notifikasi'),
      ],
    );
    if (values == null || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().createBackupPolicy(<String, dynamic>{
        ...values,
        'intervalMinutes': int.tryParse(values['intervalMinutes']?.toString() ?? '') ?? 1440,
        'retentionCount': int.tryParse(values['retentionCount']?.toString() ?? '') ?? 14,
      }),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Policy ${values['name']} aktif.');
      await _overview.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Policy gagal dibuat.', error: true);
    }
  }

  Future<void> _runBackup(BackupSource source) async {
    final ok = await _action.run(
      () => context.read<ApiService>().createDatabaseBackup(source.id),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Backup ${source.databaseName} masuk antrean.');
      await _overview.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Backup gagal dijadwalkan.', error: true);
    }
  }

  Future<void> _restore(BackupRun run) async {
    final confirmed = await confirmAction(
      context,
      title: 'Restore ${run.databaseName}?',
      message:
          'Database akan dikembalikan ke backup ${Fmt.dateTime(run.completedAt ?? run.createdAt)}. '
          'Data setelah titik backup hilang.',
      confirmLabel: 'Restore',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().restoreBackup(run.id),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Restore ${run.databaseName} masuk antrean.');
      await _overview.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Restore gagal dijadwalkan.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<BackupOverview>>.value(
        value: _overview,
        child: Consumer<ItemController<BackupOverview>>(
          builder: (context, controller, _) {
            final overview = controller.value ?? BackupOverview.empty;
            final available = overview.runs.where((run) => run.status == 'available').length;
            final failed = overview.runs.where((run) => run.status == 'failed').length;

            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Infrastructure',
                  title: 'Backups',
                  subtitle: 'Storage target S3, jadwal otomatis, dan riwayat dump database service.',
                  trailing: StatusPill(
                    label: '${overview.runs.length} run',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: StatTile(
                        label: 'Tersedia',
                        value: '$available',
                        detail: 'backup bisa direstore',
                        tone: 'success',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: StatTile(
                        label: 'Gagal',
                        value: '$failed',
                        detail: 'perlu diulang',
                        tone: failed > 0 ? 'danger' : 'neutral',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: StatTile(
                        label: 'Policy',
                        value: '${overview.policies.length}',
                        detail: '${overview.targets.length} target',
                        tone: 'info',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                FilterChipRow(
                  options: const <String>['Ringkasan', 'Policy', 'Storage target'],
                  selected: const <String>['Ringkasan', 'Policy', 'Storage target'][_tab],
                  onChanged: (value) => setState(
                    () => _tab = const <String>['Ringkasan', 'Policy', 'Storage target'].indexOf(value),
                  ),
                ),
                const SizedBox(height: 12),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 4, height: 110)
                else if (controller.error != null &&
                    overview.runs.isEmpty &&
                    overview.targets.isEmpty)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else ...[
                  if (overview.sources.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: AppSurface(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              'On-demand backup',
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: colors.ink,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Buat backup langsung tanpa menunggu jadwal policy.',
                              style: TextStyle(fontSize: 11, color: colors.muted),
                            ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                for (final source in overview.sources)
                                  ActionChip(
                                    label: Text(
                                      source.databaseName,
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                    avatar: const Icon(Icons.archive_outlined, size: 14),
                                    onPressed: _action.isPending
                                        ? null
                                        : () => _runBackup(source),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  if (_tab == 0) _buildRuns(overview),
                  if (_tab == 1) _buildPolicies(overview),
                  if (_tab == 2) _buildTargets(overview),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildRuns(BackupOverview overview) {
    final colors = context.colors;
    if (overview.runs.isEmpty) {
      return const AppCard(
        child: EmptyState(
          title: 'Belum ada backup',
          description: 'Jalankan backup on-demand atau buat policy otomatis.',
          icon: Icons.archive_outlined,
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final run in overview.runs) ...[
          Container(
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
                            run.databaseName,
                            style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              fontFamily: 'monospace',
                              color: colors.ink,
                            ),
                          ),
                          Text(
                            '${run.serviceNumber} · ${run.clusterName} · ${run.nodeName}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 10.5, color: colors.muted),
                          ),
                        ],
                      ),
                    ),
                    StatusPill.status(run.status, dense: true),
                  ],
                ),
                const SizedBox(height: 7),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    StatusPill(
                      label: run.sizeBytes == null ? '—' : Fmt.bytes(run.sizeBytes),
                      tone: 'muted',
                      dense: true,
                    ),
                    StatusPill(
                      label: run.targetName ?? 'local',
                      tone: 'muted',
                      dense: true,
                    ),
                    StatusPill(
                      label: Fmt.relativeTime(run.completedAt ?? run.createdAt),
                      tone: 'muted',
                      dense: true,
                    ),
                    if (run.restoredAt != null)
                      StatusPill(
                        label: 'direstore ${Fmt.relativeTime(run.restoredAt)}',
                        tone: 'info',
                        dense: true,
                      ),
                  ],
                ),
                if (run.lastError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      run.lastError!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 10.5, color: colors.danger),
                    ),
                  ),
                if (run.status == 'available')
                  Align(
                    alignment: Alignment.centerRight,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: TextButton.icon(
                        onPressed: _action.isPending ? null : () => _restore(run),
                        icon: const Icon(Icons.restore, size: 14),
                        label: const Text('Restore', style: TextStyle(fontSize: 12)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }

  Widget _buildPolicies(BackupOverview overview) {
    final colors = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _action.isPending ? null : () => _createPolicy(overview),
            icon: const Icon(Icons.schedule_outlined, size: 16),
            label: const Text('Policy baru'),
          ),
        ),
        const SizedBox(height: 10),
        if (overview.policies.isEmpty)
          const AppCard(
            child: EmptyState(
              title: 'Belum ada policy',
              description: 'Policy menjadwalkan backup otomatis dengan retensi tertentu.',
              icon: Icons.schedule_outlined,
            ),
          )
        else
          for (final policy in overview.policies) ...[
            Container(
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
                    children: [
                      Expanded(
                        child: Text(
                          policy.name,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                      ),
                      StatusPill(
                        label: policy.isActive ? 'Aktif' : 'Nonaktif',
                        tone: policy.isActive ? 'success' : 'muted',
                        dense: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      StatusPill(
                        label: policy.databaseName.isEmpty ? 'database' : policy.databaseName,
                        tone: 'muted',
                        dense: true,
                      ),
                      StatusPill(label: policy.targetName, tone: 'muted', dense: true),
                      StatusPill(
                        label: 'tiap ${_humanInterval(policy.intervalMinutes)}',
                        tone: 'info',
                        dense: true,
                      ),
                      StatusPill(label: 'retensi ${policy.retentionCount}', tone: 'muted', dense: true),
                      if (policy.nextRunAt != null)
                        StatusPill(
                          label: 'berikutnya ${Fmt.dateTime(policy.nextRunAt)}',
                          tone: 'muted',
                          dense: true,
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
      ],
    );
  }

  Widget _buildTargets(BackupOverview overview) {
    final colors = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _action.isPending ? null : _createTarget,
            icon: const Icon(Icons.cloud_outlined, size: 16),
            label: const Text('Storage target baru'),
          ),
        ),
        const SizedBox(height: 10),
        if (overview.targets.isEmpty)
          const AppCard(
            child: EmptyState(
              title: 'Belum ada storage target',
              description: 'Daftarkan bucket S3 compatible untuk menyimpan hasil backup.',
              icon: Icons.cloud_outlined,
            ),
          )
        else
          for (final target in overview.targets) ...[
            Container(
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
                    children: [
                      Expanded(
                        child: Text(
                          target.name,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                      ),
                      StatusPill(
                        label: target.isActive ? 'Aktif' : 'Nonaktif',
                        tone: target.isActive ? 'success' : 'muted',
                        dense: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    '${target.endpoint} · ${target.bucket}/${target.prefix}',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontFamily: 'monospace',
                      color: colors.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      StatusPill(label: target.region, tone: 'muted', dense: true),
                      if (target.pathStyle)
                        const StatusPill(label: 'path style', tone: 'muted', dense: true),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
      ],
    );
  }

  static String _humanInterval(int minutes) {
    if (minutes % 1440 == 0) return '${minutes ~/ 1440} hari';
    if (minutes % 60 == 0) return '${minutes ~/ 60} jam';
    return '$minutes menit';
  }
}
