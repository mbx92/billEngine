import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/state/invoice_controller.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/invoice_body.dart';

/// Read-only invoice view used by the customer portal.
class PortalInvoiceDetailScreen extends StatefulWidget {
  const PortalInvoiceDetailScreen({super.key, required this.invoiceId});

  final String invoiceId;

  @override
  State<PortalInvoiceDetailScreen> createState() => _PortalInvoiceDetailScreenState();
}

class _PortalInvoiceDetailScreenState extends State<PortalInvoiceDetailScreen> {
  late final InvoiceDetailController _controller;
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    _controller = InvoiceDetailController(
      api: context.read<ApiService>(),
      invoiceId: widget.invoiceId,
      portal: true,
    );
    _controller.load();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _download() async {
    setState(() => _downloading = true);
    final result = await _controller.downloadPdf();
    if (!mounted) return;
    setState(() => _downloading = false);
    if (result.message != null) {
      showAppSnack(context, result.message!, error: !result.ok);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<InvoiceDetailController>.value(
      value: _controller,
      child: Consumer<InvoiceDetailController>(
        builder: (context, controller, _) {
          final detail = controller.value;
          return PortalScaffold(
            title: detail?.invoice.invoiceNumber ?? 'Invoice',
            index: 1,
            showBack: true,
            onRefresh: controller.refresh,
            actions: [
              if (detail != null)
                IconButton(
                  tooltip: 'Unduh PDF',
                  onPressed: _downloading ? null : _download,
                  icon: _downloading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.download_outlined, size: 20),
                ),
            ],
            child: _body(context, controller),
          );
        },
      ),
    );
  }

  Widget _body(BuildContext context, InvoiceDetailController controller) {
    final colors = context.colors;
    final detail = controller.value;

    if (controller.isLoading && detail == null) {
      return const LoadingList(count: 4, height: 110);
    }
    if (detail == null) {
      return ErrorState(
        message: controller.error ?? 'Invoice tidak tersedia untuk akun customer ini.',
        onRetry: controller.refresh,
      );
    }

    final invoice = detail.invoice;
    return ListView(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    invoice.invoiceNumber,
                    style: TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.4,
                      fontFamily: 'monospace',
                      color: colors.ink,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'Terbit ${Fmt.date(invoice.issueDate)} · jatuh tempo ${Fmt.date(invoice.dueDate)}',
                    style: TextStyle(fontSize: 12, color: colors.muted),
                  ),
                ],
              ),
            ),
            StatusPill.status(invoice.status),
          ],
        ),
        const SizedBox(height: 16),
        FilledButton.icon(
          onPressed: _downloading ? null : _download,
          icon: _downloading
              ? const SizedBox(width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.download_outlined, size: 17),
          label: Text(_downloading ? 'Mengunduh…' : 'Unduh PDF'),
        ),
        const SizedBox(height: 16),
        InvoiceBody(detail: detail),
      ],
    );
  }
}
