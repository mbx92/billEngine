import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/manual_invoice_dialog.dart';

class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({super.key});

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class InvoiceListController extends ListController<InvoiceSummary> {
  InvoiceListController({required super.fetch, required this.queryBuilder});

  final ({String? status, String? text}) Function() queryBuilder;

  InvoiceStatusCounts _latestSummary = InvoiceStatusCounts.empty;

  InvoiceStatusCounts get summary => _latestSummary;

  /// Stores the status counters returned alongside the invoice page. Called by
  /// the fetch callback so the tiles above the list stay in sync.
  void setSummary(InvoiceStatusCounts value) {
    _latestSummary = value;
  }

  /// Refetch while keeping the active filters.
  Future<void> reload() async {
    await refresh();
    notifyListeners();
  }
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  late final InvoiceListController _list;
  final _action = ActionController();
  String _status = '';
  String _query = '';
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _list = InvoiceListController(
      queryBuilder: () => (
        status: _status.isEmpty ? null : _status,
        text: _query.isEmpty ? null : _query,
      ),
      fetch: (page, perPage) async {
        final result = await api.invoices(
          page: page,
          perPage: perPage,
          status: _status.isEmpty ? null : _status,
          query: _query.isEmpty ? null : _query,
        );
        _list.setSummary(result.summary);
        return (rows: result.rows, meta: result.meta);
      },
    );
    _list.load();
  }

  @override
  void dispose() {
    _list.dispose();
    _action.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _applyFilter(String status) async {
    setState(() => _status = status);
    await _list.reload();
  }

  Future<void> _search(String text) async {
    setState(() => _query = text.trim());
    await _list.reload();
  }

  Future<void> _create() async {
    final created = await showManualInvoiceDialog(context);
    if (!created || !mounted) return;
    showAppSnack(context, 'Invoice berhasil dibuat.');
    await _list.reload();
  }

  Future<void> _generateRecurring() async {
    final settings = context.read<SettingsController>();
    if (!settings.value.billingAutomationEnabled) {
      showAppSnack(
        context,
        'Aktifkan billing automation melalui Settings sebelum generate.',
        error: true,
      );
      return;
    }
    final ok = await _action.run(() async {
      await context.read<ApiService>().generateRecurringInvoices();
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Recurring billing dijalankan.');
      await _list.reload();
    } else {
      showAppSnack(context, _action.error ?? 'Gagal menjalankan billing engine.', error: true);
    }
  }

  Future<void> _markOverdue() async {
    final ok = await _action.run(() async {
      await context.read<ApiService>().markOverdue();
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Status overdue diperbarui.');
      await _list.reload();
    } else {
      showAppSnack(context, _action.error ?? 'Gagal memperbarui status overdue.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return AdminScaffold(
      actions: [
        PopupMenuButton<String>(
          icon: const Icon(Icons.more_vert, size: 20),
          enabled: !_action.isPending,
          onSelected: (value) {
            if (value == 'generate') _generateRecurring();
            if (value == 'overdue') _markOverdue();
          },
          itemBuilder: (context) => const [
            PopupMenuItem(value: 'generate', child: Text('Generate recurring')),
            PopupMenuItem(value: 'overdue', child: Text('Mark overdue')),
          ],
        ),
      ],
      floatingAction: FloatingActionButton.extended(
        onPressed: _action.isPending ? null : _create,
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Invoice'),
      ),
      child: ChangeNotifierProvider<InvoiceListController>.value(
        value: _list,
        child: Consumer<InvoiceListController>(
          builder: (context, controller, _) {
            final summary = controller.summary;
            final openCount = summary.countFor('unpaid') + summary.countFor('overdue');
            final balance = summary.balances.isEmpty
                ? '—'
                : Fmt.money(summary.balances.first.balance, summary.balances.first.currency);

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionHeader(
                  eyebrow: 'Commercial',
                  title: 'Invoices',
                  subtitle:
                      'Snapshot customer dan seller yang immutable, lengkap dengan status pembayaran.',
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: StatTile(
                        label: 'Open invoices',
                        value: Fmt.count(openCount),
                        detail: '${Fmt.count(summary.countFor('overdue'))} overdue',
                        tone: summary.countFor('overdue') > 0 ? 'warning' : 'neutral',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: StatTile(
                        label: 'Unpaid balance',
                        value: balance,
                        detail: 'Issued, belum lunas',
                        tone: 'warning',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _searchController,
                  textInputAction: TextInputAction.search,
                  onSubmitted: _search,
                  decoration: InputDecoration(
                    hintText: 'Cari nomor invoice atau customer…',
                    prefixIcon: const Icon(Icons.search, size: 18),
                    suffixIcon: _query.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 16),
                            onPressed: () {
                              _searchController.clear();
                              _search('');
                            },
                          ),
                  ),
                ),
                const SizedBox(height: 10),
                FilterChipRow(
                  options: const <String>['', 'draft', 'unpaid', 'overdue', 'paid', 'cancelled'],
                  selected: _status,
                  labelBuilder: (value) {
                    if (value.isEmpty) {
                      return 'Semua ${Fmt.count(summary.total)}';
                    }
                    return '${StatusPill.statusLabel(value)} ${summary.countFor(value)}';
                  },
                  onChanged: _applyFilter,
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: controller.reload,
                    child: controller.isLoading && !controller.isLoaded
                        ? ListView(children: [LoadingList(count: 5, height: 72)])
                        : controller.error != null && controller.rows.isEmpty
                        ? ListView(
                            children: [
                              ErrorState(message: controller.error!, onRetry: controller.reload),
                            ],
                          )
                        : controller.rows.isEmpty
                        ? ListView(
                            children: [
                              EmptyState(
                                title: _status.isNotEmpty || _query.isNotEmpty
                                    ? 'Invoice tidak ditemukan'
                                    : 'Belum ada invoice',
                                description: _status.isNotEmpty || _query.isNotEmpty
                                    ? 'Tidak ada invoice yang cocok dengan filter saat ini.'
                                    : 'Buat manual invoice, atau aktifkan billing automation untuk invoice recurring.',
                                icon: Icons.description_outlined,
                                action: _status.isEmpty && _query.isEmpty
                                    ? FilledButton(
                                        onPressed: _create,
                                        child: const Text('Buat manual invoice'),
                                      )
                                    : null,
                              ),
                            ],
                          )
                        : ListView.separated(
                            itemCount: controller.rows.length + (controller.hasMore ? 1 : 0),
                            separatorBuilder: (_, _) => const SizedBox(height: 8),
                            itemBuilder: (context, index) {
                              if (index >= controller.rows.length) {
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
                              final invoice = controller.rows[index];
                              return AppSurface(
                                onTap: () => context.go('/invoices/${invoice.id}'),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            invoice.invoiceNumber,
                                            style: TextStyle(
                                              fontSize: 12.5,
                                              fontWeight: FontWeight.w700,
                                              fontFamily: 'monospace',
                                              color: colors.brand,
                                            ),
                                          ),
                                        ),
                                        StatusPill.status(invoice.status, dense: true),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      invoice.customerDisplayName,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(fontSize: 12.5, color: colors.ink),
                                    ),
                                    const SizedBox(height: 6),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            'Terbit ${Fmt.date(invoice.issueDate)}\n'
                                            'Jatuh tempo ${Fmt.date(invoice.dueDate)}'
                                            '${invoice.daysPastDue > 0 ? ' · +${invoice.daysPastDue}h' : ''}',
                                            style: TextStyle(
                                              fontSize: 10.5,
                                              height: 1.5,
                                              fontFamily: 'monospace',
                                              color: invoice.daysPastDue > 0
                                                  ? colors.warning
                                                  : colors.muted,
                                            ),
                                          ),
                                        ),
                                        Column(
                                          crossAxisAlignment: CrossAxisAlignment.end,
                                          children: [
                                            MoneyText(
                                              invoice.balanceDue,
                                              currency: invoice.currency,
                                              bold: true,
                                              size: 13.5,
                                              color: invoice.balanceDue == '0'
                                                  ? colors.muted
                                                  : colors.ink,
                                            ),
                                            Text(
                                              'dari ${Fmt.money(invoice.totalAmount, invoice.currency)}',
                                              style: TextStyle(fontSize: 10, color: colors.muted),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
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
