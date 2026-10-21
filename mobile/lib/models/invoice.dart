import 'package:billengine_mobile/models/json.dart';

class InvoiceItem {
  const InvoiceItem({
    required this.id,
    required this.description,
    required this.quantity,
    required this.unitPriceAmount,
    required this.subtotalAmount,
    required this.taxAmount,
    required this.totalAmount,
    this.serviceId,
    this.taxRate,
    this.servicePeriodStart,
    this.servicePeriodEnd,
  });

  final String id;
  final String? serviceId;
  final String description;
  final String quantity;
  final String unitPriceAmount;
  final String subtotalAmount;
  final String? taxRate;
  final String taxAmount;
  final String totalAmount;
  final String? servicePeriodStart;
  final String? servicePeriodEnd;

  factory InvoiceItem.fromJson(Json json) {
    return InvoiceItem(
      id: asStringOr(json['id'], ''),
      serviceId: asString(json['serviceId']),
      description: asStringOr(json['description'], ''),
      quantity: asStringOr(json['quantity'], '1'),
      unitPriceAmount: asStringOr(json['unitPriceAmount'], '0'),
      subtotalAmount: asStringOr(json['subtotalAmount'], '0'),
      taxRate: asString(json['taxRate']),
      taxAmount: asStringOr(json['taxAmount'], '0'),
      totalAmount: asStringOr(json['totalAmount'], '0'),
      servicePeriodStart: asString(json['servicePeriodStart']),
      servicePeriodEnd: asString(json['servicePeriodEnd']),
    );
  }
}

class Payment {
  const Payment({
    required this.id,
    required this.paymentNumber,
    required this.status,
    required this.amount,
    required this.currency,
    required this.method,
    required this.paidAt,
    this.reference,
    this.notes,
    this.recordedByName,
  });

  final String id;
  final String paymentNumber;
  final String status;
  final String amount;
  final String currency;
  final String method;
  final String? reference;
  final String? notes;
  final String paidAt;
  final String? recordedByName;

  factory Payment.fromJson(Json json) {
    return Payment(
      id: asStringOr(json['id'], ''),
      paymentNumber: asStringOr(json['paymentNumber'], ''),
      status: asStringOr(json['status'], 'completed'),
      amount: asStringOr(json['amount'], '0'),
      currency: asStringOr(json['currency'], 'IDR'),
      method: asStringOr(json['method'], ''),
      reference: asString(json['reference']),
      notes: asString(json['notes']),
      paidAt: asStringOr(json['paidAt'], ''),
      recordedByName: asString(json['recordedByName']),
    );
  }
}

class CreditNote {
  const CreditNote({
    required this.id,
    required this.creditNoteNumber,
    required this.status,
    required this.amount,
    required this.reason,
    required this.issuedAt,
  });

  final String id;
  final String creditNoteNumber;
  final String status;
  final String amount;
  final String reason;
  final String issuedAt;

  factory CreditNote.fromJson(Json json) {
    return CreditNote(
      id: asStringOr(json['id'], ''),
      creditNoteNumber: asStringOr(json['creditNoteNumber'], ''),
      status: asStringOr(json['status'], 'issued'),
      amount: asStringOr(json['amount'], '0'),
      reason: asStringOr(json['reason'], ''),
      issuedAt: asStringOr(json['issuedAt'], ''),
    );
  }
}

/// Mirrors `ApiInvoiceListItem` — used by both the admin list and the portal.
class InvoiceSummary {
  const InvoiceSummary({
    required this.id,
    required this.invoiceNumber,
    required this.status,
    required this.currency,
    required this.issueDate,
    required this.dueDate,
    required this.totalAmount,
    required this.amountPaid,
    required this.balanceDue,
    required this.customerId,
    required this.customerName,
    this.customerCompanyName,
    this.daysPastDue = 0,
  });

