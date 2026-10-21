import 'package:billengine_mobile/models/customer.dart';
import 'package:billengine_mobile/models/json.dart';
import 'package:billengine_mobile/models/plan.dart';

class ServiceResourceLink {
  const ServiceResourceLink({
    required this.id,
    required this.name,
    required this.status,
    this.limitsCpus,
    this.limitsMemoryBytes,
  });

  final String id;
  final String name;
  final String status;
  final String? limitsCpus;
  final String? limitsMemoryBytes;

  factory ServiceResourceLink.fromJson(Json json) {
    return ServiceResourceLink(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      status: asStringOr(json['status'], 'unknown'),
      limitsCpus: asString(json['limitsCpus']),
      limitsMemoryBytes: asString(json['limitsMemoryBytes']),
    );
  }
}

class ServiceDatabaseLink {
  const ServiceDatabaseLink({
    required this.id,
    required this.serviceId,
    required this.databaseClusterId,
    required this.clusterName,
    required this.databaseName,
    required this.roleName,
    required this.status,
    this.lastError,
    this.sqlImportedAt,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String serviceId;
  final String databaseClusterId;
  final String clusterName;
  final String databaseName;
  final String roleName;
  final String status;
  final String? lastError;
  final String? sqlImportedAt;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory ServiceDatabaseLink.fromJson(Json json) {
    return ServiceDatabaseLink(
      id: asStringOr(json['id'], ''),
      serviceId: asStringOr(json['serviceId'], ''),
      databaseClusterId: asStringOr(json['databaseClusterId'], ''),
      clusterName: asStringOr(json['clusterName'], ''),
      databaseName: asStringOr(json['databaseName'], ''),
      roleName: asStringOr(json['roleName'], ''),
      status: asStringOr(json['status'], 'provisioning'),
      lastError: asString(json['lastError']),
      sqlImportedAt: asString(json['sqlImportedAt']),
      createdAt: asDate(json['createdAt']),
      updatedAt: asDate(json['updatedAt']),
    );
  }
}

/// Plan-versus-infrastructure contract snapshot (`evaluateInfrastructureAllocation`).
class InfrastructureAllocation {
  const InfrastructureAllocation({
    required this.status,
    this.expectedResourceCount,
    this.expectedCpuCores,
    this.expectedMemoryBytes,
    this.actualResourceCount = 0,
    this.actualCpuCores,
    this.actualMemoryBytes,
  });

  final String status;
  final int? expectedResourceCount;
  final String? expectedCpuCores;
  final String? expectedMemoryBytes;
  final int actualResourceCount;
  final String? actualCpuCores;
  final String? actualMemoryBytes;

  String get label => switch (status) {
    'matched' => 'Sesuai plan',
    'under_allocated' => 'Di bawah plan',
    'over_allocated' => 'Melebihi plan',
    'mixed' => 'Campuran',
    'unknown' => 'Tidak diketahui',
    'not_configured' => 'Belum diatur',
    _ => status,
  };

  factory InfrastructureAllocation.fromJson(Json json) {
    final expected = asMap(json['expected']) ?? const <String, dynamic>{};
    final actual = asMap(json['actual']) ?? const <String, dynamic>{};
    return InfrastructureAllocation(
      status: asStringOr(json['status'], 'unknown'),
      expectedResourceCount: asInt(expected['resourceCount']),
      expectedCpuCores: asString(expected['cpuCores']),
      expectedMemoryBytes: asString(expected['memoryBytes']),
      actualResourceCount: asIntOr(actual['resourceCount'], 0),
      actualCpuCores: asString(actual['cpuCores']),
      actualMemoryBytes: asString(actual['memoryBytes']),
    );
  }
}

class Service {
  const Service({
    required this.id,
    required this.serviceNumber,
    required this.name,
    required this.status,
    required this.currency,
    required this.priceAmount,
    required this.billingCycle,
    required this.billingStartDate,
    required this.invoiceLeadDays,
    required this.paymentDueDays,
    required this.customerId,
    required this.customerName,
    required this.customerNumber,
    required this.resources,
    required this.infrastructure,
    this.planId,
    this.planName,
    this.planInclusions = const <String>[],
    this.planResourceCount,
    this.planCpuCores,
    this.planMemoryBytes,
    this.planDatabaseMode = 'none',
    this.nextDueDate,
    this.taxRate,
    this.description,
    this.suspendedAt,
    this.suspensionReason,
    this.cancelledAt,
    this.cancellationReason,
    this.database,
  });

  final String id;
  final String serviceNumber;
  final String name;
  final String? planId;
  final String? planName;
  final List<String> planInclusions;
  final int? planResourceCount;
  final String? planCpuCores;
  final String? planMemoryBytes;
  final String planDatabaseMode;
  final String status;
  final String currency;
  final String priceAmount;
  final String billingCycle;
  final String billingStartDate;
  final String? nextDueDate;
  final int invoiceLeadDays;
  final int paymentDueDays;
  final String? taxRate;
  final String? description;
  final String? suspendedAt;
  final String? suspensionReason;
  final String? cancelledAt;
  final String? cancellationReason;
  final String customerId;
  final String customerName;
  final String customerNumber;
  final List<ServiceResourceLink> resources;
  final ServiceDatabaseLink? database;
  final InfrastructureAllocation infrastructure;

  bool get isActive => status == 'active';

  factory Service.fromJson(Json json) {
    return Service(
      id: asStringOr(json['id'], ''),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      name: asStringOr(json['name'], ''),
      planId: asString(json['planId']),
      planName: asString(json['planName']),
      planInclusions: asStringList(json['planInclusions']),
      planResourceCount: asInt(json['planResourceCount']),
      planCpuCores: asString(json['planCpuCores']),
      planMemoryBytes: asString(json['planMemoryBytes']),
      planDatabaseMode: asStringOr(json['planDatabaseMode'], 'none'),
      status: asStringOr(json['status'], 'active'),
      currency: asStringOr(json['currency'], 'IDR'),
      priceAmount: asStringOr(json['priceAmount'], '0'),
      billingCycle: asStringOr(json['billingCycle'], 'monthly'),
      billingStartDate: asStringOr(json['billingStartDate'], ''),
      nextDueDate: asString(json['nextDueDate']),
      invoiceLeadDays: asIntOr(json['invoiceLeadDays'], 0),
      paymentDueDays: asIntOr(json['paymentDueDays'], 7),
      taxRate: asString(json['taxRate']),
      description: asString(json['description']),
      suspendedAt: asString(json['suspendedAt']),
      suspensionReason: asString(json['suspensionReason']),
      cancelledAt: asString(json['cancelledAt']),
      cancellationReason: asString(json['cancellationReason']),
      customerId: asStringOr(json['customerId'], ''),
      customerName: asStringOr(json['customerName'], ''),
      customerNumber: asStringOr(json['customerNumber'], ''),
      resources: asMapList(json['resources']).map(ServiceResourceLink.fromJson).toList(),
      database: asMap(json['database']) == null
          ? null
          : ServiceDatabaseLink.fromJson(asMap(json['database'])!),
      infrastructure: InfrastructureAllocation.fromJson(
        asMap(json['infrastructure']) ?? const <String, dynamic>{},
      ),
    );
  }
}

class ServiceOptions {
  const ServiceOptions({
    required this.plans,
    required this.customers,
    required this.resources,
  });

  final List<Plan> plans;
  final List<CustomerOption> customers;
  final List<ServiceResourceOption> resources;

  factory ServiceOptions.fromJson(Json json) {
    return ServiceOptions(
      plans: asMapList(json['plans']).map(Plan.fromJson).toList(),
      customers: asMapList(json['customers']).map(CustomerOption.fromJson).toList(),
      resources: asMapList(json['resources']).map(ServiceResourceOption.fromJson).toList(),
    );
  }
}

class ServiceResourceOption {
  const ServiceResourceOption({
    required this.id,
    required this.name,
    required this.status,
    required this.serverName,
    this.projectName,
    this.environmentName,
    this.limitsCpus,
    this.limitsMemoryBytes,
  });

  final String id;
  final String name;
  final String status;
  final String serverName;
  final String? projectName;
  final String? environmentName;
  final String? limitsCpus;
  final String? limitsMemoryBytes;

  factory ServiceResourceOption.fromJson(Json json) {
    return ServiceResourceOption(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      status: asStringOr(json['status'], 'unknown'),
      serverName: asStringOr(json['serverName'], ''),
      projectName: asString(json['projectName']),
      environmentName: asString(json['environmentName']),
      limitsCpus: asString(json['limitsCpus']),
      limitsMemoryBytes: asString(json['limitsMemoryBytes']),
    );
  }
}
