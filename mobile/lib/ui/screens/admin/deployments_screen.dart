import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/infrastructure.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

const Map<String, String> _actionLabels = <String, String>{
  'agent.upgrade': 'Upgrade OC Agent',
  'agent.rollback': 'Rollback OC Agent',
  'gateway.ensure': 'Bootstrap Traefik gateway',
  'application.ensure': 'Deploy application',
  'application.build': 'Build application image',
  'image.delete': 'Hapus Docker image',
  'application.deploy': 'Deploy application',
  'application.start': 'Start application',
  'application.stop': 'Stop application',
  'application.restart': 'Restart application',
  'application.redeploy': 'Redeploy application',
  'application.delete': 'Hapus application',
  'application.set-limits': 'Ubah resource limits',
  'container.exec': 'Docker sh command',
  'database.cluster.activate': 'Aktivasi database cluster',
  'database.service.ensure': 'Provision service database',
  'route.configure': 'Konfigurasi route',
  'route.delete': 'Hapus route',
};

/// Queue and history of commands dispatched to OC Agents.
class DeploymentsScreen extends StatefulWidget {
  const DeploymentsScreen({super.key});

  @override
  State<DeploymentsScreen> createState() => _DeploymentsScreenState();
}

class _DeploymentsScreenState extends State<DeploymentsScreen> {
  late final ItemController<List<InfraOperation>> _operations;
  Timer? _timer;
  String _filter = '';

  @override
  void initState() {
    super.initState();
    _operations = ItemController<List<InfraOperation>>(
      fetch: () => context.read<ApiService>().operations(),
    );
    _operations.load();
    // Operations move on their own, so poll while any is still in flight.
    _timer = Timer.periodic(const Duration(seconds: 6), (_) {
      final rows = _operations.value ?? const <InfraOperation>[];
      if (mounted && rows.any((operation) => operation.isPending)) {
        _operations.load(refresh: true);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _operations.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<List<InfraOperation>>>.value(
        value: _operations,
        child: Consumer<ItemController<List<InfraOperation>>>(
          builder: (context, controller, _) {
            final all = controller.value ?? const <InfraOperation>[];
            final filtered = _filter.isEmpty
                ? all
                : all.where((operation) => operation.status == _filter).toList(growable: false);
            final pending = all.where((operation) => operation.isPending).length;
            final succeeded = all.where((operation) => operation.status == 'succeeded').length;
            final failed = all.where((operation) => operation.status == 'failed').length;

            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Infrastructure',
                  title: 'Deployments',
                  subtitle:
                      'Antrean dan riwayat perintah OC Agent pada setiap server. Polling otomatis '
                      'aktif selama ada operasi berjalan.',
                  trailing: StatusPill(
                    label: '$pending antre',
                    tone: pending > 0 ? 'warning' : 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: StatTile(
                        label: 'Dalam antrean',
                        value: '$pending',
                        detail: 'Queued / running',
                        tone: pending > 0 ? 'warning' : 'neutral',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: StatTile(
                        label: 'Berhasil',
                        value: '$succeeded',
                        detail: '100 operasi terakhir',
                        tone: 'success',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: StatTile(
                        label: 'Gagal',
                        value: '$failed',
                        detail: 'Perlu diperiksa',
                        tone: failed > 0 ? 'danger' : 'neutral',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                FilterChipRow(
                  options: const <String>[
                    '',
                    'queued',
                    'dispatched',
                    'running',
                    'succeeded',
                    'failed',
                    'cancelled',
                    'expired',
                  ],
                  selected: _filter,
                  labelBuilder: (value) =>
                      value.isEmpty ? 'Semua' : StatusPill.statusLabel(value),
                  onChanged: (value) => setState(() => _filter = value),
                ),
                const SizedBox(height: 12),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 5, height: 78)
                else if (controller.error != null && all.isEmpty)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else if (filtered.isEmpty)
                  AppCard(
                    child: EmptyState(
                      title: all.isEmpty ? 'Belum ada deployment' : 'Tidak ada operasi',
                      description: all.isEmpty
                          ? 'Deploy template atau jalankan aksi pada resource untuk membuat operasi pertama.'
                          : 'Tidak ada operasi dengan status tersebut.',
                      icon: Icons.rocket_launch_outlined,
                    ),
                  )
                else
                  for (final operation in filtered) ...[
                    _OperationRow(operation: operation),
                    const SizedBox(height: 8),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _OperationRow extends StatelessWidget {
  const _OperationRow({required this.operation});

  final InfraOperation operation;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final label = _actionLabels[operation.action] ?? operation.action;

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
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: operation.isPending
                    ? SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2, color: colors.brand),
                      )
                    : Icon(Icons.rocket_launch_outlined, size: 15, color: colors.muted),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: colors.ink,
                      ),
                    ),
                    Text(
                      operation.resourceName ?? 'Control-plane operation',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11, color: colors.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              StatusPill.status(operation.status, dense: true),
            ],
          ),
          const SizedBox(height: 7),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              StatusPill(
                label: '${operation.nodeName} · ${operation.nodeEnvironment}',
                tone: 'muted',
                dense: true,
              ),
              StatusPill(
                label: '${operation.attemptCount}/${operation.maxAttempts} attempt',
                tone: 'muted',
                dense: true,
              ),
              StatusPill(
                label: Fmt.relativeTime(operation.createdAt),
                tone: 'muted',
                dense: true,
              ),
              if (operation.completedAt != null)
                StatusPill(
                  label: 'selesai ${Fmt.relativeTime(operation.completedAt)}',
                  tone: 'muted',
                  dense: true,
                ),
            ],
          ),
          if (operation.errorMessage != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                operation.errorMessage!,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, height: 1.4, color: colors.danger),
              ),
            ),
          if (operation.correlationId != null)
            Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text(
                operation.correlationId!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9.5,
                  fontFamily: 'monospace',
                  color: colors.muted,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
