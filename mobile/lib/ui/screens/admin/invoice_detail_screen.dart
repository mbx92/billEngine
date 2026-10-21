import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/invoice_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';
import 'package:billengine_mobile/ui/widgets/invoice_body.dart';
import 'package:billengine_mobile/ui/widgets/manual_invoice_dialog.dart';
import 'package:billengine_mobile/ui/widgets/payment_dialog.dart';

class AdminInvoiceDetailScreen extends StatefulWidget {
  const AdminInvoiceDetailScreen({super.key, required this.invoiceId});

  final String invoiceId;

  @override
  State<AdminInvoiceDetailScreen> createState() => _AdminInvoiceDetailScreenState();
}

class _AdminInvoiceDetailScreenState extends State<AdminInvoiceDetailScreen> {
  late final InvoiceDetailController _controller;
  final _action = ActionController();
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    _controller = InvoiceDetailController(
      api: context.read<ApiService>(),
      invoiceId: widget.invoiceId,
    );
    _controller.load();
  }

  @override
  void dispose() {
    _controller.dispose();
    _action.dispose();
    super.dispose();
  }

  InvoiceDetail? get _detail => _controller.value;

  bool get _canEdit =>
      _cancelable &&
      _detail != null &&
      _detail!.payments.isEmpty &&
      _detail!.creditNotes.isEmpty;

  bool get _cancelable {
    final invoice = _detail?.invoice;
    if (invoice == null) return false;
    return <String>['draft', 'unpaid', 'overdue'].contains(invoice.status) &&
        invoice.amountPaid == '0';
  }

  bool get _canRecordPayment {
    final status = _detail?.invoice.status;
    return status == 'unpaid' || status == 'overdue';
  }

  bool get _canIssueCredit {
    final invoice = _detail?.invoice;
    return invoice != null &&
        _canRecordPayment &&
        invoice.balanceDue != '0' &&
        _detail!.creditedAmount != invoice.totalAmount;
  }

  Future<void> _download() async {
    setState(() => _downloading = true);
    final result = await _controller.downloadPdf();
    if (!mounted) return;
    setState(() => _downloading = false);
    if (result.message != null) showAppSnack(context, result.message!, error: !result.ok);
  }

  Future<void> _send() async {
    final api = context.read<ApiService>();
    final ok = await _action.run(() async {
      final result = await api.sendInvoice(widget.invoiceId);
      final status = result['status'];
      if (status == 'sent') {
        if (!mounted) return;
        showAppSnack(context, 'Invoice berhasil dikirim ke email customer.');
      } else if (status == 'already_sent') {
        if (!mounted) return;
        showAppSnack(context, 'Invoice sebelumnya sudah pernah dikirim.');
      }
    });
    if (!ok && mounted) {
      showAppSnack(context, _action.error ?? 'Invoice gagal dikirim.', error: true);
    }
  }

  Future<void> _cancel() async {
    final confirmed = await confirmAction(
      context,
      title: 'Batalkan invoice?',
      message:
          '${_detail!.invoice.invoiceNumber} akan berstatus cancelled dan tidak dapat menerima '
          'pembayaran. Invoice yang sudah memiliki pembayaran tidak dapat dibatalkan.',
      confirmLabel: 'Ya, batalkan',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    final ok = await _action.run(
      () => context.read<ApiService>().cancelInvoice(widget.invoiceId),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Invoice berhasil dibatalkan.');
      await _controller.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Invoice tidak dapat dibatalkan.', error: true);
    }
  }

  Future<void> _delete() async {
    final confirmed = await confirmAction(
      context,
      title: 'Hapus invoice?',
      message:
          '${_detail!.invoice.invoiceNumber} akan dihapus permanen. Hanya invoice cancelled tanpa '
          'pembayaran dan credit note yang dapat dihapus.',
      confirmLabel: 'Ya, hapus',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    final ok = await _action.run(
      () => context.read<ApiService>().deleteInvoice(widget.invoiceId),
    );
    if (!mounted) return;
    if (ok) {
      context.go('/invoices');
    } else {
      showAppSnack(context, _action.error ?? 'Invoice tidak dapat dihapus.', error: true);
    }
  }

  Future<void> _edit() async {
    final updated = await showManualInvoiceDialog(context, invoice: _detail);
    if (!updated || !mounted) return;
    showAppSnack(context, 'Invoice berhasil diubah.');
    await _controller.refresh();
  }

  Future<void> _creditNote() async {
    final detail = _detail!;
    final amount = await showReasonDialog(
      context,
      title: 'Terbitkan credit note',
      label: 'Jumlah kredit (${detail.invoice.currency})',
      numeric: true,
      confirmLabel: 'Lanjut',
      minLength: 1,
    );
    if (amount == null || !mounted) return;
    final reason = await showReasonDialog(
      context,
      title: 'Alasan credit note',
      label: 'Alasan',
      confirmLabel: 'Terbitkan',
    );
    if (reason == null || !mounted) return;

    final ok = await _action.run(() async {
      await context.read<ApiService>().addCreditNote(
        detail.invoice.id,
        amount: amount.replaceAll(RegExp(r'\D'), ''),
        reason: reason,
      );
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Credit note berhasil diterbitkan.');
      await _controller.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Credit note gagal dibuat.', error: true);
    }
  }

  Future<void> _recordPayment() async {
    final recorded = await showPaymentDialog(
      context,
      invoiceId: widget.invoiceId,
    );
    if (!recorded || !mounted) return;
    showAppSnack(context, 'Pembayaran dicatat.');
    await _controller.refresh();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<InvoiceDetailController>.value(
      value: _controller,
      child: Consumer<InvoiceDetailController>(
        builder: (context, controller, _) {
          final detail = controller.value;
          return AdminScaffold(
            showBack: true,
            actions: [
              PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert, size: 20),
                enabled: !_action.isPending && detail != null,
                onSelected: (value) {
                  switch (value) {
                    case 'edit':
                      _edit();
                    case 'credit':
                      _creditNote();
                    case 'cancel':
                      _cancel();
                    case 'delete':
                      _delete();
                  }
                },
                itemBuilder: (context) => [
                  if (_canEdit)
                    const PopupMenuItem(value: 'edit', child: Text('Ubah invoice')),
                  if (_canIssueCredit)
                    const PopupMenuItem(value: 'credit', child: Text('Credit note')),
                  if (_cancelable)
                    const PopupMenuItem(value: 'cancel', child: Text('Batalkan')),
                  if (detail?.invoice.status == 'cancelled')
                    const PopupMenuItem(value: 'delete', child: Text('Hapus')),
                ],
              ),
            ],
            child: _body(context, controller),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, InvoiceDetailController controller) {
    final colors = context.colors;
    final detail = controller.value;

    if (controller.isLoading && detail == null) {
      return const LoadingList(count: 3, height: 120);
    }
    if (detail == null) {
      return ErrorState(
        message: controller.error ?? 'Invoice tidak ditemukan.',
        onRetry: controller.refresh,
      );
    }

    final invoice = detail.invoice;

    return ListView(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    invoice.invoiceNumber,
                    style: TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.4,
                      fontFamily: 'monospace',
                      color: colors.ink,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'Dibuat ${Fmt.date(invoice.issueDate)} · jatuh tempo ${Fmt.date(invoice.dueDate)}',
                    style: TextStyle(fontSize: 12, color: colors.muted),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    invoice.customerDisplayName,
                    style: TextStyle(fontSize: 12.5, color: colors.ink),
                  ),
                ],
              ),
            ),
            StatusPill.status(invoice.status),
          ],
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: _downloading ? null : _download,
                icon: _downloading
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.download_outlined, size: 17),
                label: Text(_downloading ? 'Mengunduh…' : 'PDF'),
              ),
            ),
            if (_canRecordPayment) ...[
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _action.isPending ? null : _recordPayment,
                  icon: const Icon(Icons.payments_outlined, size: 17),
                  label: const Text('Bayar'),
                ),
              ),
            ],
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _action.isPending ? null : _send,
                icon: const Icon(Icons.mail_outline, size: 17),
                label: const Text('Email'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 14),
        InvoiceBody(detail: detail),
        if (controller.error != null)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(
              controller.error!,
              style: TextStyle(fontSize: 11.5, color: colors.danger),
            ),
          ),
        const SizedBox(height: 12),
        TextButton.icon(
          onPressed: () => context.go('/invoices'),
          icon: const Icon(Icons.arrow_back, size: 14),
          label: const Text('Kembali ke daftar invoice'),
        ),
      ],
    );
  }
}
