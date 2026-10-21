import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/operations.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/services/file_saver.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  late final ItemController<ReportSummary> _report;
  DateTime? _from;
  DateTime? _to;
  bool _exporting = false;

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _report = ItemController<ReportSummary>(fetch: () => api.reportSummary());
    _report.load();
  }

  @override
  void dispose() {
    _report.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    final api = context.read<ApiService>();
    _report.fetch = () => api.reportSummary(from: _fromIso, to: _toIso);
    await _report.refresh();
  }

  String? get _fromIso => _from == null ? null : Fmt.isoDate(_from!);

  String? get _toIso => _to == null ? null : Fmt.isoDate(_to!);

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: now.add(const Duration(days: 365)),
      initialDateRange: _from != null && _to != null
          ? DateTimeRange(start: _from!, end: _to!)
          : null,
    );
    if (range == null) return;
    setState(() {
      _from = range.start;
      _to = range.end;
    });
    await _reload();
  }

  Future<void> _clearRange() async {
    setState(() {
      _from = null;
      _to = null;
    });
    await _reload();
  }

  Future<void> _export() async {
    setState(() => _exporting = true);
    try {
      final download = await context.read<ApiService>().reportCsv(from: _fromIso, to: _toIso);
      final saved = await const FileSaver().saveAndOpen(download, 'billing-report.csv');
      if (!mounted) return;
      if (saved.result.message.isNotEmpty) {
        showAppSnack(context, saved.result.message);
      } else {
        showAppSnack(context, 'Laporan disimpan: ${saved.file.path}');
      }
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final rangeLabel = _from == null || _to == null
        ? 'Semua periode'
        : '${Fmt.date(_fromIso)} – ${Fmt.date(_toIso)}';

    return AdminScaffold(
      actions: [
        IconButton(
          tooltip: 'Export CSV',
          onPressed: _exporting ? null : _export,
          icon: _exporting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.download_outlined, size: 20),
        ),
      ],
      child: ChangeNotifierProvider<ItemController<ReportSummary>>.value(
        value: _report,
        child: Consumer<ItemController<ReportSummary>>(
          builder: (context, controller, _) {
            final report = controller.value;

            return RefreshIndicator(
              onRefresh: _reload,
              child: ListView(
                children: [
                  SectionHeader(
                    eyebrow: 'Commercial',
                    title: 'Financial reports',
                    subtitle: 'Invoice, collection, dan outstanding per periode.',
                  ),
                  const SizedBox(height: 14),
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.date_range, size: 16, color: colors.muted),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                rangeLabel,
                                style: TextStyle(fontSize: 12.5, color: colors.ink),
                              ),
                            ),
                            if (_from != null)
                              IconButton(
                                tooltip: 'Reset',
                                visualDensity: VisualDensity.compact,
                                onPressed: _clearRange,
                                icon: const Icon(Icons.close, size: 16),
                              ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: _pickRange,
                                icon: const Icon(Icons.calendar_month_outlined, size: 16),
                                label: const Text('Pilih rentang'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: _exporting ? null : _export,
                                icon: const Icon(Icons.download_outlined, size: 16),
                                label: Text(_exporting ? 'Menyiapkan…' : 'Export CSV'),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (controller.isLoading && report == null)
                    const LoadingList(count: 3, height: 90)
                  else if (report == null)
                    ErrorState(
                      message: controller.error ?? 'Laporan tidak dapat dimuat.',
                      onRetry: _reload,
                    )
                  else ...[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: _amountCard(
                            context,
                            label: 'Invoiced',
                            entries: report.invoiced
                                .map(
                                  (entry) => (
                                    currency: entry.currency,
                                    amount: entry.amount,
                                  ),
                                )
                                .toList(),
                            detail:
                                '${report.invoiced.fold<int>(0, (sum, entry) => sum + entry.count)} invoice',
                            tone: colors.ink,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _amountCard(
                            context,
                            label: 'Collected',
                            entries: report.collected
                                .map(
                                  (entry) => (
                                    currency: entry.currency,
                                    amount: entry.amount,
                                  ),
                                )
                                .toList(),
                            detail: 'Pembayaran bersih',
                            tone: colors.brand,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    _amountCard(
                      context,
                      label: 'Outstanding',
                      entries: report.outstanding
                          .map(
                            (entry) => (currency: entry.currency, amount: entry.amount),
                          )
                          .toList(),
                      detail: 'Sisa tagihan berjalan',
                      tone: colors.warning,
                    ),
                    const SizedBox(height: 14),
                    AppCard(
                      title: 'Monthly breakdown',
                      subtitle: 'Invoiced vs collected per bulan',
                      padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
                      child: report.monthly.isEmpty
                          ? const EmptyState(
                              title: 'Belum ada data',
                              description: 'Tidak ada transaksi pada rentang yang dipilih.',
                              icon: Icons.show_chart,
                            )
                          : Column(
                              children: [
                                for (final row in report.monthly)
                                  Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 6),
                                    child: Row(
                                      children: [
                                        SizedBox(
                                          width: 62,
                                          child: Text(
                                            row.month,
                                            style: TextStyle(
                                              fontSize: 11,
                                              fontFamily: 'monospace',
                                              color: colors.ink,
                                            ),
                                          ),
                                        ),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.end,
                                            children: [
                                              Text(
                                                Fmt.money(row.invoiced, row.currency),
                                                style: TextStyle(
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w600,
                                                  color: colors.ink,
                                                  fontFeatures: const [
                                                    FontFeature.tabularFigures(),
                                                  ],
                                                ),
                                              ),
                                              Text(
                                                Fmt.money(row.collected, row.currency),
                                                style: TextStyle(
                                                  fontSize: 10.5,
                                                  color: colors.brand,
                                                  fontFeatures: const [
                                                    FontFeature.tabularFigures(),
                                                  ],
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                    ),
                  ],
                  if (controller.error != null && report != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
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

  Widget _amountCard(
    BuildContext context, {
    required String label,
    required List<({String currency, String amount})> entries,
    required String detail,
    required Color tone,
  }) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(
              fontSize: 9.5,
              letterSpacing: 0.8,
              fontWeight: FontWeight.w700,
              color: colors.muted,
            ),
          ),
          const SizedBox(height: 6),
          if (entries.isEmpty)
            Text('—', style: TextStyle(fontSize: 18, color: colors.muted))
          else
            for (final entry in entries)
              Text(
                Fmt.money(entry.amount, entry.currency),
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.3,
                  color: tone,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
          const SizedBox(height: 3),
          Text(detail, style: TextStyle(fontSize: 10.5, color: colors.muted)),
        ],
      ),
    );
  }
}
