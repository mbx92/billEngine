import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/app_scaffold.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class AdminDestination {
  const AdminDestination(this.label, this.path, this.icon);

  final String label;
  final String path;
  final IconData icon;
}

const List<AdminDestination> commercialDestinations = <AdminDestination>[
  AdminDestination('Dashboard', '/', Icons.dashboard_outlined),
  AdminDestination('Customers', '/customers', Icons.people_outline),
  AdminDestination('Plans', '/plans', Icons.layers_outlined),
  AdminDestination('Services', '/services', Icons.inventory_2_outlined),
  AdminDestination('Invoices', '/invoices', Icons.description_outlined),
  AdminDestination('Payments', '/payments', Icons.credit_card_outlined),
  AdminDestination('Reports', '/reports', Icons.bar_chart_outlined),
];

const List<AdminDestination> infrastructureDestinations = <AdminDestination>[
  AdminDestination('Applications', '/applications', Icons.apps_outlined),
  AdminDestination('Resources', '/resources', Icons.widgets_outlined),
  AdminDestination('Templates', '/templates', Icons.code_outlined),
  AdminDestination('Deployments', '/deployments', Icons.rocket_launch_outlined),
  AdminDestination('Database', '/database-clusters', Icons.storage_outlined),
  AdminDestination('Backups', '/backups', Icons.archive_outlined),
  AdminDestination('Tunnels', '/tunnels', Icons.route_outlined),
  AdminDestination('Servers', '/servers', Icons.dns_outlined),
  AdminDestination('Activity', '/activity', Icons.timeline_outlined),
];

String adminTitleFor(String location) {
  final path = location.split('?').first;
  for (final destination in <AdminDestination>[
    ...commercialDestinations,
    ...infrastructureDestinations,
  ]) {
    if (destination.path == path) return destination.label;
  }
  if (path.startsWith('/invoices/')) return 'Invoice';
  if (path.startsWith('/users')) return 'Users & access';
  if (path.startsWith('/settings')) return 'Settings';
  return 'Control plane';
}

/// Admin shell: permanent drawer on tablets, modal drawer on phones.
class AdminScaffold extends StatelessWidget {
  const AdminScaffold({
    super.key,
    required this.child,
    this.actions,
    this.floatingAction,
    this.showBack = false,
    this.padded = true,
    this.bottomBar,
  });

  final Widget child;
  final List<Widget>? actions;
  final Widget? floatingAction;
  final bool showBack;
  final bool padded;
  final Widget? bottomBar;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final auth = context.watch<AuthController>();
    final settings = context.watch<SettingsController>();
    final location = GoRouterState.of(context).uri.path;
    final width = MediaQuery.sizeOf(context).width;
    final permanent = width >= 900;

    final drawer = _AdminDrawer(
      currentPath: location,
      isSuperAdmin: auth.user?.isSuperAdmin ?? false,
      companyName: settings.value.companyName,
    );

    return Scaffold(
      backgroundColor: colors.canvas,
      drawer: permanent ? null : drawer,
      appBar: AppBar(
        automaticallyImplyLeading: showBack,
        leading: showBack
            ? null
            : (permanent
                  ? null
                  : Builder(
                      builder: (context) => IconButton(
                        icon: const Icon(Icons.menu, size: 20),
                        onPressed: () => Scaffold.of(context).openDrawer(),
                      ),
                    )),
        title: Row(
          children: [
            if (permanent) ...[
              const _BrandMark(),
              const SizedBox(width: 10),
            ],
            Flexible(
              child: Text(
                adminTitleFor(location),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
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
      body: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (permanent) SizedBox(width: 232, child: drawer),
          if (permanent) VerticalDivider(width: 1, color: colors.line),
          Expanded(
            child: padded
                ? Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 24), child: child)
                : child,
          ),
        ],
      ),
    );
  }
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      width: 28,
      height: 28,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: colors.brand.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.brand.withValues(alpha: 0.32)),
      ),
      child: Text(
        'B_',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: colors.brand,
          fontFamily: 'monospace',
        ),
      ),
    );
  }
}

class _AdminDrawer extends StatelessWidget {
  const _AdminDrawer({
    required this.currentPath,
    required this.isSuperAdmin,
    required this.companyName,
  });

  final String currentPath;
  final bool isSuperAdmin;
  final String companyName;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final auth = context.read<AuthController>();
    final user = auth.user;

