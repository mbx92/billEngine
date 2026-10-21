import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/platform.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class TunnelsScreen extends StatefulWidget {
  const TunnelsScreen({super.key});

  @override
  State<TunnelsScreen> createState() => _TunnelsScreenState();
}

class _TunnelsScreenState extends State<TunnelsScreen> {
  late final ItemController<TunnelOverview> _overview;
  final _action = ActionController();

  @override
  void initState() {
    super.initState();
    _overview = ItemController<TunnelOverview>(fetch: context.read<ApiService>().tunnels);
    _overview.load();
  }

  @override
  void dispose() {
    _overview.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _manage(CloudflareTunnel tunnel) async {
    TunnelDetail detail;
    try {
      detail = await context.read<ApiService>().tunnel(tunnel.id);
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
      return;
    }
    if (!mounted) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _TunnelSheet(
        detail: detail,
        onChanged: () async {
          await _overview.refresh();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<TunnelOverview>>.value(
        value: _overview,
        child: Consumer<ItemController<TunnelOverview>>(
          builder: (context, controller, _) {
            final overview = controller.value ?? TunnelOverview.notConfigured;

            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Infrastructure',
                  title: 'Cloudflare tunnels',
                  subtitle:
                      'Rute hostname ke service origin. Perubahan konfigurasi dikirim ke Cloudflare '
                      'dan langsung dipakai tunnel.',
                  trailing: StatusPill(
                    label: '${overview.tunnels.length} tunnel',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 14),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 3, height: 110)
                else if (controller.error != null)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else if (!overview.configured)
                  const AppCard(
                    child: EmptyState(
                      title: 'Cloudflare belum dikonfigurasi',
                      description:
                          'Tambahkan CLOUDFLARE_API_TOKEN dan account ID pada environment server '
                          'untuk mengelola tunnel dari aplikasi.',
                      icon: Icons.route_outlined,
                    ),
                  )
                else if (overview.tunnels.isEmpty)
                  const AppCard(
                    child: EmptyState(
                      title: 'Tidak ada tunnel',
                      description: 'Cloudflare account belum memiliki tunnel aktif.',
                      icon: Icons.route_outlined,
                    ),
                  )
                else
                  for (final tunnel in overview.tunnels) ...[
                    Container(
                      padding: const EdgeInsets.all(13),
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
                                      tunnel.name,
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                        color: colors.ink,
                                      ),
                                    ),
                                    Text(
                                      tunnel.expectedDnsTarget,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 10.5,
                                        fontFamily: 'monospace',
                                        color: colors.muted,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              StatusPill.status(tunnel.status, dense: true),
                            ],
                          ),
                          const SizedBox(height: 7),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              StatusPill(
                                label: 'config ${tunnel.configSource}',
                                tone: 'muted',
                                dense: true,
                              ),
                              if (tunnel.connectionsActiveAt != null)
                                StatusPill(
                                  label: 'koneksi ${Fmt.relativeTime(tunnel.connectionsActiveAt)}',
                                  tone: 'success',
                                  dense: true,
                                )
                              else if (tunnel.connectionsInactiveAt != null)
                                StatusPill(
                                  label:
                                      'offline ${Fmt.relativeTime(tunnel.connectionsInactiveAt)}',
                                  tone: 'warning',
                                  dense: true,
                                ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Align(
                            alignment: Alignment.centerRight,
                            child: OutlinedButton.icon(
                              onPressed: _action.isPending
                                  ? null
                                  : () => _manage(tunnel),
                              icon: const Icon(Icons.alt_route, size: 15),
                              label: const Text('Kelola route'),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 9),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _TunnelSheet extends StatefulWidget {
  const _TunnelSheet({required this.detail, required this.onChanged});

  final TunnelDetail detail;
  final Future<void> Function() onChanged;

  @override
  State<_TunnelSheet> createState() => _TunnelSheetState();
}

class _TunnelSheetState extends State<_TunnelSheet> {
  late TunnelDetail _detail = widget.detail;
  final _action = ActionController();

  @override
  void dispose() {
    _action.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    try {
      final detail = await context.read<ApiService>().tunnel(_detail.tunnel.id);
      if (!mounted) return;
      setState(() => _detail = detail);
      await widget.onChanged();
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
    }
  }

  Future<void> _mutate(Future<void> Function() action, String message) async {
    final ok = await _action.run(action);
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, message);
      await _reload();
    } else {
      showAppSnack(context, _action.error ?? 'Perubahan route gagal disimpan.', error: true);
    }
  }

  Future<void> _addRoute() async {
    final values = await showRecordForm(
      context,
      title: 'Tambah route',
      description: 'Hostname dipetakan ke origin service pada jaringan Cloudflare tunnel.',
      submitLabel: 'Tambah route',
      fields: [
        FieldSpec.text('hostname', 'Hostname', hint: 'app.example.com', required: true),
        FieldSpec.text('path', 'Path', hint: 'Kosongkan untuk semua path'),
        FieldSpec.text(
          'service',
          'Origin service',
          initial: 'https://localhost:443',
          required: true,
        ),
        FieldSpec.text('httpHostHeader', 'HTTP host header'),
        FieldSpec.text('originServerName', 'Origin server name (SNI)'),
        FieldSpec.toggle('noTlsVerify', 'Lewati verifikasi TLS', initial: true),
      ],
    );
    if (values == null || !mounted) return;

    await _mutate(
      () => context.read<ApiService>().addTunnelRoute(_detail.tunnel.id, _routeBody(values)),
      'Route ${values['hostname']} ditambahkan.',
    );
  }

  Future<void> _editRoute(TunnelRoute route) async {
    final values = await showRecordForm(
      context,
      title: 'Ubah route',
      submitLabel: 'Simpan',
      fields: [
        FieldSpec.text('hostname', 'Hostname', initial: route.hostname, required: true),
        FieldSpec.text('path', 'Path', initial: route.path),
        FieldSpec.text('service', 'Origin service', initial: route.service, required: true),
        FieldSpec.text('httpHostHeader', 'HTTP host header', initial: route.httpHostHeader),
        FieldSpec.text('originServerName', 'Origin server name', initial: route.originServerName),
        FieldSpec.toggle('noTlsVerify', 'Lewati verifikasi TLS', initial: route.noTlsVerify),
      ],
    );
    if (values == null || !mounted) return;

    await _mutate(
      () => context.read<ApiService>().updateTunnelRoute(
        _detail.tunnel.id,
        original: _routeBodyFromRoute(route),
        route: _routeBody(values),
      ),
      'Route ${values['hostname']} diperbarui.',
    );
  }

  Future<void> _deleteRoute(TunnelRoute route) async {
    final confirmed = await confirmAction(
      context,
      title: 'Hapus route?',
      message: 'Hostname ${route.hostname ?? 'catch-all'} akan berhenti diarahkan ke tunnel.',
      confirmLabel: 'Hapus',
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    await _mutate(
      () => context.read<ApiService>().deleteTunnelRoute(
        _detail.tunnel.id,
        _routeBodyFromRoute(route),
      ),
      'Route dihapus.',
    );
  }

  static Map<String, dynamic> _routeBody(Map<String, dynamic> values) {
    return <String, dynamic>{
      'hostname': values['hostname'],
      'path': values['path'] ?? '',
      'service': values['service'],
      'noTlsVerify': values['noTlsVerify'] ?? false,
      if (values['httpHostHeader'] != null) 'httpHostHeader': values['httpHostHeader'],
      if (values['originServerName'] != null) 'originServerName': values['originServerName'],
    };
  }

  static Map<String, dynamic> _routeBodyFromRoute(TunnelRoute route) => _routeBody(<String, dynamic>{
    'hostname': route.hostname,
    'path': route.path,
    'service': route.service,
    'noTlsVerify': route.noTlsVerify,
    'httpHostHeader': route.httpHostHeader,
    'originServerName': route.originServerName,
  });

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final routes = _detail.routes;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.92,
      builder: (context, scrollController) {
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 10, 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _detail.tunnel.name,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                        Text(
                          _detail.editable
                              ? 'Konfigurasi dapat diubah dari aplikasi.'
                              : 'Konfigurasi dikelola di luar aplikasi (read-only).',
                          style: TextStyle(fontSize: 11, color: colors.muted),
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
            Expanded(
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 20),
                children: [
                  if (routes.isEmpty)
                    const EmptyState(
                      title: 'Belum ada route',
                      description: 'Tambahkan hostname untuk mengarahkan trafik ke service origin.',
                      icon: Icons.alt_route,
                    )
                  else
                    for (final route in routes) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: colors.canvas,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: colors.line),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${route.hostname ?? 'catch-all'}${route.path ?? ''}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                      fontFamily: 'monospace',
                                      color: colors.ink,
                                    ),
                                  ),
                                ),
                                if (_detail.editable) ...[
                                  IconButton(
                                    visualDensity: VisualDensity.compact,
                                    onPressed: _action.isPending ? null : () => _editRoute(route),
                                    icon: const Icon(Icons.edit_outlined, size: 16),
                                  ),
                                  IconButton(
                                    visualDensity: VisualDensity.compact,
                                    onPressed: _action.isPending ? null : () => _deleteRoute(route),
                                    icon: Icon(Icons.delete_outline, size: 16, color: colors.danger),
                                  ),
                                ],
                              ],
                            ),
                            Text(
                              '→ ${route.service}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                fontFamily: 'monospace',
                                color: colors.brand,
                              ),
                            ),
                            if (route.noTlsVerify || route.originServerName != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 5),
                                child: Wrap(
                                  spacing: 6,
                                  runSpacing: 4,
                                  children: [
                                    if (route.noTlsVerify)
                                      const StatusPill(
                                        label: 'no TLS verify',
                                        tone: 'warning',
                                        dense: true,
                                      ),
                                    if (route.originServerName != null)
                                      StatusPill(
                                        label: 'SNI ${route.originServerName}',
                                        tone: 'muted',
                                        dense: true,
                                      ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                  if (_detail.editable) ...[
                    const SizedBox(height: 6),
                    FilledButton.icon(
                      onPressed: _action.isPending ? null : _addRoute,
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Tambah route'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
