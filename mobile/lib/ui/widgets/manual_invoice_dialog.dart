import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/customer.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/services/api_service.dart';

/// A single editable invoice line inside [ManualInvoiceDialog].
class _LineDraft {
  _LineDraft();

  final description = TextEditingController();
  final quantity = TextEditingController(text: '1');
  final unitPrice = TextEditingController();
  final taxRate = TextEditingController();
  String? serviceId;

  void dispose() {
    description.dispose();
    quantity.dispose();
    unitPrice.dispose();
    taxRate.dispose();
  }

  Map<String, dynamic>? toJson() {
    final text = description.text.trim();
    final price = unitPrice.text.trim();
    if (text.isEmpty || price.isEmpty) return null;
    return <String, dynamic>{
      if (serviceId != null) 'serviceId': serviceId,
      'description': text,
      'quantity': quantity.text.trim().isEmpty ? '1' : quantity.text.trim(),
      'unitPriceAmount': price,
      if (taxRate.text.trim().isNotEmpty) 'taxRate': taxRate.text.trim(),
    };
  }
}

/// Creates or edits a manual invoice. Totals are always recomputed by the
/// server from the lines, so the dialog only collects inputs.
class ManualInvoiceDialog extends StatefulWidget {
  const ManualInvoiceDialog({super.key, this.invoice});

  final InvoiceDetail? invoice;

  @override
  State<ManualInvoiceDialog> createState() => _ManualInvoiceDialogState();
}

class _ManualInvoiceDialogState extends State<ManualInvoiceDialog> {
  final _formKey = GlobalKey<FormState>();
  final List<_LineDraft> _lines = <_LineDraft>[_LineDraft()];
  final _notes = TextEditingController();
  final _discountAmount = TextEditingController();
  final _discountPercent = TextEditingController();

  List<CustomerOption> _customers = const <CustomerOption>[];
  List<InvoiceServiceOption> _services = const <InvoiceServiceOption>[];
  String? _customerId;
  late DateTime _issueDate;
  late DateTime _dueDate;
  bool _loadingOptions = true;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.invoice != null;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _issueDate = DateTime.tryParse(widget.invoice?.invoice.issueDate ?? '') ?? now;
    _dueDate = DateTime.tryParse(widget.invoice?.invoice.dueDate ?? '') ?? now.add(const Duration(days: 7));
    _notes.text = widget.invoice?.notes ?? '';
    _discountAmount.text = widget.invoice?.discountAmount != '0'
        ? widget.invoice!.discountAmount
        : '';
    _discountPercent.text = widget.invoice?.discountPercent ?? '';
    _customerId = widget.invoice?.invoice.customerId;

    if (_isEdit) {
      _lines.clear();
      for (final item in widget.invoice!.items) {
        final draft = _LineDraft();
        draft.description.text = item.description;
        draft.quantity.text = item.quantity;
        draft.unitPrice.text = item.unitPriceAmount;
        draft.taxRate.text = item.taxRate ?? '';
        draft.serviceId = item.serviceId;
        _lines.add(draft);
      }
      if (_lines.isEmpty) _lines.add(_LineDraft());
    }

