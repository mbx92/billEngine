import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

/// Root widget: builds the router and exposes the shared controllers.
class BillEngineApp extends StatelessWidget {
  const BillEngineApp({
    super.key,
    required this.routerConfig,
    required this.themeMode,
    required this.onToggleTheme,
  });

  final RouterConfig<Object> routerConfig;
  final ThemeMode themeMode;
  final VoidCallback onToggleTheme;

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Billing Infra',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.build(Brightness.light),
      darkTheme: AppTheme.build(Brightness.dark),
      themeMode: themeMode,
      routerConfig: routerConfig,
      builder: (context, child) {
        final media = MediaQuery.of(context);
        // Keep text scaling bounded so tabular money columns stay readable.
        return MediaQuery(
          data: media.copyWith(
            textScaler: media.textScaler.clamp(minScaleFactor: 0.9, maxScaleFactor: 1.25),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}

/// Theme mode is a UI concern, so it lives in its own tiny controller instead
/// of the auth/settings controllers.
class ThemeController extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.system;

  ThemeMode get mode => _mode;

  bool get isDark =>
      _mode == ThemeMode.dark ||
      (_mode == ThemeMode.system &&
          WidgetsBinding.instance.platformDispatcher.platformBrightness == Brightness.dark);

  void toggle() {
    _mode = isDark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
  }
}

class AppScaffold extends StatelessWidget {
  const AppScaffold({
    super.key,
    required this.title,
    required this.child,
    this.actions,
    this.showBack = true,
    this.padded = true,
    this.floatingAction,
    this.bottomBar,
    this.onRefresh,
  });

  final String title;
  final Widget child;
  final List<Widget>? actions;
  final bool showBack;
  final bool padded;
  final Widget? floatingAction;
  final Widget? bottomBar;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final body = padded
        ? Padding(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), child: child)
        : child;

    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        automaticallyImplyLeading: showBack,
        title: Text(title),
        actions: [
          ...?actions,
          IconButton(
            tooltip: 'Ganti tema',
            onPressed: () => context.read<ThemeController>().toggle(),
            icon: Icon(
              Theme.of(context).brightness == Brightness.dark
                  ? Icons.light_mode_outlined
                  : Icons.dark_mode_outlined,
              size: 20,
            ),
          ),
          const SizedBox(width: 4),
        ],
        bottom: bottomBar == null
            ? null
            : PreferredSize(preferredSize: const Size.fromHeight(48), child: bottomBar!),
      ),
      floatingActionButton: floatingAction,
      body: onRefresh == null ? body : RefreshIndicator(onRefresh: onRefresh!, child: body),
    );
  }
}

/// Login screen. Also lets the operator point the app at a different control
/// plane (emulator loopback vs a LAN address).
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  late final TextEditingController _baseUrl;
  bool _obscure = true;
  bool _showServer = false;

  @override
  void initState() {
    super.initState();
    _baseUrl = TextEditingController(text: context.read<AuthController>().baseUrl);
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _baseUrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    final auth = context.read<AuthController>();
    final ok = await auth.signIn(
      email: _email.text,
      password: _password.text,
      baseUrl: _showServer ? _baseUrl.text : null,
    );
    if (!mounted || ok) return;
    final message = auth.error ?? 'Tidak dapat masuk.';
    showAppSnack(context, message, error: true);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final auth = context.watch<AuthController>();

    return Scaffold(
      backgroundColor: colors.canvas,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 38,
                          height: 38,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: colors.brand.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: colors.brand.withValues(alpha: 0.32)),
                          ),
                          child: Text(
                            'B_',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: colors.brand,
                              fontFamily: 'monospace',
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Billing Infra',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                  color: colors.ink,
                                ),
                              ),
                              Text(
                                'OC Infrastructure Platform',
                                style: TextStyle(fontSize: 11.5, color: colors.muted),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 34),
                    Text(
                      'Masuk ke akun Anda',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.5,
                        color: colors.ink,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Gunakan kredensial admin atau akun customer portal.',
                      style: TextStyle(fontSize: 13, height: 1.45, color: colors.muted),
                    ),
                    const SizedBox(height: 24),
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Email',
                        prefixIcon: Icon(Icons.mail_outline, size: 18),
                      ),
                      validator: (value) {
                        final text = value?.trim() ?? '';
                        if (text.isEmpty) return 'Email wajib diisi.';
                        if (!text.contains('@')) return 'Format email tidak valid.';
                        return null;
                      },
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline, size: 18),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _obscure = !_obscure),
                          icon: Icon(
                            _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                            size: 18,
                          ),
                        ),
                      ),
                      validator: (value) =>
                          (value == null || value.isEmpty) ? 'Password wajib diisi.' : null,
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () => setState(() => _showServer = !_showServer),
                        icon: Icon(
                          _showServer ? Icons.expand_less : Icons.expand_more,
                          size: 16,
                        ),
                        label: const Text('Alamat server'),
                      ),
                    ),
                    if (_showServer) ...[
                      TextFormField(
                        controller: _baseUrl,
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                        decoration: const InputDecoration(
                          labelText: 'Base URL',
                          helperText: 'Emulator: http://10.0.2.2:3000',
                          prefixIcon: Icon(Icons.dns_outlined, size: 18),
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: auth.isSubmitting ? null : _submit,
                      child: auth.isSubmitting
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Masuk'),
                    ),
                    if (auth.error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: colors.danger.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: colors.danger.withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.error_outline, size: 16, color: colors.danger),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                auth.error!,
                                style: TextStyle(
                                  fontSize: 12,
                                  height: 1.4,
                                  color: colors.danger,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 28),
                    Text(
                      'Versi ${Fmt.todayIso().replaceAll('-', '.')} · mobile',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 10.5, color: colors.muted),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