  final String id;
  final String invoiceNumber;
  final String status;
  final String currency;
  final String issueDate;
  final String dueDate;
  final String totalAmount;
  final String amountPaid;
  final String balanceDue;
  final String customerId;
  final String customerName;
  final String? customerCompanyName;
  final int daysPastDue;

  bool get isOpen => status == 'unpaid' || status == 'overdue';

  bool get isPaid => status == 'paid';

  String get customerDisplayName =>
      (customerCompanyName?.trim().isNotEmpty ?? false) ? customerCompanyName! : customerName;

  factory InvoiceSummary.fromJson(Json json) {
    return InvoiceSummary(
      id: asStringOr(json['id'], ''),
      invoiceNumber: asStringOr(json['invoiceNumber'], ''),
      status: asStringOr(json['status'], 'draft'),
      currency: asStringOr(json['currency'], 'IDR'),
      issueDate: asStringOr(json['issueDate'], ''),
      dueDate: asStringOr(json['dueDate'], ''),
      totalAmount: asStringOr(json['totalAmount'], '0'),
      amountPaid: asStringOr(json['amountPaid'], '0'),
      balanceDue: asStringOr(json['balanceDue'], '0'),
      customerId: asStringOr(json['customerId'], ''),
      customerName: asStringOr(json['customerName'], ''),
      customerCompanyName: asString(json['customerCompanyName']),
      daysPastDue: asIntOr(json['daysPastDue'], 0),
    );
  }
}

class InvoiceDetail {
  const InvoiceDetail({
    required this.invoice,
    required this.items,
    required this.payments,
    required this.creditNotes,
    this.subtotalAmount = '0',
    this.discountAmount = '0',
    this.taxAmount = '0',
    this.creditedAmount = '0',
    this.discountPercent,
    this.notes,
    this.issuedAt,
    this.paidAt,
    this.cancelledAt,
    this.customerEmail,
    this.customerPhone,
    this.customerAddress,
    this.customerTaxId,
    this.sellerName = '',
    this.sellerAddress,
    this.sellerEmail,
    this.sellerTaxId,
  });

  final InvoiceSummary invoice;
  final List<InvoiceItem> items;
  final List<Payment> payments;
  final List<CreditNote> creditNotes;
  final String subtotalAmount;
  final String discountAmount;
  final String? discountPercent;
  final String taxAmount;
  final String creditedAmount;
  final String? notes;
  final String? issuedAt;
  final String? paidAt;
  final String? cancelledAt;
  final String? customerEmail;
  final String? customerPhone;
  final String? customerAddress;
  final String? customerTaxId;
  final String sellerName;
  final String? sellerAddress;
  final String? sellerEmail;
  final String? sellerTaxId;

  factory InvoiceDetail.fromJson(Json json) {
    final invoice = asMap(json['invoice']) ?? const <String, dynamic>{};
    return InvoiceDetail(
      invoice: InvoiceSummary.fromJson(invoice),
      items: asMapList(json['items']).map(InvoiceItem.fromJson).toList(),
      payments: asMapList(json['payments']).map(Payment.fromJson).toList(),
      creditNotes: asMapList(json['creditNotes']).map(CreditNote.fromJson).toList(),
      subtotalAmount: asStringOr(invoice['subtotalAmount'], '0'),
      discountAmount: asStringOr(invoice['discountAmount'], '0'),
      discountPercent: asString(invoice['discountPercent']),
      taxAmount: asStringOr(invoice['taxAmount'], '0'),
      creditedAmount: asStringOr(invoice['creditedAmount'], '0'),
      notes: asString(invoice['notes']),
      issuedAt: asString(invoice['issuedAt']),
      paidAt: asString(invoice['paidAt']),
      cancelledAt: asString(invoice['cancelledAt']),
      customerEmail: asString(invoice['customerEmail']),
      customerPhone: asString(invoice['customerPhone']),
      customerAddress: asString(invoice['customerAddress']),
      customerTaxId: asString(invoice['customerTaxId']),
      sellerName: asStringOr(invoice['sellerName'], ''),
      sellerAddress: asString(invoice['sellerAddress']),
      sellerEmail: asString(invoice['sellerEmail']),
      sellerTaxId: asString(invoice['sellerTaxId']),
    );
  }
}

