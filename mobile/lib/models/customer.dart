import 'package:billengine_mobile/models/json.dart';

class Customer {
  const Customer({
    required this.id,
    required this.customerNumber,
    required this.name,
    required this.email,
    required this.status,
    this.companyName,
    this.city,
    this.countryCode = 'ID',
    this.totalServiceCount = 0,
    this.activeServiceCount = 0,
    this.phone,
    this.address,
    this.taxId,
    this.createdAt,
  });

  final String id;
  final String customerNumber;
  final String name;
  final String? companyName;
  final String email;
  final String status;
  final String? city;
  final String countryCode;
  final int totalServiceCount;
  final int activeServiceCount;
  final String? phone;
  final String? address;
  final String? taxId;
  final DateTime? createdAt;

  String get displayName => (companyName?.trim().isNotEmpty ?? false) ? companyName! : name;

  bool get isActive => status == 'active';

  factory Customer.fromJson(Json json) {
    return Customer(
      id: asStringOr(json['id'], ''),
      customerNumber: asStringOr(json['customerNumber'], ''),
      name: asStringOr(json['name'], ''),
      companyName: asString(json['companyName']),
      email: asStringOr(json['email'], ''),
      status: asStringOr(json['status'], 'active'),
      city: asString(json['city']),
      countryCode: asStringOr(json['countryCode'], 'ID'),
      totalServiceCount: asIntOr(json['totalServiceCount'], 0),
      activeServiceCount: asIntOr(json['activeServiceCount'], 0),
      phone: asString(json['phone']),
      address: asString(json['address']),
      taxId: asString(json['taxId']),
      createdAt: asDate(json['createdAt']),
    );
  }
}

class CustomerOption {
  const CustomerOption({
    required this.id,
    required this.customerNumber,
    required this.name,
    required this.email,
    this.companyName,
  });

  final String id;
  final String customerNumber;
  final String name;
  final String email;
  final String? companyName;

  String get displayName => (companyName?.trim().isNotEmpty ?? false) ? companyName! : name;

  factory CustomerOption.fromJson(Json json) {
    return CustomerOption(
      id: asStringOr(json['id'], ''),
      customerNumber: asStringOr(json['customerNumber'], ''),
      name: asStringOr(json['name'], ''),
      email: asStringOr(json['email'], ''),
      companyName: asString(json['companyName']),
    );
  }
}