    return Drawer(
      backgroundColor: colors.surface,
      width: 232,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: Row(
                children: [
                  const _BrandMark(),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          companyName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                        Text(
                          'CONTROL PLANE',
                          style: TextStyle(
                            fontSize: 9,
                            letterSpacing: 1.1,
                            fontWeight: FontWeight.w600,
                            color: colors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: colors.line),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                children: [
                  _groupLabel(context, 'Commercial'),
                  for (final destination in commercialDestinations)
                    _entry(context, destination, currentPath),
                  _groupLabel(context, 'Infrastructure'),
                  for (final destination in infrastructureDestinations)
                    _entry(context, destination, currentPath),
                  _groupLabel(context, 'System'),
                  _entry(
                    context,
                    const AdminDestination('Settings', '/settings', Icons.settings_outlined),
                    currentPath,
                  ),
                  if (isSuperAdmin)
                    _entry(
                      context,
                      const AdminDestination('Users & access', '/users', Icons.shield_outlined),
                      currentPath,
                    ),
                ],
              ),
            ),
            Divider(height: 1, color: colors.line),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
              child: Column(
                children: [
                  Row(
                    children: [
                      Container(
                        width: 30,
                        height: 30,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: colors.surfaceRaised,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: colors.line),
                        ),
                        child: Text(
                          Fmt.initials(user?.name),
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user?.name ?? 'Pengguna',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: colors.ink,
                              ),
                            ),
                            Text(
                              user?.roleLabel ?? '—',
                              style: TextStyle(fontSize: 10.5, color: colors.muted),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: 'Keluar',
                        onPressed: () => _signOut(context),
                        icon: const Icon(Icons.logout, size: 17),
                      ),
                    ],
                  ),
                  if (user != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Padding(
                        padding: const EdgeInsets.only(left: 39, top: 2),
                        child: Text(
                          user.email,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 10, color: colors.muted),
                        ),
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

  Future<void> _signOut(BuildContext context) async {
    final confirmed = await confirmAction(
      context,
      title: 'Keluar dari aplikasi?',
      message: 'Sesi akan diakhiri dan Anda harus masuk kembali.',
      confirmLabel: 'Keluar',
      destructive: true,
    );
    if (!confirmed || !context.mounted) return;
    await context.read<AuthController>().signOut();
    if (context.mounted) context.go('/login');
  }

  Widget _groupLabel(BuildContext context, String text) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 6),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 9.5,
          letterSpacing: 1.2,
          fontWeight: FontWeight.w700,
          color: colors.muted,
        ),
      ),
    );
  }

  Widget _entry(BuildContext context, AdminDestination destination, String current) {
    final colors = context.colors;
    final active = current == destination.path ||
        (destination.path != '/' && current.startsWith('${destination.path}/'));
    return Padding(
      padding: const EdgeInsets.only(bottom: 1),
      child: Material(
        color: active ? colors.surfaceRaised : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () {
            if (context.canPop() && Scaffold.maybeOf(context)?.hasDrawer == true) {
              Navigator.of(context).pop();
            }
            if (current != destination.path) context.go(destination.path);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
            child: Row(
              children: [
                Icon(
                  destination.icon,
                  size: 16,
                  color: active ? colors.brand : colors.muted,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    destination.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                      color: active ? colors.ink : colors.muted,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Customer portal shell with a bottom navigation bar.
class PortalScaffold extends StatelessWidget {
  const PortalScaffold({
    super.key,
    required this.title,
    required this.index,
    required this.child,
    this.actions,
    this.showBack = false,
    this.floatingAction,
    this.onRefresh,
  });

  final String title;
  final int index;
  final Widget child;
  final List<Widget>? actions;
  final bool showBack;
  final Widget? floatingAction;
  final Future<void> Function()? onRefresh;

  static const List<String> paths = <String>[
    '/portal',
    '/portal/invoices',
    '/portal/services',
    '/portal/account',
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final body = Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
      child: child,
    );

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
      ),
      floatingActionButton: floatingAction,
      body: onRefresh == null ? body : RefreshIndicator(onRefresh: onRefresh!, child: body),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        height: 62,
        onDestinationSelected: (value) {
          if (value == index) return;
          context.go(paths[value]);
        },
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined, size: 20),
            selectedIcon: Icon(Icons.dashboard, size: 20),
            label: 'Ringkasan',
          ),
          NavigationDestination(
            icon: Icon(Icons.description_outlined, size: 20),
            selectedIcon: Icon(Icons.description, size: 20),
            label: 'Invoice',
          ),
          NavigationDestination(
            icon: Icon(Icons.inventory_2_outlined, size: 20),
            selectedIcon: Icon(Icons.inventory_2, size: 20),
            label: 'Layanan',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline, size: 20),
            selectedIcon: Icon(Icons.person, size: 20),
            label: 'Akun',
          ),
        ],
      ),
    );
  }
}