    _loadOptions();
  }

  Future<void> _loadOptions() async {
    final api = context.read<ApiService>();
    try {
      final result = await api.invoiceOptions();
      if (!mounted) return;
      setState(() {
        _customers = result.customers;
        _services = result.services;
        _loadingOptions = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = '$error';
        _loadingOptions = false;
      });
    }
  }

  @override
  void dispose() {
    _notes.dispose();
    _discountAmount.dispose();
    _discountPercent.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate({required bool due}) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: due ? _dueDate : _issueDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    setState(() {
      if (due) {
        _dueDate = picked;
      } else {
        _issueDate = picked;
        if (_dueDate.isBefore(_issueDate)) _dueDate = picked;
      }
    });
  }

  void _prefillFromService(InvoiceServiceOption service) {
    final line = _lines.first;
    setState(() {
      line.serviceId = service.id;
      line.description.text =
          '${service.name} (${Fmt.billingCycle(service.billingCycle)})';
      line.unitPrice.text = service.priceAmount;
      line.quantity.text = '1';
    });
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_customerId == null) {
      setState(() => _error = 'Pilih customer untuk invoice ini.');
      return;
    }
    final items = _lines.map((line) => line.toJson()).whereType<Map<String, dynamic>>().toList();
    if (items.isEmpty) {
      setState(() => _error = 'Tambahkan minimal satu item invoice.');
      return;
    }

    final payload = <String, dynamic>{
      'customerId': _customerId,
      'issueDate': Fmt.isoDate(_issueDate),
      'dueDate': Fmt.isoDate(_dueDate),
      'items': items,
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      if (_discountPercent.text.trim().isNotEmpty) 'discountPercent': _discountPercent.text.trim(),
      if (_discountPercent.text.trim().isEmpty && _discountAmount.text.trim().isNotEmpty)
        'discountAmount': _discountAmount.text.trim(),
    };

    setState(() {
      _saving = true;
      _error = null;
    });

    final api = context.read<ApiService>();
    try {
      if (_isEdit) {
        await api.updateInvoice(widget.invoice!.invoice.id, payload);
      } else {
        await api.createInvoice(payload);
      }
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
    final customerServices = _services.where((s) => s.customerId == _customerId).toList();

    return Dialog(
      backgroundColor: colors.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 20),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 620, maxHeight: 780),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 10, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _isEdit ? 'Ubah invoice' : 'Manual invoice',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                        Text(
                          'Total dihitung ulang oleh server dari baris item.',
                          style: TextStyle(fontSize: 11.5, color: colors.muted),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: _saving ? null : () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, size: 18),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: colors.line),
            Flexible(
              child: _loadingOptions
                  ? const Padding(
                      padding: EdgeInsets.all(30),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  : Form(
                      key: _formKey,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(18, 14, 18, 10),
                        children: [
                          if (_error != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Text(
                                _error!,
                                style: TextStyle(fontSize: 12, color: colors.danger),
                              ),
                            ),
                          DropdownButtonFormField<String>(
                            initialValue: _customers.any((c) => c.id == _customerId)
                                ? _customerId
                                : null,
                            isExpanded: true,
                            decoration: const InputDecoration(labelText: 'Customer'),
                            items: [
                              for (final customer in _customers)
                                DropdownMenuItem(
                                  value: customer.id,
                                  child: Text(
                                    '${customer.displayName} · ${customer.customerNumber}',
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 13),
                                  ),
                                ),
                            ],
                            onChanged: _isEdit
                                ? null
                                : (value) => setState(() {
                                    _customerId = value;
                                    for (final line in _lines) {
                                      line.serviceId = null;
                                    }
                                  }),
                            validator: (value) => value == null ? 'Customer wajib dipilih.' : null,
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: InkWell(
                                  onTap: () => _pickDate(due: false),
                                  child: InputDecorator(
                                    decoration: const InputDecoration(labelText: 'Issue date'),
                                    child: Text(
                                      Fmt.isoDate(_issueDate),
                                      style: TextStyle(fontSize: 13, color: colors.ink),
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: InkWell(
                                  onTap: () => _pickDate(due: true),
                                  child: InputDecorator(
                                    decoration: const InputDecoration(labelText: 'Due date'),
                                    child: Text(
                                      Fmt.isoDate(_dueDate),
                                      style: TextStyle(fontSize: 13, color: colors.ink),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          if (!_isEdit && customerServices.isNotEmpty) ...[
                            const SizedBox(height: 14),
                            Text(
                              'ISI DARI SERVICE',
                              style: TextStyle(
                                fontSize: 10,
                                letterSpacing: 1,
                                fontWeight: FontWeight.w700,
                                color: colors.muted,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                for (final service in customerServices)
                                  ActionChip(
                                    label: Text(
                                      service.name,
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                    onPressed: () => _prefillFromService(service),
                                  ),
                              ],
                            ),
                          ],
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'ITEM INVOICE',
                                  style: TextStyle(
                                    fontSize: 10,
                                    letterSpacing: 1,
                                    fontWeight: FontWeight.w700,
                                    color: colors.muted,
                                  ),
                                ),
                              ),
                              TextButton.icon(
                                onPressed: _saving
                                    ? null
                                    : () => setState(() => _lines.add(_LineDraft())),
                                icon: const Icon(Icons.add, size: 14),
                                label: const Text('Item'),
                              ),
                            ],
                          ),
                          for (var index = 0; index < _lines.length; index++)
                            _lineEditor(context, index),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _discountAmount,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'Diskon nominal',
                              hintText: 'Kosongkan jika tidak ada',
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextFormField(
                            controller: _discountPercent,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: const InputDecoration(
                              labelText: 'Diskon persen (0–1)',
                              hintText: 'Contoh 0.1 untuk 10%',
                            ),
                            validator: (value) {
                              final text = value?.trim() ?? '';
                              if (text.isEmpty) return null;
                              if (_discountAmount.text.trim().isNotEmpty) {
                                return 'Pilih nominal atau persen, bukan keduanya.';
                              }
                              final parsed = double.tryParse(text);
                              if (parsed == null || parsed < 0 || parsed > 1) {
                                return 'Nilai harus antara 0 dan 1.';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _notes,
                            minLines: 2,
                            maxLines: 4,
                            decoration: const InputDecoration(labelText: 'Catatan'),
                          ),
                        ],
                      ),
                    ),
            ),
            Divider(height: 1, color: colors.line),
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _saving ? null : () => Navigator.of(context).pop(),
                      child: const Text('Batal'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: (_saving || _loadingOptions) ? null : _save,
                      child: _saving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(_isEdit ? 'Simpan perubahan' : 'Buat invoice'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _lineEditor(BuildContext context, int index) {
    final colors = context.colors;
    final line = _lines[index];
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 6, 8, 10),
      decoration: BoxDecoration(
        color: colors.canvas,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Item ${index + 1}',
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: colors.muted),
                ),
              ),
              if (_lines.length > 1)
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: () => setState(() {
                    _lines.removeAt(index).dispose();
                  }),
                  icon: Icon(Icons.delete_outline, size: 17, color: colors.danger),
                ),
            ],
          ),
          TextFormField(
            controller: line.description,
            decoration: const InputDecoration(labelText: 'Deskripsi'),
            validator: (value) =>
                (value?.trim().isEmpty ?? true) ? 'Deskripsi wajib diisi.' : null,
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: TextFormField(
                  controller: line.quantity,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Qty'),
                  validator: (value) {
                    final text = value?.trim() ?? '';
                    if (text.isEmpty) return null;
                    final parsed = double.tryParse(text);
                    if (parsed == null || parsed <= 0) return 'Qty tidak valid.';
                    return null;
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 3,
                child: TextFormField(
                  controller: line.unitPrice,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Harga satuan'),
                  validator: (value) {
                    final text = value?.trim() ?? '';
                    if (text.isEmpty) return 'Wajib diisi.';
                    if (int.tryParse(text) == null) return 'Angka bulat.';
                    return null;
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 2,
                child: TextFormField(
                  controller: line.taxRate,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Pajak'),
                  validator: (value) {
                    final text = value?.trim() ?? '';
                    if (text.isEmpty) return null;
                    final parsed = double.tryParse(text);
                    if (parsed == null || parsed < 0 || parsed > 1) return '0–1';
                    return null;
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Shared helper for opening the dialog above.
Future<bool> showManualInvoiceDialog(BuildContext context, {InvoiceDetail? invoice}) async {
  final result = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (context) => ManualInvoiceDialog(invoice: invoice),
  );
  return result ?? false;
}

/// Renders a labelled money row used by totals previews.
class PaymentSummaryRow extends StatelessWidget {
  const PaymentSummaryRow({
    super.key,
    required this.label,
    required this.value,
    this.bold = false,
  });

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 12.5, color: bold ? colors.ink : colors.muted),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
              color: colors.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
