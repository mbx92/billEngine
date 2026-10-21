import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';

enum FieldType { text, email, password, number, integer, multiline, date, select, toggle }

class FieldSpec {
  FieldSpec.text(
    this.key,
    this.label, {
    this.hint,
    this.initial,
    this.required = false,
    this.keyboardType,
    this.obscure = false,
  }) : type = FieldType.text,
       options = const <String, String>{};

  FieldSpec.email(
    this.key,
    this.label, {
    this.hint,
    this.initial,
    this.required = false,
  }) : type = FieldType.email,
       options = const <String, String>{},
       keyboardType = TextInputType.emailAddress,
       obscure = false;

  FieldSpec.password(this.key, this.label, {this.hint, this.required = false})
    : type = FieldType.password,
      options = const <String, String>{},
      initial = null,
      keyboardType = null,
      obscure = true;

  FieldSpec.integer(
    this.key,
    this.label, {
    this.hint,
    this.initial,
    this.required = false,
  }) : type = FieldType.integer,
       options = const <String, String>{},
       keyboardType = TextInputType.number,
       obscure = false;

  FieldSpec.decimal(
    this.key,
    this.label, {
    this.hint,
    this.initial,
    this.required = false,
  }) : type = FieldType.number,
       options = const <String, String>{},
       keyboardType = const TextInputType.numberWithOptions(decimal: true),
       obscure = false;

  FieldSpec.multiline(
    this.key,
    this.label, {
    this.hint,
    this.initial,
    this.required = false,
  }) : type = FieldType.multiline,
       options = const <String, String>{},
       keyboardType = TextInputType.multiline,
       obscure = false;

  FieldSpec.select(
    this.key,
    this.label, {
    required this.options,
    this.initial,
    this.required = false,
    this.hint,
  }) : type = FieldType.select,
       keyboardType = null,
       obscure = false;

  FieldSpec.date(this.key, this.label, {this.initial, this.required = false, this.hint})
    : type = FieldType.date,
      options = const <String, String>{},
      keyboardType = null,
      obscure = false;

  FieldSpec.toggle(this.key, this.label, {bool initial = false, this.hint})
    : type = FieldType.toggle,
      options = const <String, String>{},
      initial = initial ? 'true' : 'false',
      required = false,
      keyboardType = null,
      obscure = false;

  final String key;
  final String label;
  final String? hint;
  final String? initial;
  final bool required;
  final FieldType type;
  final Map<String, String> options;
  final TextInputType? keyboardType;
  final bool obscure;

  bool get isBoolean => type == FieldType.toggle;
}

/// Renders a modal form from declarative field specs and returns the entered
/// values keyed by [FieldSpec.key]. Values that were left blank are omitted so
/// the server's optional-field validation is never fed an empty string.
Future<Map<String, dynamic>?> showRecordForm(
  BuildContext context, {
  required String title,
  required List<FieldSpec> fields,
  String submitLabel = 'Simpan',
  String? description,
}) {
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (context) => _RecordFormDialog(
      title: title,
      description: description,
      fields: fields,
      submitLabel: submitLabel,
    ),
  );
}

class _RecordFormDialog extends StatefulWidget {
  const _RecordFormDialog({
    required this.title,
    required this.fields,
    required this.submitLabel,
    this.description,
  });

  final String title;
  final String? description;
  final List<FieldSpec> fields;
  final String submitLabel;

  @override
  State<_RecordFormDialog> createState() => _RecordFormDialogState();
}

