import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/operations.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

/// Audit trail plus background job runs.
///
/// The API returns today's job runs alongside the first page of audit entries,
/// so the controller keeps them while paging only advances the entries.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  late final ListController<ActivityEntry> _entries;
  List<JobRun> _jobs = const <JobRun>[];

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _entries = ListController<ActivityEntry>(
      fetch: (page, perPage) async {
        final result = await api.activity(page: page, perPage: perPage);
        if (page == 1) _jobs = result.jobs;
        return (rows: result.rows, meta: result.meta);
      },
    );
    _entries.load();
  }

  @override
  void dispose() {
    _entries.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ListController<ActivityEntry>>.value(
        value: _entries,
        child: Consumer<ListController<ActivityEntry>>(
          builder: (context, controller, _) {
            final rows = controller.rows;
            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Operations',
                  title: 'Activity log',
                  subtitle:
                      'Jejak audit perubahan komersial, infrastruktur, dan aksi sensitif keamanan.',
                  trailing: StatusPill(
                    label: '${controller.meta.total} entri',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 14),
                if (_jobs.isNotEmpty) ...[
                  AppCard(
                    title: 'Background jobs',
                    subtitle: 'Eksekusi scheduler terakhir',
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final job in _jobs)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 5),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        job.jobName,
                                        style: TextStyle(
                                          fontSize: 11.5,
                                          fontWeight: FontWeight.w600,
                                          color: colors.ink,
                                        ),
                                      ),
                                      Text(
                                        '${Fmt.relativeTime(job.startedAt)} · '
                                        '${job.processedCount} diproses',
                                        style: TextStyle(fontSize: 10, color: colors.muted),
                                      ),
                                    ],
                                  ),
                                ),
                                StatusPill.status(job.status, dense: true),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (controller.error != null && rows.isEmpty)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 6, height: 62)
                else if (rows.isEmpty)
                  const AppCard(
                    child: EmptyState(
                      title: 'Belum ada aktivitas',
                      description:
                          'Audit trail masih kosong. Perubahan data akan tercatat otomatis di sini.',
                      icon: Icons.timeline_outlined,
                    ),
                  )
                else
                  Container(
                    decoration: BoxDecoration(
                      color: colors.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: colors.line),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        for (var index = 0; index < rows.length; index++) ...[
                          _ActivityRow(entry: rows[index]),
                          if (index != rows.length - 1) Divider(height: 1, color: colors.line),
                        ],
                        if (controller.hasMore)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            child: TextButton(
                              onPressed: controller.isLoading ? null : controller.loadMore,
                              child: Text(
                                controller.isLoading ? 'Memuat…' : 'Muat lebih banyak',
                                style: const TextStyle(fontSize: 12),
                              ),
                            ),
                          ),
                      ],
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

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({required this.entry});

  final ActivityEntry entry;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  entry.action,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    fontFamily: 'monospace',
                    color: colors.ink,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                Fmt.relativeTime(entry.createdAt),
                style: TextStyle(fontSize: 10, color: colors.muted),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            '${Fmt.label(entry.entityType)}'
            '${entry.entityId != null ? ' · ${_short(entry.entityId!)}' : ''}',
            style: TextStyle(fontSize: 10.5, color: colors.muted),
          ),
          Text(
            'oleh ${entry.actorName ?? entry.actorEmail ?? 'sistem'}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 10.5, color: colors.muted),
          ),
        ],
      ),
    );
  }

  static String _short(String id) => id.length <= 8 ? id : id.substring(0, 8);
}
