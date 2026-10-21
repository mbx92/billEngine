import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/services/api_service.dart';

/// Records a payment against an invoice. The invoice list is loaded lazily so
/// the dialog can be opened straight from an invoice detail screen.
Future<bool> showPaymentDialog(
  BuildContext context, {
  String? invoiceId,
  String? suggestedAmount,
}) async {
  final result = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (context) => _PaymentDialog(
      initialInvoiceId: invoiceId,
      suggestedAmount: suggestedAmount,
    ),
  );
  return result ?? false;
}

class _PaymentDialog extends StatefulWidget {
  const _PaymentDialog({this.initialInvoiceId, this.suggestedAmount});

  final String? initialInvoiceId;
  final String? suggestedAmount;

  @override
  State<_PaymentDialog> createState() => _PaymentDialogState();
}

class _PaymentDialogState extends State<_PaymentDialog> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _notes = TextEditingController();

  List<PaymentInvoiceOption> _options = const <PaymentInvoiceOption>[];
  String? _invoiceId;
  String _method = 'transfer';
  String _status = 'completed';
  bool _loading = true;
  bool _saving = false;
  String? _error;

  static const Map<String, String> _methods = <String, String>{
    'transfer': 'Transfer bank',
    'cash': 'Tunai',
    'qris': 'QRIS',
    'virtual_account': 'Virtual account',
    'card': 'Kartu',
    'other': 'Lainnya',
  };

  @override
  void initState() {
    super.initState();
    _invoiceId = widget.initialInvoiceId;
    if (widget.suggestedAmount != null) _amount.text = widget.suggestedAmount!;
    _loadOptions();
  }

  Future<void> _loadOptions() async {
    try {
      final options = await context.read<ApiService>().paymentOptions();
      if (!mounted) return;
      setState(() {
        _options = options;
        if (_invoiceId == null && options.length == 1) {
          _invoiceId = options.first.id;
          _amount.text = options.first.balanceDue;
        }
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = '$error';
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _notes.dispose();
    super.dispose();
  }

  PaymentInvoiceOption? get _selected {
    for (final option in _options) {
      if (option.id == _invoiceId) return option;
    }
    return null;
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_invoiceId == null) {
      setState(() => _error = 'Pilih invoice yang akan dibayar.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await context.read<ApiService>().recordPayment(<String, dynamic>{
        'invoiceId': _invoiceId,
        'amount': _amount.text.trim(),
        'method': _method,
        'status': _status,
        if (_reference.text.trim().isNotEmpty) 'reference': _reference.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = '$error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final selected = _selected;

    return AlertDialog(
      backgroundColor: colors.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      title: const Text(
        'Catat pembayaran',
        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
      content: SizedBox(
        width: 460,
        child: _loading
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            : Form(
                key: _formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Text(
                            _error!,
                            style: TextStyle(fontSize: 12, color: colors.danger),
                          ),
                        ),
                      DropdownButtonFormField<String>(
                        initialValue:
                            _options.any((option) => option.id == _invoiceId) ? _invoiceId : null,
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: 'Invoice'),
                        items: [
                          for (final option in _options)
                            DropdownMenuItem(
                              value: option.id,
                              child: Text(
                                '${option.invoiceNumber} · ${option.customerDisplayName}',
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 12.5),
                              ),
                            ),
                        ],
                        validator: (value) => value == null ? 'Invoice wajib dipilih.' : null,
                        onChanged: _saving
                            ? null
                            : (value) => setState(() {
                                _invoiceId = value;
                                final option = _selected;
                                if (option != null) _amount.text = option.balanceDue;
                              }),
                      ),
                      if (selected != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            'Sisa tagihan ${Fmt.money(selected.balanceDue, selected.currency)} '
                            '· jatuh tempo ${Fmt.date(selected.dueDate)}',
                            style: TextStyle(fontSize: 11, color: colors.muted),
                          ),
                        ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _amount,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          labelText: 'Jumlah',
                          prefixText: selected == null ? null : '${selected.currency} ',
                        ),
                        validator: (value) {
                          final text = value?.trim() ?? '';
                          if (text.isEmpty) return 'Jumlah wajib diisi.';
                          final parsed = int.tryParse(text);
                          if (parsed == null || parsed <= 0) return 'Jumlah harus lebih dari 0.';
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _method,
                        decoration: const InputDecoration(labelText: 'Metode'),
                        items: [
                          for (final entry in _methods.entries)
                            DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                        ],
                        onChanged: _saving
                            ? null
                            : (value) => setState(() => _method = value ?? 'transfer'),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _status,
                        decoration: const InputDecoration(labelText: 'Status pembayaran'),
                        items: const [
                          DropdownMenuItem(value: 'completed', child: Text('Lunas (completed)')),
                          DropdownMenuItem(value: 'pending', child: Text('Menunggu (pending)')),
                        ],
                        onChanged: _saving
                            ? null
                            : (value) => setState(() => _status = value ?? 'completed'),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _reference,
                        decoration: const InputDecoration(labelText: 'Referensi transfer'),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _notes,
                        minLines: 2,
                        maxLines: 3,
                        decoration: const InputDecoration(labelText: 'Catatan'),
                      ),
                    ],
                  ),
                ),
              ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: (_saving || _loading || _options.isEmpty) ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Simpan'),
        ),
      ],
    );
  }
}
