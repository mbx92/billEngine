import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/api_client.dart';
import 'package:billengine_mobile/core/session_store.dart';
import 'package:billengine_mobile/routes/router.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/app_scaffold.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // `Fmt` formats dates and money with the `id_ID` locale; without this the
  // first `DateFormat('...', 'id_ID')` throws LocaleDataException at build
  // time and the app renders the red error screen.
  await initializeDateFormatting('id_ID');

  final sessionStore = SessionStore();
  final api = ApiService(ApiClient(sessionStore: sessionStore));
  final auth = AuthController(api: api, sessionStore: sessionStore);
  final settings = SettingsController(api);
  final theme = ThemeController();

  runApp(
    MultiProvider(
      providers: [
        Provider<ApiService>.value(value: api),
        ChangeNotifierProvider<AuthController>.value(value: auth),
        ChangeNotifierProvider<SettingsController>.value(value: settings),
        ChangeNotifierProvider<ThemeController>.value(value: theme),
      ],
      child: _Bootstrap(auth: auth, settings: settings, theme: theme),
    ),
  );
}

/// Restores the saved session, then hands control to the router. The router is
/// built once so `refreshListenable` keeps a stable instance.
class _Bootstrap extends StatefulWidget {
  const _Bootstrap({required this.auth, required this.settings, required this.theme});

  final AuthController auth;
  final SettingsController settings;
  final ThemeController theme;

  @override
  State<_Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<_Bootstrap> {
  late final GoRouter _router = buildRouter(widget.auth);

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    await widget.auth.bootstrap();
    if (!mounted || !widget.auth.isSignedIn) return;
    await widget.settings.load();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ThemeController>(
      builder: (context, theme, _) => BillEngineApp(
        routerConfig: _router,
        themeMode: theme.mode,
        onToggleTheme: theme.toggle,
      ),
    );
  }
}
