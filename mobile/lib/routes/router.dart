import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/ui/app_scaffold.dart';
import 'package:billengine_mobile/ui/screens/admin/activity_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/admin_dashboard_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/applications_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/backups_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/customers_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/database_clusters_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/deployments_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/invoice_detail_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/invoices_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/payments_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/plans_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/reports_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/resources_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/servers_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/services_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/settings_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/templates_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/tunnels_screen.dart';
import 'package:billengine_mobile/ui/screens/admin/users_screen.dart';
import 'package:billengine_mobile/ui/screens/portal/portal_account_screen.dart';
import 'package:billengine_mobile/ui/screens/portal/portal_invoice_detail_screen.dart';
import 'package:billengine_mobile/ui/screens/portal/portal_invoices_screen.dart';
import 'package:billengine_mobile/ui/screens/portal/portal_overview_screen.dart';
import 'package:billengine_mobile/ui/screens/portal/portal_services_screen.dart';

/// Route table mirroring the web console paths.
///
/// Customers are fenced into `/portal/*` and admins are pushed out of it, so a
/// session can only reach the shell its role allows.
GoRouter buildRouter(AuthController auth) {
  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: auth,
    redirect: (context, state) {
      final location = state.uri.path;
      final onLogin = location == '/login';
      final onSplash = location == '/splash';

      if (auth.status == AuthStatus.unknown) {
        return onSplash ? null : '/splash';
      }

      if (onSplash) {
        if (!auth.isSignedIn) return '/login';
        return auth.isCustomer ? '/portal' : '/';
      }

      if (!auth.isSignedIn) {
        return onLogin ? null : '/login';
      }

      if (onLogin) return auth.isCustomer ? '/portal' : '/';

      if (auth.isCustomer) {
        return location.startsWith('/portal') ? null : '/portal';
      }

      if (location.startsWith('/portal')) return '/';

      if (auth.user?.isSuperAdmin != true && location.startsWith('/users')) {
        return '/';
      }

      return null;
    },
    routes: <RouteBase>[
      GoRoute(path: '/splash', builder: (context, state) => const _SplashScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginPage()),

      // ------------------------------------------------------- commercial --
      GoRoute(path: '/', builder: (context, state) => const AdminDashboardScreen()),
      GoRoute(path: '/customers', builder: (context, state) => const CustomersScreen()),
      GoRoute(path: '/plans', builder: (context, state) => const PlansScreen()),
      GoRoute(path: '/services', builder: (context, state) => const ServicesScreen()),
      GoRoute(path: '/invoices', builder: (context, state) => const InvoicesScreen()),
      GoRoute(
        path: '/invoices/:id',
        builder: (context, state) =>
            AdminInvoiceDetailScreen(invoiceId: state.pathParameters['id'] ?? ''),
      ),
      GoRoute(path: '/payments', builder: (context, state) => const PaymentsScreen()),
      GoRoute(path: '/reports', builder: (context, state) => const ReportsScreen()),

      // --------------------------------------------------- infrastructure --
      GoRoute(path: '/applications', builder: (context, state) => const ApplicationsScreen()),
      GoRoute(path: '/resources', builder: (context, state) => const ResourcesScreen()),
      GoRoute(path: '/templates', builder: (context, state) => const TemplatesScreen()),
      GoRoute(path: '/deployments', builder: (context, state) => const DeploymentsScreen()),
      GoRoute(
        path: '/database-clusters',
        builder: (context, state) => const DatabaseClustersScreen(),
      ),
      GoRoute(path: '/backups', builder: (context, state) => const BackupsScreen()),
      GoRoute(path: '/tunnels', builder: (context, state) => const TunnelsScreen()),
      GoRoute(path: '/servers', builder: (context, state) => const ServersScreen()),
      GoRoute(path: '/activity', builder: (context, state) => const ActivityScreen()),

      // ----------------------------------------------------------- system --
      GoRoute(path: '/users', builder: (context, state) => const UsersScreen()),
      GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen()),

      // ----------------------------------------------------------- portal --
      GoRoute(path: '/portal', builder: (context, state) => const PortalOverviewScreen()),
      GoRoute(
        path: '/portal/invoices',
        builder: (context, state) => const PortalInvoicesScreen(),
      ),
      GoRoute(
        path: '/portal/invoices/:id',
        builder: (context, state) =>
            PortalInvoiceDetailScreen(invoiceId: state.pathParameters['id'] ?? ''),
      ),
      GoRoute(
        path: '/portal/services',
        builder: (context, state) => const PortalServicesScreen(),
      ),
      GoRoute(
        path: '/portal/account',
        builder: (context, state) => const PortalAccountScreen(),
      ),
    ],
    errorBuilder: (context, state) => _NotFoundScreen(location: state.uri.path),
  );
}

/// Shown while `AuthController.bootstrap()` restores the saved session.
class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4)),
      ),
    );
  }
}

class _NotFoundScreen extends StatelessWidget {
  const _NotFoundScreen({required this.location});

  final String location;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tidak ditemukan')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.explore_off_outlined, size: 32),
              const SizedBox(height: 12),
              Text('Path $location tidak tersedia di aplikasi mobile.'),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => context.go('/'),
                child: const Text('Kembali ke dashboard'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
