import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/operations.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  late final ItemController<DashboardOverview> _overview;
  late final ItemController<ReportSummary> _report;

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _overview = ItemController<DashboardOverview>(fetch: api.dashboard);
    _report = ItemController<ReportSummary>(fetch: api.reportSummary);
    _overview.load();
    _report.load();
  }

  @override
  void dispose() {
    _overview.dispose();
    _report.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    await Future.wait([_overview.refresh(), _report.refresh()]);
  }

  @override
  Widget build(BuildContext context) {
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<DashboardOverview>>.value(
        value: _overview,
        child: Consumer<ItemController<DashboardOverview>>(
          builder: (context, controller, _) => RefreshIndicator(
            onRefresh: _refresh,
            child: _body(context, controller),
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, ItemController<DashboardOverview> controller) {
    final colors = context.colors;
    final value = controller.value;
    final settings = context.watch<SettingsController>();

    if (controller.isLoading && value == null) {
      return const LoadingList(count: 6, height: 96);
    }
    if (value == null && controller.error != null) {
      return ListView(
        children: [
          ErrorState(message: controller.error!, onRetry: controller.refresh),
        ],
      );
    }

    final overview = value;

    return ListView(
      children: [
        SectionHeader(
          eyebrow: 'Control plane',
          title: 'Infrastructure Overview',
          subtitle: 'Commercial health and OC Agent infrastructure state.',
          trailing: IconButton(
            tooltip: 'Muat ulang',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh, size: 20),
          ),
        ),
        const SizedBox(height: 16),
        if (overview == null)
          const LoadingList(count: 3, height: 96)
        else ...[
          GridView.count(
            crossAxisCount: MediaQuery.sizeOf(context).width >= 720 ? 4 : 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 1.55,
            children: [
              StatTile(
                label: 'Monthly recurring',
                value: settings.money(overview.monthlyRecurring, overview.currency),
                detail: 'Active recurring services',
                tone: 'success',
                icon: Icons.trending_up,
              ),
              StatTile(
                label: 'Active customers',
                value: Fmt.count(overview.customerActive),
                detail: '${Fmt.count(overview.customerTotal)} total customers',
                icon: Icons.people_outline,
              ),
              StatTile(
                label: 'Unpaid balance',
                value: settings.money(overview.unpaidBalance, overview.currency),
                detail: '${Fmt.count(overview.invoiceOpen)} open invoices',
                tone: 'warning',
                icon: Icons.schedule,
              ),
              StatTile(
                label: 'Applications',
                value: Fmt.count(overview.resourceTotal),
                detail: '${Fmt.count(overview.resourceRunning)} running',
                icon: Icons.apps_outlined,
              ),
            ],
          ),
          const SizedBox(height: 14),
          _revenueCard(context, settings, overview),
          const SizedBox(height: 14),
          _resourceCard(context, overview),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: AppCard(
                  title: 'Server capacity',
                  subtitle: 'Alokasi limit dari resource terkelola',
                  trailing: StatusPill(
                    label: overview.capacityResourceCount == 0 ? 'Kosong' : 'Terisi',
                    tone: overview.capacityResourceCount == 0 ? 'muted' : 'info',
                    dense: true,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _capacityBar(
                        context,
                        label: 'Allocated CPU',
                        value: Fmt.cpu(overview.capacityCpuCores),
                      ),
                      const SizedBox(height: 10),
                      _capacityBar(
                        context,
                        label: 'Allocated memory',
                        value: Fmt.bytes(overview.capacityMemoryBytes),
                      ),
                      const SizedBox(height: 10),
                      _capacityBar(
                        context,
                        label: 'Resources',
                        value: Fmt.count(overview.capacityResourceCount),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          AppCard(
            title: 'Attention',
            subtitle: 'Hal yang perlu tindakan',
            trailing: StatusPill(
              label: overview.invoiceOverdue > 0 || overview.resourceNotBilled > 0
                  ? 'Perlu tindakan'
                  : 'Clear',
              tone: overview.invoiceOverdue > 0 || overview.resourceNotBilled > 0
                  ? 'warning'
                  : 'success',
              dense: true,
            ),
            child: Column(
              children: [
                _attentionRow(
                  context,
                  label: 'Overdue invoices',
                  value: overview.invoiceOverdue,
                  onTap: () => context.go('/invoices'),
                ),
                _attentionRow(
                  context,
                  label: 'Not billed resources',
                  value: overview.resourceNotBilled,
                  onTap: () => context.go('/resources'),
                ),
                _attentionRow(
                  context,
                  label: 'Billable resources',
                  value: overview.resourceBillable,
                  onTap: () => context.go('/resources'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'Terakhir sinkron: ${Fmt.dateTime(overview.lastSyncedAt)}',
            style: TextStyle(fontSize: 10.5, color: colors.muted, letterSpacing: 0.4),
          ),
          const SizedBox(height: 4),
          Text(
            '${settings.value.companyName}${settings.value.email != null ? ' · ${settings.value.email}' : ''}',
            style: TextStyle(fontSize: 10.5, color: colors.muted, letterSpacing: 0.4),
          ),
        ],
      ],
    );
  }

  Widget _revenueCard(BuildContext context, SettingsController settings, DashboardOverview overview) {
    return ChangeNotifierProvider<ItemController<ReportSummary>>.value(
      value: _report,
      child: Consumer<ItemController<ReportSummary>>(
        builder: (context, controller, _) {
          final report = controller.value;
          final monthly = report?.monthly ?? const <MonthlyReportRow>[];

          return AppCard(
            title: 'Arus kas 6 bulan',
            subtitle: 'Invoice terbit vs pembayaran diterima',
            trailing: TextButton(
              onPressed: () => context.go('/reports'),
              child: const Text('Laporan'),
            ),
            child: SizedBox(
              height: 190,
              child: monthly.isEmpty
                  ? EmptyState(
                      title: 'Belum ada data laporan',
                      description: controller.isLoading
                          ? 'Memuat laporan…'
                          : 'Laporan muncul setelah ada invoice terbit.',
                      icon: Icons.show_chart,
                    )
                  : _MonthlyChart(rows: monthly, currency: overview.currency),
            ),
          );
        },
      ),
    );
  }

  Widget _resourceCard(BuildContext context, DashboardOverview overview) {
    final colors = context.colors;
    return AppCard(
      title: 'Infrastructure resources',
      subtitle: 'Last observed agent state',
      trailing: StatusPill(
        label: overview.lastSyncedAt != null ? 'Synced' : 'Not synced',
        tone: overview.lastSyncedAt != null ? 'success' : 'muted',
        dense: true,
      ),
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
      child: Column(
        children: [
          Row(
            children: [
              _miniStat(context, 'Total', Fmt.count(overview.resourceTotal)),
              _miniStat(context, 'Running', Fmt.count(overview.resourceRunning)),
              _miniStat(context, 'Billable', Fmt.count(overview.resourceBillable)),
              _miniStat(
                context,
                'Not billed',
                Fmt.count(overview.resourceNotBilled),
                tone: overview.resourceNotBilled > 0 ? colors.warning : null,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => context.go('/resources'),
              icon: const Icon(Icons.arrow_forward, size: 14),
              label: const Text('Lihat resource inventory'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _miniStat(BuildContext context, String label, String value, {Color? tone}) {
    final colors = context.colors;
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label.toUpperCase(),
            style: TextStyle(fontSize: 9, letterSpacing: 0.6, color: colors.muted),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: tone ?? colors.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  Widget _capacityBar(BuildContext context, {required String label, required String value}) {
    final colors = context.colors;
    return Row(
      children: [
        Expanded(child: Text(label, style: TextStyle(fontSize: 12, color: colors.muted))),
        Text(
          value,
          style: TextStyle(
            fontSize: 12,
            fontFamily: 'monospace',
            color: colors.ink,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }

  Widget _attentionRow(
    BuildContext context, {
    required String label,
    required int value,
    required VoidCallback onTap,
  }) {
    final colors = context.colors;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Expanded(child: Text(label, style: TextStyle(fontSize: 12.5, color: colors.ink))),
            Text(
              Fmt.count(value),
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: value > 0 ? colors.warning : colors.muted,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 6),
            Icon(Icons.chevron_right, size: 16, color: colors.muted),
          ],
        ),
      ),
    );
  }
}

class _MonthlyChart extends StatelessWidget {
  const _MonthlyChart({required this.rows, required this.currency});

  final List<MonthlyReportRow> rows;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    // Keep the most recent six periods so the chart stays legible on a phone.
    final visible = rows.length > 6 ? rows.sublist(rows.length - 6) : rows;
    final invoiced = <double>[];
    final collected = <double>[];
    var maxValue = 0.0;

    for (final row in visible) {
      final a = double.tryParse(row.invoiced) ?? 0;
      final b = double.tryParse(row.collected) ?? 0;
      invoiced.add(a);
      collected.add(b);
      if (a > maxValue) maxValue = a;
      if (b > maxValue) maxValue = b;
    }

    if (maxValue <= 0) maxValue = 1;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            _legend(context, colors.brand, 'Invoiced'),
            const SizedBox(width: 14),
            _legend(context, colors.info, 'Collected'),
          ],
        ),
        const SizedBox(height: 12),
        Expanded(
          child: BarChart(
            BarChartData(
              alignment: BarChartAlignment.spaceAround,
              maxY: maxValue * 1.2,
              gridData: FlGridData(
                show: true,
                drawVerticalLine: false,
                horizontalInterval: maxValue / 2,
                getDrawingHorizontalLine: (_) => FlLine(color: colors.line, strokeWidth: 1),
              ),
              borderData: FlBorderData(show: false),
              titlesData: FlTitlesData(
                topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 46,
                    getTitlesWidget: (value, meta) => Text(
                      Fmt.compactMoney(value, currency),
                      style: TextStyle(fontSize: 9, color: colors.muted),
                    ),
                  ),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(
                    showTitles: true,
                    reservedSize: 24,
                    getTitlesWidget: (value, meta) {
                      final index = value.toInt();
                      if (index < 0 || index >= visible.length) return const SizedBox.shrink();
                      final month = visible[index].month;
                      final label = month.length >= 7 ? month.substring(2, 7) : month;
                      return Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          label,
                          style: TextStyle(fontSize: 9, color: colors.muted),
                        ),
                      );
                    },
                  ),
                ),
              ),
              barTouchData: BarTouchData(
                touchTooltipData: BarTouchTooltipData(
                  getTooltipColor: (_) => colors.surfaceRaised,
                  getTooltipItem: (group, groupIndex, rod, rodIndex) {
                    final row = visible[group.x];
                    return BarTooltipItem(
                      '${row.month}\n${rodIndex == 0 ? 'Invoiced' : 'Collected'}\n'
                      '${Fmt.money(rod.toY, currency)}',
                      TextStyle(
                        fontSize: 10,
                        color: colors.ink,
                        fontWeight: FontWeight.w500,
                      ),
                    );
                  },
                ),
              ),
              barGroups: [
                for (var index = 0; index < visible.length; index++)
                  BarChartGroupData(
                    x: index,
                    barsSpace: 3,
                    barRods: [
                      BarChartRodData(
                        toY: invoiced[index],
                        color: colors.brand,
                        width: 9,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                      ),
                      BarChartRodData(
                        toY: collected[index],
                        color: colors.info,
                        width: 9,
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(3)),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _legend(BuildContext context, Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
        ),
        const SizedBox(width: 5),
        Text(label, style: TextStyle(fontSize: 10, color: context.colors.muted)),
      ],
    );
  }
}