class _RecordFormDialogState extends State<_RecordFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _controllers;
  late final Map<String, bool> _toggles;

  @override
  void initState() {
    super.initState();
    _controllers = <String, TextEditingController>{
      for (final field in widget.fields)
        if (!field.isBoolean) field.key: TextEditingController(text: field.initial ?? ''),
    };
    _toggles = <String, bool>{
      for (final field in widget.fields)
        if (field.isBoolean) field.key: field.initial == 'true',
    };
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate(FieldSpec field) async {
    final controller = _controllers[field.key]!;
    final parsed = DateTime.tryParse(controller.text.trim()) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: parsed,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    controller.text = Fmt.isoDate(picked);
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final values = <String, dynamic>{};
    for (final field in widget.fields) {
      if (field.isBoolean) {
        values[field.key] = _toggles[field.key] ?? false;
        continue;
      }
      final text = _controllers[field.key]!.text.trim();
      if (text.isEmpty) continue;
      values[field.key] = text;
    }
    Navigator.of(context).pop(values);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Dialog(
      backgroundColor: colors.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 120),
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520, maxHeight: 640),
          child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 12, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.title,
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                                color: colors.ink,
                              ),
                            ),
                            if (widget.description != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 3),
                                child: Text(
                                  widget.description!,
                                  style: TextStyle(fontSize: 12, color: colors.muted),
                                ),
                              ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close, size: 18),
                      ),
                    ],
                  ),
                ),
                Divider(height: 1, color: colors.line),
                Flexible(
                  child: Form(
                    key: _formKey,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(18, 16, 18, 8),
                      shrinkWrap: true,
                      children: [
                        for (final field in widget.fields) ...[
                          _buildField(field),
                          const SizedBox(height: 12),
                        ],
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
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Batal'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton(onPressed: _submit, child: Text(widget.submitLabel)),
                      ),
                    ],
                  ),
                ),
              ],
          ),
        ),
      ),
    );
  }

  Widget _buildField(FieldSpec field) {
    if (field.isBoolean) {
      return SwitchListTile.adaptive(
        contentPadding: EdgeInsets.zero,
        value: _toggles[field.key] ?? false,
        onChanged: (value) => setState(() => _toggles[field.key] = value),
        title: Text(field.label, style: const TextStyle(fontSize: 13.5)),
        subtitle: field.hint == null ? null : Text(field.hint!, style: const TextStyle(fontSize: 11.5)),
      );
    }

    final controller = _controllers[field.key]!;

    if (field.type == FieldType.select) {
      final values = field.options.keys.toList(growable: false);
      final current = values.contains(controller.text) ? controller.text : null;
      return DropdownButtonFormField<String>(
        initialValue: current,
        isExpanded: true,
        decoration: InputDecoration(labelText: field.label, helperText: field.hint),
        items: [
          for (final value in values)
            DropdownMenuItem(
              value: value,
              child: Text(
                field.options[value] ?? value,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13.5),
              ),
            ),
        ],
        validator: field.required
            ? (value) => value == null || value.isEmpty ? '${field.label} wajib dipilih.' : null
            : null,
        onChanged: (value) => setState(() => controller.text = value ?? ''),
      );
    }

    if (field.type == FieldType.date) {
      return TextFormField(
        controller: controller,
        readOnly: true,
        onTap: () => _pickDate(field),
        decoration: InputDecoration(
          labelText: field.label,
          hintText: 'YYYY-MM-DD',
          helperText: field.hint,
          suffixIcon: const Icon(Icons.calendar_today_outlined, size: 16),
        ),
        validator: field.required ? _requiredValidator(field) : null,
      );
    }

    final keyboard = switch (field.type) {
      FieldType.email => TextInputType.emailAddress,
      FieldType.number => const TextInputType.numberWithOptions(decimal: true),
      FieldType.integer => TextInputType.number,
      FieldType.multiline => TextInputType.multiline,
      _ => field.keyboardType ?? TextInputType.text,
    };

    return TextFormField(
      controller: controller,
      keyboardType: keyboard,
      obscureText: field.obscure,
      minLines: field.type == FieldType.multiline ? 3 : 1,
      maxLines: field.type == FieldType.multiline ? 6 : 1,
      autocorrect: false,
      inputFormatters: switch (field.type) {
        FieldType.integer => [FilteringTextInputFormatter.digitsOnly],
        FieldType.number => [
          FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
        ],
        _ => null,
      },
      decoration: InputDecoration(
        labelText: field.label,
        hintText: field.hint,
        alignLabelWithHint: field.type == FieldType.multiline,
      ),
      validator: (value) {
        final text = value?.trim() ?? '';
        if (field.required && text.isEmpty) return '${field.label} wajib diisi.';
        if (text.isEmpty) return null;
        if (field.type == FieldType.email && !text.contains('@')) {
          return 'Format email tidak valid.';
        }
        if (field.type == FieldType.integer && int.tryParse(text) == null) {
          return 'Masukkan angka bulat.';
        }
        if (field.type == FieldType.number) {
          final normalized = text.replaceAll('.', '').replaceAll(',', '.');
          if (double.tryParse(normalized) == null) return 'Masukkan angka.';
        }
        return null;
      },
    );
  }

  FormFieldValidator<String> _requiredValidator(FieldSpec field) {
    return (value) => (value == null || value.trim().isEmpty)
        ? '${field.label} wajib diisi.'
        : null;
  }
}

/// Prompt for a single free-text reason (used by cancel/suspend/credit notes).
Future<String?> showReasonDialog(
  BuildContext context, {
  required String title,
  required String label,
  String confirmLabel = 'Simpan',
  int minLength = 3,
  bool numeric = false,
}) {
  return showDialog<String>(
    context: context,
    builder: (context) => _ReasonDialog(
      title: title,
      label: label,
      confirmLabel: confirmLabel,
      minLength: minLength,
      numeric: numeric,
    ),
  );
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({
    required this.title,
    required this.label,
    required this.confirmLabel,
    required this.minLength,
    required this.numeric,
  });

  final String title;
  final String label;
  final String confirmLabel;
  final int minLength;
  final bool numeric;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _controller = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AlertDialog(
      backgroundColor: colors.surface,
      title: Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      content: Form(
        key: _formKey,
        child: TextFormField(
          controller: _controller,
          autofocus: true,
          keyboardType: widget.numeric ? TextInputType.number : TextInputType.multiline,
          minLines: widget.numeric ? 1 : 3,
          maxLines: widget.numeric ? 1 : 5,
          decoration: InputDecoration(labelText: widget.label),
          validator: (value) {
            final text = value?.trim() ?? '';
            if (text.length < widget.minLength) {
              return 'Minimal ${widget.minLength} karakter.';
            }
            return null;
          },
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Batal')),
        FilledButton(
          onPressed: () {
            if (!(_formKey.currentState?.validate() ?? false)) return;
            Navigator.of(context).pop(_controller.text.trim());
          },
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}
