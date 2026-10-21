import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/customer.dart';
import 'package:billengine_mobile/models/user.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  late final ItemController<List<AppUser>> _users;
  late final ItemController<List<Customer>> _customers;
  final _action = ActionController();

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _users = ItemController<List<AppUser>>(fetch: api.users);
    _customers = ItemController<List<Customer>>(
      fetch: () async {
        final result = await api.customers(page: 1, perPage: 100);
        return result.rows;
      },
    );
    _users.load();
    _customers.load();
  }

  @override
  void dispose() {
    _users.dispose();
    _customers.dispose();
    _action.dispose();
    super.dispose();
  }

  List<Customer> get _activeCustomers => (_customers.value ?? const <Customer>[])
      .where((customer) => customer.status == 'active')
      .toList(growable: false);

  Future<void> _create() async {
    if (_activeCustomers.isEmpty) {
      showAppSnack(context, 'Belum ada customer aktif untuk ditautkan.', error: true);
      return;
    }

    final values = await showRecordForm(
      context,
      title: 'Tambah user',
      description: 'Password awal minimal 12 karakter.',
      submitLabel: 'Buat user',
      fields: [
        FieldSpec.text('name', 'Nama', required: true),
        FieldSpec.email('email', 'Email', required: true),
        FieldSpec.password('password', 'Password awal', required: true),
        FieldSpec.select(
          'role',
          'Role',
          options: const {'customer': 'Customer', 'admin': 'Admin'},
          initial: 'customer',
          required: true,
        ),
        FieldSpec.select(
          'customerId',
          'Customer',
          options: {
            for (final customer in _activeCustomers)
              customer.id:
                  '${customer.companyName ?? customer.name} · ${customer.customerNumber}',
          },
          hint: 'Wajib untuk role customer',
        ),
      ],
    );
    if (values == null || !mounted) return;

    final role = values['role']?.toString() ?? 'customer';
    final ok = await _action.run(
      () => context.read<ApiService>().createUser(<String, dynamic>{
        'name': values['name'],
        'email': values['email'],
        'password': values['password'],
        'role': role,
        'customerId': role == 'customer' ? values['customerId'] : null,
      }),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Akun ${values['email']} dibuat.');
      await _users.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Gagal membuat user.', error: true);
    }
  }

  Future<void> _editAccess(AppUser user) async {
    final customers = _activeCustomers;
    final values = await showRecordForm(
      context,
      title: 'Akses ${user.email}',
      description: 'Perubahan role mencabut seluruh sesi user tersebut.',
      submitLabel: 'Simpan akses',
      fields: [
        FieldSpec.select(
          'role',
          'Role',
          options: const {
            'super_admin': 'Super admin',
            'admin': 'Admin',
            'customer': 'Customer',
          },
          initial: user.role,
          required: true,
        ),
        if (customers.isNotEmpty)
          FieldSpec.select(
            'customerId',
            'Customer',
            options: {
              for (final customer in customers)
                customer.id:
                    '${customer.companyName ?? customer.name} · ${customer.customerNumber}',
            },
            initial: user.customerId,
          ),
      ],
    );
    if (values == null || !mounted) return;

    final role = values['role']?.toString() ?? user.role;
    final ok = await _action.run(
      () => context.read<ApiService>().updateUserAccess(user.id, <String, dynamic>{
        'role': role,
        'customerId': role == 'customer' ? values['customerId'] : null,
      }),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Akses ${user.email} diperbarui.');
      await _users.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Gagal memperbarui akses.', error: true);
    }
  }

  Future<void> _resetPassword(AppUser user) async {
    final values = await showRecordForm(
      context,
      title: 'Ubah password',
      description:
          'Password baru untuk ${user.email}. Semua sesi user ini akan dicabut setelah perubahan.',
      submitLabel: 'Simpan password',
      fields: [
        FieldSpec.password('password', 'Password baru', required: true),
        FieldSpec.password('confirmPassword', 'Konfirmasi password', required: true),
      ],
    );
    if (values == null || !mounted) return;

    final password = values['password']?.toString() ?? '';
    if (password != values['confirmPassword']) {
      showAppSnack(context, 'Konfirmasi password tidak sama.', error: true);
      return;
    }
    if (password.length < 12) {
      showAppSnack(context, 'Password minimal 12 karakter.', error: true);
      return;
    }

    final ok = await _action.run(
      () => context.read<ApiService>().updateUserPassword(user.id, password),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Password ${user.email} diperbarui.');
    } else {
      showAppSnack(context, _action.error ?? 'Gagal memperbarui password.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      floatingAction: FloatingActionButton.extended(
        onPressed: _action.isPending ? null : _create,
        icon: const Icon(Icons.person_add_alt, size: 18),
        label: const Text('User'),
      ),
      child: ChangeNotifierProvider<ItemController<List<AppUser>>>.value(
        value: _users,
        child: Consumer<ItemController<List<AppUser>>>(
          builder: (context, controller, _) {
            final users = controller.value ?? const <AppUser>[];
            final admins = users.where((user) => user.isAdmin).length;

            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Security / access',
                  title: 'Users & access',
                  subtitle: 'Kelola akun admin dan akun portal customer.',
                  trailing: StatusPill(
                    label: '${users.length} user',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: StatTile(
                        label: 'Admin',
                        value: '$admins',
                        detail: 'akses control plane',
                        tone: 'info',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: StatTile(
                        label: 'Portal',
                        value: '${users.length - admins}',
                        detail: 'akun customer',
                        tone: 'success',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 4, height: 76)
                else if (controller.error != null && users.isEmpty)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else if (users.isEmpty)
                  const AppCard(
                    child: EmptyState(
                      title: 'Belum ada user',
                      description: 'Tambahkan akun admin atau akun portal customer.',
                      icon: Icons.shield_outlined,
                    ),
                  )
                else
                  for (final user in users) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
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
                              Container(
                                width: 32,
                                height: 32,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: colors.surfaceRaised,
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(color: colors.line),
                                ),
                                child: Text(
                                  Fmt.initials(user.name),
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w600,
                                    color: colors.ink,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      user.name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                        color: colors.ink,
                                      ),
                                    ),
                                    Text(
                                      user.email,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(fontSize: 11, color: colors.muted),
                                    ),
                                  ],
                                ),
                              ),
                              StatusPill(
                                label: user.roleLabel,
                                tone: user.isSuperAdmin
                                    ? 'warning'
                                    : user.isAdmin
                                    ? 'info'
                                    : 'muted',
                                dense: true,
                              ),
                            ],
                          ),
                          const SizedBox(height: 7),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              if (user.customerName != null)
                                StatusPill(
                                  label: user.customerName!,
                                  tone: 'muted',
                                  dense: true,
                                ),
                              if (user.createdAt != null)
                                StatusPill(
                                  label: 'dibuat ${Fmt.date(user.createdAt!.toIso8601String())}',
                                  tone: 'muted',
                                  dense: true,
                                ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            alignment: WrapAlignment.end,
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              TextButton.icon(
                                onPressed: _action.isPending ? null : () => _resetPassword(user),
                                icon: const Icon(Icons.key_outlined, size: 14),
                                label: const Text('Password', style: TextStyle(fontSize: 12)),
                              ),
                              OutlinedButton.icon(
                                onPressed: _action.isPending ? null : () => _editAccess(user),
                                icon: const Icon(Icons.save_outlined, size: 14),
                                label: const Text('Akses', style: TextStyle(fontSize: 12)),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}
