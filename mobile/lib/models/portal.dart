import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/models/json.dart';
import 'package:billengine_mobile/models/service.dart';

/// Mirrors `ApiPortalSummary`.
class PortalSummary {
  const PortalSummary({
    required this.customer,
    required this.services,
    required this.invoices,
    required this.openBalance,
  });

  final PortalCustomer customer;
  final List<Service> services;
  final List<InvoiceSummary> invoices;
  final List<({String currency, String amount})> openBalance;

  List<InvoiceSummary> get openInvoices =>
      invoices.where((invoice) => invoice.isOpen).toList(growable: false);

  List<InvoiceSummary> get overdueInvoices =>
      invoices.where((invoice) => invoice.status == 'overdue').toList(growable: false);

  List<Service> get activeServices =>
      services.where((service) => service.isActive).toList(growable: false);

  factory PortalSummary.fromJson(Json json) {
    return PortalSummary(
      customer: PortalCustomer.fromJson(asMap(json['customer']) ?? const <String, dynamic>{}),
      services: asMapList(json['services']).map(Service.fromJson).toList(),
      invoices: asMapList(json['invoices']).map(InvoiceSummary.fromJson).toList(),
      openBalance: asMapList(json['openBalance'])
          .map(
            (row) => (
              currency: asStringOr(row['currency'], 'IDR'),
              amount: asStringOr(row['amount'], '0'),
            ),
          )
          .toList(),
    );
  }
}

class PortalCustomer {
  const PortalCustomer({
    required this.id,
    required this.customerNumber,
    required this.name,
    required this.email,
    required this.status,
    this.companyName,
    this.phone,
    this.address,
    this.taxId,
  });

  final String id;
  final String customerNumber;
  final String name;
  final String? companyName;
  final String email;
  final String? phone;
  final String? address;
  final String? taxId;
  final String status;

  String get displayName => (companyName?.trim().isNotEmpty ?? false) ? companyName! : name;

  factory PortalCustomer.fromJson(Json json) {
    return PortalCustomer(
      id: asStringOr(json['id'], ''),
      customerNumber: asStringOr(json['customerNumber'], ''),
      name: asStringOr(json['name'], ''),
      companyName: asString(json['companyName']),
      email: asStringOr(json['email'], ''),
      phone: asString(json['phone']),
      address: asString(json['address']),
      taxId: asString(json['taxId']),
      status: asStringOr(json['status'], 'active'),
    );
  }
}
