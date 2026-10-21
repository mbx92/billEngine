import 'package:billengine_mobile/models/json.dart';

/// Mirrors `ApiPlan` and `ApiPlanOption`.
class Plan {
  const Plan({
    required this.id,
    required this.name,
    required this.currency,
    required this.priceAmount,
    required this.billingCycle,
    required this.inclusions,
    required this.databaseMode,
    required this.isActive,
    this.description,
    this.includedResourceCount,
    this.includedCpuCores,
    this.includedMemoryBytes,
    this.serviceCount = 0,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String name;
  final String? description;
  final String currency;
  final String priceAmount;
  final String billingCycle;
  final List<String> inclusions;
  final int? includedResourceCount;
  final String? includedCpuCores;
  final String? includedMemoryBytes;
  final String databaseMode;
  final bool isActive;
  final int serviceCount;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory Plan.fromJson(Json json) {
    return Plan(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      description: asString(json['description']),
      currency: asStringOr(json['currency'], 'IDR'),
      priceAmount: asStringOr(json['priceAmount'], '0'),
      billingCycle: asStringOr(json['billingCycle'], 'monthly'),
      inclusions: asStringList(json['inclusions']),
      includedResourceCount: asInt(json['includedResourceCount']),
      includedCpuCores: asString(json['includedCpuCores']),
      includedMemoryBytes: asString(json['includedMemoryBytes']),
      databaseMode: asStringOr(json['databaseMode'], 'none'),
      isActive: asBool(json['isActive'], fallback: true),
      serviceCount: asIntOr(json['serviceCount'], 0),
      createdAt: asDate(json['createdAt']),
      updatedAt: asDate(json['updatedAt']),
    );
  }
}
