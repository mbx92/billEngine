import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/services/file_saver.dart';

/// Loads one invoice and exposes the PDF download action. Used by both the
/// admin detail screen and the customer portal.
class InvoiceDetailController extends ItemController<InvoiceDetail> {
  InvoiceDetailController({
    required ApiService api,
    required String invoiceId,
    this.portal = false,
  }) : _api = api,
       _invoiceId = invoiceId,
       super(fetch: () => portal ? api.portalInvoice(invoiceId) : api.invoice(invoiceId));

  final ApiService _api;
  final String _invoiceId;
  final bool portal;

  String get invoiceId => _invoiceId;

  InvoiceDetail? get detail => value;

  InvoiceSummary? get invoice => value?.invoice;

  bool get canEdit =>
      invoice != null &&
      <String>['draft', 'unpaid', 'overdue'].contains(invoice!.status) &&
      invoice!.amountPaid == '0' &&
      value!.payments.isEmpty &&
      value!.creditNotes.isEmpty;

  bool get canCancel =>
      invoice != null &&
      <String>['draft', 'unpaid', 'overdue'].contains(invoice!.status) &&
      invoice!.amountPaid == '0';

  bool get canRecordPayment {
    final status = invoice?.status;
    return status == 'unpaid' || status == 'overdue';
  }

  bool get canIssueCredit => canRecordPayment && invoice!.balanceDue != '0';

  bool get canDelete => invoice?.status == 'cancelled';

  /// Downloads the server-rendered PDF and hands it to the platform viewer.
  Future<({bool ok, String? message})> downloadPdf() async {
    try {
      final download = await _api.invoicePdf(_invoiceId, portal: portal);
      final saved = await const FileSaver().saveAndOpen(
        download,
        '${invoice?.invoiceNumber ?? 'invoice'}.pdf',
      );
      return (ok: true, message: saved.result.message.isEmpty ? null : saved.result.message);
    } catch (error) {
      return (ok: false, message: '$error');
    }
  }
}
