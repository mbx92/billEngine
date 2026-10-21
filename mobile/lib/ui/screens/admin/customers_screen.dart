import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/customer.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class CustomersScreen extends StatefulWidget {
  const CustomersScreen({super.key});

  @override
  State<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends State<CustomersScreen> {
  late final ListController<Customer> _list;
  final _action = ActionController();
  String _search = '';

  @override
  void initState() {
    super.initState();
    final api = context.read<ApiService>();
    _list = ListController<Customer>(
      fetch: (page, perPage) async {
        final result = await api.customers(page: page, perPage: perPage);
        return (rows: result.rows, meta: result.meta);
      },
    );
    _list.load();
  }

  @override
  void dispose() {
    _list.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final values = await showRecordForm(
      context,
      title: 'Tambah customer',
      description: 'Simpan identitas dan alamat billing customer baru.',
      submitLabel: 'Simpan customer',
      fields: [
        FieldSpec.text('name', 'Nama customer', required: true),
        FieldSpec.text('companyName', 'Perusahaan'),
        FieldSpec.email('email', 'Email billing', required: true),
        FieldSpec.text('phone', 'Telepon', keyboardType: TextInputType.phone),
        FieldSpec.multiline('addressLine1', 'Alamat'),
        FieldSpec.text('addressLine2', 'Alamat lanjutan'),
        FieldSpec.text('city', 'Kota'),
        FieldSpec.text('province', 'Provinsi'),
        FieldSpec.text('postalCode', 'Kode pos'),
        FieldSpec.text('countryCode', 'Kode negara', initial: 'ID', required: true),
        FieldSpec.text('taxId', 'NPWP / Tax ID'),
        FieldSpec.multiline('notes', 'Catatan'),
      ],
    );
    if (values == null || !mounted) return;

    final ok = await _action.run(() async {
      await context.read<ApiService>().createCustomer(values);
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Customer ${values['name']} berhasil ditambahkan.');
      await _list.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Gagal menambahkan customer.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final rows = _list.rows;
    final visible = _search.isEmpty
        ? rows
        : rows.where((customer) {
            final query = _search.toLowerCase();
            return customer.displayName.toLowerCase().contains(query) ||
                customer.customerNumber.toLowerCase().contains(query) ||
                customer.email.toLowerCase().contains(query);
          }).toList(growable: false);

    return AdminScaffold(
      floatingAction: FloatingActionButton.extended(
        onPressed: _action.isPending ? null : _add,
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Customer'),
      ),
      child: ChangeNotifierProvider<ListController<Customer>>.value(
        value: _list,
        child: Consumer<ListController<Customer>>(
          builder: (context, controller, _) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SectionHeader(
                  eyebrow: 'Commercial',
                  title: 'Customers',
                  subtitle: 'Customer identity, ownership, billing address, dan status komersial.',
                  trailing: StatusPill(
                    label: '${controller.meta.total} total',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  onChanged: (value) => setState(() => _search = value.trim()),
                  decoration: const InputDecoration(
                    hintText: 'Cari nama, nomor, atau email…',
                    prefixIcon: Icon(Icons.search, size: 18),
                  ),
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: controller.refresh,
                    child: visible.isEmpty && _search.isNotEmpty
                        ? ListView(
                            children: [
                              EmptyState(
                                title: 'Customer tidak ditemukan',
                                description: 'Tidak ada customer yang cocok dengan pencarian.',
                                icon: Icons.search_off,
                              ),
                            ],
                          )
                        : ListView.separated(
                            itemCount: visible.length + (controller.hasMore ? 1 : 0),
                            separatorBuilder: (_, _) => const SizedBox(height: 8),
                            itemBuilder: (context, index) {
                              if (index >= visible.length) {
                                controller.loadMore();
                                return const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 14),
                                  child: Center(
                                    child: SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  ),
                                );
                              }
                              final customer = visible[index];
                              return AppSurface(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                customer.displayName,
                                                style: TextStyle(
                                                  fontSize: 13.5,
                                                  fontWeight: FontWeight.w600,
                                                  color: colors.ink,
                                                ),
                                              ),
                                              const SizedBox(height: 2),
                                              Text(
                                                customer.customerNumber,
                                                style: TextStyle(
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w600,
                                                  fontFamily: 'monospace',
                                                  color: colors.brand,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        StatusPill.status(customer.status, dense: true),
                                      ],
                                    ),
                                    const SizedBox(height: 8),
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            customer.email,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(fontSize: 11.5, color: colors.muted),
                                          ),
                                        ),
                                        Text(
                                          '${customer.activeServiceCount}/${customer.totalServiceCount} service',
                                          style: TextStyle(
                                            fontSize: 11,
                                            color: customer.activeServiceCount > 0
                                                ? colors.ink
                                                : colors.muted,
                                          ),
                                        ),
                                      ],
                                    ),
                                    if (customer.city != null || customer.phone != null)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 4),
                                        child: Text(
                                          [
                                            customer.city,
                                            customer.phone,
                                          ].whereType<String>().join(' · '),
                                          style: TextStyle(fontSize: 11, color: colors.muted),
                                        ),
                                      ),
                                  ],
                                ),
                              );
                            },
                          ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
