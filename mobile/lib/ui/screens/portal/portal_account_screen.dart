import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/state/auth_controller.dart';
import 'package:billengine_mobile/state/portal_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

class PortalAccountScreen extends StatelessWidget {
  const PortalAccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<PortalController>();
    return PortalScaffold(
      title: 'Akun',
      index: 3,
      onRefresh: controller.refresh,
      child: _body(context, controller),
    );
  }

  Widget _body(BuildContext context, PortalController controller) {
    final colors = context.colors;
    final summary = controller.value;
    final user = context.watch<AuthController>().user;

    if (controller.isLoading && summary == null) {
      return const LoadingList(count: 2, height: 130);
    }
    if (summary == null) {
      return ErrorState(
        message: controller.error ?? 'Akun ini belum terhubung ke customer.',
        onRetry: controller.refresh,
      );
    }

    final customer = summary.customer;
    final active = customer.status == 'active';

    return ListView(
      children: [
        SectionHeader(
          eyebrow: 'Customer portal',
          title: 'Akun billing',
          subtitle: 'Data yang tercatat pada invoice Anda. Hubungi admin jika ada yang perlu diubah.',
        ),
        const SizedBox(height: 16),
        Container(
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: colors.line),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            customer.customerNumber,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              fontFamily: 'monospace',
                              color: colors.brand,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            customer.displayName,
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                              color: colors.ink,
                            ),
                          ),
                          if (customer.companyName?.trim().isNotEmpty ?? false)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(
                                customer.name,
                                style: TextStyle(fontSize: 12.5, color: colors.muted),
                              ),
                            ),
                        ],
                      ),
                    ),
                    StatusPill(
                      label: active ? 'Aktif' : 'Nonaktif',
                      tone: active ? 'success' : 'muted',
                    ),
                  ],
                ),
              ),
              Divider(height: 1, color: colors.line),
              Container(
                color: colors.canvas,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                child: Column(
                  children: [
                    KeyValueRow(label: 'Email', value: customer.email, wrap: true),
                    KeyValueRow(label: 'Telepon', value: customer.phone ?? '—'),
                    KeyValueRow(label: 'Alamat', value: customer.address ?? '—', wrap: true),
                    KeyValueRow(label: 'NPWP / Tax ID', value: customer.taxId ?? '—', mono: true),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Text(
            'Perubahan nama, alamat, atau NPWP memengaruhi invoice berikutnya. '
            'Invoice yang sudah terbit tetap memakai snapshot saat diterbitkan.',
            style: TextStyle(fontSize: 11.5, height: 1.5, color: colors.muted),
          ),
        ),
        if (user != null) ...[
          const SizedBox(height: 12),
          AppCard(
            title: 'Sesi login',
            subtitle: 'Akun Better Auth yang sedang aktif',
            child: Column(
              children: [
                KeyValueRow(label: 'Nama', value: user.name),
                KeyValueRow(label: 'Email', value: user.email),
                KeyValueRow(label: 'Peran', value: user.roleLabel),
                if (user.createdAt != null)
                  KeyValueRow(label: 'Dibuat', value: Fmt.dateTime(user.createdAt!.toIso8601String())),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: () => _signOut(context),
          style: OutlinedButton.styleFrom(
            foregroundColor: colors.danger,
            side: BorderSide(color: colors.danger.withValues(alpha: 0.4)),
          ),
          icon: const Icon(Icons.logout, size: 16),
          label: const Text('Keluar'),
        ),
      ],
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
}
