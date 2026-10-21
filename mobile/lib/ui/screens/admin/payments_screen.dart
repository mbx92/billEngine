import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/payment_dialog.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  late final ListController<PaymentListEntry> _list;
  final _action = ActionController();
  String _status = '';

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _list = ListController<PaymentListEntry>(
      fetch: (page, perPage) async {
        final result = await api.payments(
          page: page,
          perPage: perPage,
          status: _status.isEmpty ? null : _status,
        );
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

  Future<void> _record() async {
    final recorded = await showPaymentDialog(context);
    if (!recorded || !mounted) return;
    showAppSnack(context, 'Pembayaran dicatat.');
    await _list.refresh();
  }

  Future<void> _changeFilter(String status) async {
    setState(() => _status = status);
    await _list.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      floatingAction: FloatingActionButton.extended(
        onPressed: _action.isPending ? null : _record,
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Pembayaran'),
      ),
      child: ChangeNotifierProvider<ListController<PaymentListEntry>>.value(
        value: _list,
        child: Consumer<ListController<PaymentListEntry>>(
          builder: (context, controller, _) {
            final total = controller.rows.fold<double>(
              0,
              (sum, row) => row.status == 'completed'
                  ? sum + (double.tryParse(row.amount) ?? 0)
                  : sum,
            );

            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionHeader(
                  eyebrow: 'Commercial',
                  title: 'Payments',
                  subtitle: 'Riwayat pembayaran yang tercatat beserta referensi transfer.',
                  trailing: StatusPill(
                    label: '${controller.meta.total} total',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 12),
                StatTile(
                  label: 'Nilai halaman ini',
                  value: Fmt.money(total),
                  detail: '${controller.rows.length} pembayaran ditampilkan',
                  tone: 'success',
                  icon: Icons.payments_outlined,
                ),
                const SizedBox(height: 10),
                FilterChipRow(
                  options: const <String>['', 'completed', 'pending', 'failed', 'refunded'],
                  selected: _status,
                  labelBuilder: (value) =>
                      value.isEmpty ? 'Semua' : StatusPill.statusLabel(value),
                  onChanged: _changeFilter,
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: controller.refresh,
                    child: controller.isLoading && !controller.isLoaded
                        ? ListView(children: [LoadingList(count: 5, height: 80)])
                        : controller.error != null && controller.rows.isEmpty
                        ? ListView(
                            children: [
                              ErrorState(message: controller.error!, onRetry: controller.refresh),
                            ],
                          )
                        : controller.rows.isEmpty
                        ? ListView(
                            children: [
                              EmptyState(
                                title: 'Belum ada pembayaran',
                                description: 'Catat pembayaran pertama untuk invoice yang belum lunas.',
                                icon: Icons.payments_outlined,
                                action: FilledButton(
                                  onPressed: _record,
                                  child: const Text('Catat pembayaran'),
                                ),
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
                              final payment = controller.rows[index];
                              return AppSurface(
                                onTap: () => context.go('/invoices/${payment.invoiceId}'),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            payment.paymentNumber,
                                            style: TextStyle(
                                              fontSize: 12.5,
                                              fontWeight: FontWeight.w700,
                                              fontFamily: 'monospace',
                                              color: colors.brand,
                                            ),
                                          ),
                                        ),
                                        StatusPill.status(payment.status, dense: true),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      payment.customerCompanyName ?? payment.customerName,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(fontSize: 12.5, color: colors.ink),
                                    ),
                                    const SizedBox(height: 6),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${payment.invoiceNumber} · ${payment.method}\n'
                                            '${Fmt.dateTime(payment.paidAt)}',
                                            style: TextStyle(
                                              fontSize: 10.5,
                                              height: 1.5,
                                              fontFamily: 'monospace',
                                              color: colors.muted,
                                            ),
                                          ),
                                        ),
                                        MoneyText(
                                          payment.amount,
                                          currency: payment.currency,
                                          bold: true,
                                          size: 14,
                                        ),
                                      ],
                                    ),
                                    if (payment.reference != null)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 4),
                                        child: Text(
                                          'Ref: ${payment.reference}',
                                          style: TextStyle(fontSize: 10.5, color: colors.muted),
                                        ),
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