class InvoiceStatusCounts {
  const InvoiceStatusCounts({required this.counts, required this.balances});

  final Map<String, int> counts;
  final List<({String currency, String balance})> balances;

  int countFor(String status) => counts[status] ?? 0;

  int get total => counts.values.fold(0, (sum, value) => sum + value);

  static const InvoiceStatusCounts empty = InvoiceStatusCounts(
    counts: <String, int>{},
    balances: <({String currency, String balance})>[],
  );

  factory InvoiceStatusCounts.from(Object? response) {
    final summary = asMap(asMap(response)?['summary']);
    if (summary == null) return empty;
    final counts = asMap(summary['counts']) ?? const <String, dynamic>{};
    return InvoiceStatusCounts(
      counts: counts.map((key, value) => MapEntry(key, asIntOr(value, 0))),
      balances: asMapList(summary['currencies'])
          .map((row) => (currency: asStringOr(row['currency'], 'IDR'), balance: asStringOr(row['balance'], '0')))
          .toList(),
    );
  }
}

class PaymentListEntry {
  const PaymentListEntry({
    required this.id,
    required this.invoiceId,
    required this.paymentNumber,
    required this.status,
    required this.amount,
    required this.currency,
    required this.method,
    required this.paidAt,
    required this.invoiceNumber,
    required this.customerName,
    this.customerCompanyName,
    this.reference,
    this.notes,
    this.recordedByName,
  });

  final String id;
  final String invoiceId;
  final String paymentNumber;
  final String status;
  final String amount;
  final String currency;
  final String method;
  final String paidAt;
  final String invoiceNumber;
  final String customerName;
  final String? customerCompanyName;
  final String? reference;
  final String? notes;
  final String? recordedByName;

  factory PaymentListEntry.fromJson(Json json) {
    return PaymentListEntry(
      id: asStringOr(json['id'], ''),
      invoiceId: asStringOr(json['invoiceId'], ''),
      paymentNumber: asStringOr(json['paymentNumber'], ''),
      status: asStringOr(json['status'], 'completed'),
      amount: asStringOr(json['amount'], '0'),
      currency: asStringOr(json['currency'], 'IDR'),
      method: asStringOr(json['method'], ''),
      paidAt: asStringOr(json['paidAt'], ''),
      invoiceNumber: asStringOr(json['invoiceNumber'], ''),
      customerName: asStringOr(json['customerName'], ''),
      customerCompanyName: asString(json['customerCompanyName']),
      reference: asString(json['reference']),
      notes: asString(json['notes']),
      recordedByName: asString(json['recordedByName']),
    );
  }
}

class PaymentInvoiceOption {
  const PaymentInvoiceOption({
    required this.id,
    required this.invoiceNumber,
    required this.status,
    required this.currency,
    required this.balanceDue,
    required this.dueDate,
    required this.customerName,
    this.customerCompanyName,
  });

  final String id;
  final String invoiceNumber;
  final String status;
  final String currency;
  final String balanceDue;
  final String dueDate;
  final String customerName;
  final String? customerCompanyName;

  String get customerDisplayName =>
      (customerCompanyName?.trim().isNotEmpty ?? false) ? customerCompanyName! : customerName;

  factory PaymentInvoiceOption.fromJson(Json json) {
    return PaymentInvoiceOption(
      id: asStringOr(json['id'], ''),
      invoiceNumber: asStringOr(json['invoiceNumber'], ''),
      status: asStringOr(json['status'], 'unpaid'),
      currency: asStringOr(json['currency'], 'IDR'),
      balanceDue: asStringOr(json['balanceDue'], '0'),
      dueDate: asStringOr(json['dueDate'], ''),
      customerName: asStringOr(json['customerName'], ''),
      customerCompanyName: asString(json['customerCompanyName']),
    );
  }
}
