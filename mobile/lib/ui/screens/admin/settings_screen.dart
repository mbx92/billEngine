import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/operations.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final ItemController<BillingSettings> _settings;
  final _action = ActionController();
  final _formKey = GlobalKey<FormState>();

  final _companyName = TextEditingController();
  final _companyEmail = TextEditingController();
  final _companyAddress = TextEditingController();
  final _companyTaxId = TextEditingController();
  final _timezone = TextEditingController();
  final _currency = TextEditingController();
  final _taxRate = TextEditingController();
  final _graceDays = TextEditingController();
  final _noticeInterval = TextEditingController();
  bool _automation = false;
  bool _accessControl = false;
  bool _seeded = false;

  @override
  void initState() {
    super.initState();
    _settings = ItemController<BillingSettings>(fetch: context.read<ApiService>().settings);
    _settings.load();
  }

  @override
  void dispose() {
    for (final controller in <TextEditingController>[
      _companyName,
      _companyEmail,
      _companyAddress,
      _companyTaxId,
      _timezone,
      _currency,
      _taxRate,
      _graceDays,
      _noticeInterval,
    ]) {
      controller.dispose();
    }
    _settings.dispose();
    _action.dispose();
    super.dispose();
  }

  void _hydrate(BillingSettings settings) {
    if (_seeded) return;
    _seeded = true;
    _companyName.text = settings.companyName;
    _companyEmail.text = settings.companyEmail ?? '';
    _companyAddress.text = settings.companyAddress ?? '';
    _companyTaxId.text = settings.companyTaxId ?? '';
    _timezone.text = settings.billingTimezone;
    _currency.text = settings.billingCurrency;
    _taxRate.text = settings.defaultTaxRate ?? '';
    _graceDays.text = '${settings.overdueGraceDays}';
    _noticeInterval.text = '${settings.graceNoticeIntervalHours}';
    _automation = settings.billingAutomationEnabled;
    _accessControl = settings.billingAccessControlEnabled;
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();

    final payload = <String, dynamic>{
      'companyName': _companyName.text.trim(),
      'companyEmail': _emptyToNull(_companyEmail.text),
      'companyAddress': _emptyToNull(_companyAddress.text),
      'companyTaxId': _emptyToNull(_companyTaxId.text),
      'billingTimezone': _timezone.text.trim(),
      'billingCurrency': _currency.text.trim().toUpperCase(),
      'defaultTaxRate': _emptyToNull(_taxRate.text),
      'billingAutomationEnabled': _automation,
      'billingAccessControlEnabled': _accessControl,
      'overdueGraceDays': int.tryParse(_graceDays.text.trim()) ?? 7,
      'graceNoticeIntervalHours': int.tryParse(_noticeInterval.text.trim()) ?? 24,
    };

    final api = context.read<ApiService>();
    final settingsController = context.read<SettingsController>();
    final ok = await _action.run(() async {
      await api.updateSettings(payload);
      await settingsController.load(force: true);
    });
    if (!mounted) return;
    if (ok) {
      _seeded = false;
      await _settings.refresh();
      if (mounted) {
        showAppSnack(context, 'Settings disimpan dan dipakai pada invoice berikutnya.');
      }
    } else {
      showAppSnack(context, _action.error ?? 'Gagal menyimpan settings.', error: true);
    }
  }

  static String? _emptyToNull(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<BillingSettings>>.value(
        value: _settings,
        child: Consumer<ItemController<BillingSettings>>(
          builder: (context, controller, _) {
            final settings = controller.value;
            if (settings != null) _hydrate(settings);

            if (controller.isLoading && settings == null) {
              return const LoadingList(count: 4, height: 150);
            }
            if (controller.error != null && settings == null) {
              return ListView(
                children: [
                  AppCard(
                    child: ErrorState(
                      message: controller.error!,
                      onRetry: () {
                        _seeded = false;
                        controller.refresh();
                      },
                    ),
                  ),
                ],
              );
            }

            final source = settings?.source ?? 'environment';

            return Form(
              key: _formKey,
              child: ListView(
                children: [
                  SectionHeader(
                    eyebrow: 'Platform / configuration',
                    title: 'Settings',
                    subtitle:
                        'Identitas perusahaan dan default billing untuk invoice yang dibuat '
                        'setelah perubahan.',
                    trailing: StatusPill(
                      label: source == 'database' ? 'Database' : 'Environment',
                      tone: source == 'database' ? 'success' : 'muted',
                      dense: true,
                    ),
                  ),
                  const SizedBox(height: 14),
                  _Block(
                    title: 'Profil perusahaan',
                    subtitle: 'Disalin sebagai seller snapshot saat invoice dibuat.',
                    children: [
                      _field(_companyName, 'Nama perusahaan', required: true),
                      _field(_companyEmail, 'Email billing', keyboardType: TextInputType.emailAddress),
                      _field(_companyTaxId, 'NPWP / Tax ID'),
                      _field(_companyAddress, 'Alamat perusahaan', lines: 3),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _Block(
                    title: 'Overdue access gate',
                    subtitle:
                        'Menampilkan halaman peringatan selama grace period dan memblokir trafik web '
                        'setelahnya. Resource tetap berjalan.',
                    badge: StatusPill(
                      label: _accessControl ? 'Enabled' : 'Disabled',
                      tone: _accessControl ? 'warning' : 'muted',
                      dense: true,
                    ),
                    children: [
                      SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        value: _accessControl,
                        onChanged: (value) => setState(() => _accessControl = value),
                        title: const Text('Enable access gate', style: TextStyle(fontSize: 13.5)),
                      ),
                      _field(
                        _graceDays,
                        'Grace period (hari)',
                        keyboardType: TextInputType.number,
                        digitsOnly: true,
                        required: true,
                        hint: '0 berarti blokir sejak hari pertama overdue',
                      ),
                      _field(
                        _noticeInterval,
                        'Ulangi pemberitahuan (jam)',
                        keyboardType: TextInputType.number,
                        digitsOnly: true,
                        required: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _Block(
                    title: 'Billing automation',
                    subtitle:
                        'Mengizinkan engine membuat invoice dari service yang jatuh jadwal dan '
                        'menandai overdue tiap jam.',
                    badge: StatusPill(
                      label: _automation ? 'Enabled' : 'Disabled',
                      tone: _automation ? 'success' : 'muted',
                      dense: true,
                    ),
                    children: [
                      SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        value: _automation,
                        onChanged: (value) => setState(() => _automation = value),
                        title: const Text('Enable automation', style: TextStyle(fontSize: 13.5)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _Block(
                    title: 'Default billing',
                    subtitle: 'Dipakai untuk tanggal billing, mata uang, dan pajak invoice baru.',
                    children: [
                      _field(_timezone, 'Billing timezone', hint: 'Asia/Makassar', required: true),
                      _field(
                        _currency,
                        'Mata uang default',
                        hint: 'IDR',
                        required: true,
                        maxLength: 3,
                        uppercase: true,
                      ),
                      _field(
                        _taxRate,
                        'Default tax rate',
                        hint: '0.11 berarti 11%',
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: _action.isPending ? null : _save,
                    icon: const Icon(Icons.save_outlined, size: 16),
                    label: Text(_action.isPending ? 'Menyimpan…' : 'Simpan settings'),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Invoice lama tidak berubah karena menyimpan snapshot seller dan nilai billing.',
                    style: TextStyle(fontSize: 10.5, color: colors.muted),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = false,
    String? hint,
    int lines = 1,
    int? maxLength,
    bool digitsOnly = false,
    bool uppercase = false,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        keyboardType: lines > 1 ? TextInputType.multiline : keyboardType,
        minLines: lines > 1 ? lines : 1,
        maxLines: lines > 1 ? 6 : 1,
        autocorrect: false,
        textCapitalization: uppercase ? TextCapitalization.characters : TextCapitalization.none,
        inputFormatters: <TextInputFormatter>[
          if (digitsOnly) FilteringTextInputFormatter.digitsOnly,
          if (maxLength != null) LengthLimitingTextInputFormatter(maxLength),
        ],
        decoration: InputDecoration(labelText: label, hintText: hint, alignLabelWithHint: lines > 1),
        validator: (value) {
          final text = value?.trim() ?? '';
          if (required && text.isEmpty) return '$label wajib diisi.';
          if (uppercase && text.isNotEmpty && text.length != 3) {
            return 'Gunakan kode 3 huruf, contoh IDR.';
          }
          return null;
        },
      ),
    );
  }
}

/// Block section with a title, optional description, and a status badge.
class _Block extends StatelessWidget {
  const _Block({
    required this.title,
    this.subtitle,
    required this.children,
    this.badge,
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
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
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: colors.ink,
                      ),
                    ),
                    if (subtitle != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Text(
                          subtitle!,
                          style: TextStyle(fontSize: 11, height: 1.45, color: colors.muted),
                        ),
                      ),
                  ],
                ),
              ),
              if (badge != null) ...[const SizedBox(width: 8), badge!],
            ],
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }
}

/// Exposes the current formatted date for the settings footer without adding a
/// second date formatter to the core helpers.
String settingsVersionLabel() => Fmt.date(Fmt.todayIso());
