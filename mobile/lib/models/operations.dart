import 'package:billengine_mobile/models/json.dart';

class DashboardOverview {
  const DashboardOverview({
    required this.monthlyRecurring,
    required this.currency,
    required this.customerTotal,
    required this.customerActive,
    required this.invoiceOpen,
    required this.invoiceOverdue,
    required this.unpaidBalance,
    required this.resourceTotal,
    required this.resourceRunning,
    required this.resourceBillable,
    required this.resourceNotBilled,
    required this.capacityResourceCount,
    this.lastSyncedAt,
    this.capacityCpuCores,
    this.capacityMemoryBytes,
  });

  final String monthlyRecurring;
  final String currency;
  final int customerTotal;
  final int customerActive;
  final int invoiceOpen;
  final int invoiceOverdue;
  final String unpaidBalance;
  final int resourceTotal;
  final int resourceRunning;
  final int resourceBillable;
  final int resourceNotBilled;
  final String? lastSyncedAt;
  final String? capacityCpuCores;
  final String? capacityMemoryBytes;
  final int capacityResourceCount;

  factory DashboardOverview.fromJson(Json json) {
    final revenue = asMap(json['revenue']) ?? const <String, dynamic>{};
    final customers = asMap(json['customers']) ?? const <String, dynamic>{};
    final invoices = asMap(json['invoices']) ?? const <String, dynamic>{};
    final resources = asMap(json['resources']) ?? const <String, dynamic>{};
    final capacity = asMap(json['capacity']) ?? const <String, dynamic>{};
    return DashboardOverview(
      monthlyRecurring: asStringOr(revenue['monthlyRecurring'], '0'),
      currency: asStringOr(revenue['currency'], 'IDR'),
      customerTotal: asIntOr(customers['total'], 0),
      customerActive: asIntOr(customers['active'], 0),
      invoiceOpen: asIntOr(invoices['open'], 0),
      invoiceOverdue: asIntOr(invoices['overdue'], 0),
      unpaidBalance: asStringOr(invoices['unpaidBalance'], '0'),
      resourceTotal: asIntOr(resources['total'], 0),
      resourceRunning: asIntOr(resources['running'], 0),
      resourceBillable: asIntOr(resources['billable'], 0),
      resourceNotBilled: asIntOr(resources['notBilled'], 0),
      lastSyncedAt: asString(resources['lastSyncedAt']),
      capacityCpuCores: asString(capacity['cpuCores']),
      capacityMemoryBytes: asString(capacity['memoryBytes']),
      capacityResourceCount: asIntOr(capacity['resourceCount'], 0),
    );
  }
}

class BillingSettings {
  const BillingSettings({
    required this.companyName,
    required this.billingTimezone,
    required this.billingCurrency,
    required this.billingAutomationEnabled,
    required this.billingAccessControlEnabled,
    required this.overdueGraceDays,
    required this.graceNoticeIntervalHours,
    required this.source,
    this.companyEmail,
    this.companyAddress,
    this.companyTaxId,
    this.defaultTaxRate,
    this.updatedAt,
  });

  final String companyName;
  final String? companyEmail;
  final String? companyAddress;
  final String? companyTaxId;
  final String billingTimezone;
  final String billingCurrency;
  final String? defaultTaxRate;
  final bool billingAutomationEnabled;
  final bool billingAccessControlEnabled;
  final int overdueGraceDays;
  final int graceNoticeIntervalHours;
  final String source;
  final DateTime? updatedAt;

  static const BillingSettings fallback = BillingSettings(
    companyName: 'Billing Infra',
    billingTimezone: 'Asia/Makassar',
    billingCurrency: 'IDR',
    billingAutomationEnabled: false,
    billingAccessControlEnabled: false,
    overdueGraceDays: 7,
    graceNoticeIntervalHours: 24,
    source: 'environment',
  );

  factory BillingSettings.fromJson(Json json) {
    return BillingSettings(
      companyName: asStringOr(json['companyName'], 'Billing Infra'),
      companyEmail: asString(json['companyEmail']),
      companyAddress: asString(json['companyAddress']),
      companyTaxId: asString(json['companyTaxId']),
      billingTimezone: asStringOr(json['billingTimezone'], 'Asia/Makassar'),
      billingCurrency: asStringOr(json['billingCurrency'], 'IDR'),
      defaultTaxRate: asString(json['defaultTaxRate']),
      billingAutomationEnabled: asBool(json['billingAutomationEnabled']),
      billingAccessControlEnabled: asBool(json['billingAccessControlEnabled']),
      overdueGraceDays: asIntOr(json['overdueGraceDays'], 7),
      graceNoticeIntervalHours: asIntOr(json['graceNoticeIntervalHours'], 24),
      source: asStringOr(json['source'], 'environment'),
      updatedAt: asDate(json['updatedAt']),
    );
  }
}

class ActivityEntry {
  const ActivityEntry({
    required this.id,
    required this.action,
    required this.entityType,
    required this.createdAt,
    this.entityId,
    this.actorName,
    this.actorEmail,
  });

  final String id;
  final String action;
  final String entityType;
  final String? entityId;
  final String? actorName;
  final String? actorEmail;
  final String createdAt;

  factory ActivityEntry.fromJson(Json json) {
    return ActivityEntry(
      id: asStringOr(json['id'], ''),
      action: asStringOr(json['action'], ''),
      entityType: asStringOr(json['entityType'], ''),
      entityId: asString(json['entityId']),
      actorName: asString(json['actorName']),
      actorEmail: asString(json['actorEmail']),
      createdAt: asStringOr(json['createdAt'], ''),
    );
  }
}

class JobRun {
  const JobRun({
    required this.id,
    required this.jobName,
    required this.status,
    required this.startedAt,
    required this.processedCount,
    this.finishedAt,
    this.errorMessage,
  });

  final String id;
  final String jobName;
  final String status;
  final String startedAt;
  final String? finishedAt;
  final int processedCount;
  final String? errorMessage;

  factory JobRun.fromJson(Json json) {
    return JobRun(
      id: asStringOr(json['id'], ''),
      jobName: asStringOr(json['jobName'], ''),
      status: asStringOr(json['status'], 'completed'),
      startedAt: asStringOr(json['startedAt'], ''),
      finishedAt: asString(json['finishedAt']),
      processedCount: asIntOr(json['processedCount'], 0),
      errorMessage: asString(json['errorMessage']),
    );
  }
}

class ReportSummary {
  const ReportSummary({
    required this.invoiced,
    required this.collected,
    required this.outstanding,
    required this.monthly,
    this.from,
    this.to,
  });

  final String? from;
  final String? to;
  final List<({String currency, String amount, int count})> invoiced;
  final List<({String currency, String amount})> collected;
  final List<({String currency, String amount})> outstanding;
  final List<MonthlyReportRow> monthly;

  static const ReportSummary empty = ReportSummary(
    invoiced: <({String currency, String amount, int count})>[],
    collected: <({String currency, String amount})>[],
    outstanding: <({String currency, String amount})>[],
    monthly: <MonthlyReportRow>[],
  );

  factory ReportSummary.fromJson(Json json) {
    return ReportSummary(
      from: asString(json['from']),
      to: asString(json['to']),
      invoiced: asMapList(json['invoiced'])
          .map(
            (row) => (
              currency: asStringOr(row['currency'], 'IDR'),
              amount: asStringOr(row['amount'], '0'),
              count: asIntOr(row['count'], 0),
            ),
          )
          .toList(),
      collected: asMapList(json['collected'])
          .map(
            (row) => (
              currency: asStringOr(row['currency'], 'IDR'),
              amount: asStringOr(row['amount'], '0'),
            ),
          )
          .toList(),
      outstanding: asMapList(json['outstanding'])
          .map(
            (row) => (
              currency: asStringOr(row['currency'], 'IDR'),
              amount: asStringOr(row['amount'], '0'),
            ),
          )
          .toList(),
      monthly: asMapList(json['monthly']).map(MonthlyReportRow.fromJson).toList(),
    );
  }
}

class MonthlyReportRow {
  const MonthlyReportRow({
    required this.month,
    required this.currency,
    required this.invoiced,
    required this.collected,
  });

  final String month;
  final String currency;
  final String invoiced;
  final String collected;

  factory MonthlyReportRow.fromJson(Json json) {
    return MonthlyReportRow(
      month: asStringOr(json['month'], ''),
      currency: asStringOr(json['currency'], 'IDR'),
      invoiced: asStringOr(json['invoiced'], '0'),
      collected: asStringOr(json['collected'], '0'),
    );
  }
}
