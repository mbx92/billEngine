import 'dart:math';

import 'package:billengine_mobile/core/api_client.dart';
import 'package:billengine_mobile/core/api_exception.dart';
import 'package:billengine_mobile/models/customer.dart';
import 'package:billengine_mobile/models/infrastructure.dart';
import 'package:billengine_mobile/models/invoice.dart';
import 'package:billengine_mobile/models/json.dart';
import 'package:billengine_mobile/models/operations.dart';
import 'package:billengine_mobile/models/plan.dart';
import 'package:billengine_mobile/models/platform.dart';
import 'package:billengine_mobile/models/portal.dart';
import 'package:billengine_mobile/models/service.dart';
import 'package:billengine_mobile/models/user.dart';

/// Thin wrapper over [ApiClient] that maps every endpoint in the Nuxt control
/// plane to a typed model. Paths and payload shapes mirror the files under
/// `server/api/`.
class ApiService {
  ApiService(this.client);

  final ApiClient client;

  /// Better Auth signs the session token with this cookie name. Signing out
  /// through the API is preferred, but clearing the jar is the fallback when
  /// the server is unreachable.
  static const String sessionCookieName = 'better-auth.session_token';

  String get baseUrl => client.baseUrl;

  set baseUrl(String value) => client.baseUrl = value;

  static String newIdempotencyKey([String prefix = 'mobile']) {
    final random = Random.secure();
    final suffix = List<String>.generate(
      16,
      (_) => random.nextInt(16).toRadixString(16),
    ).join();
    return '$prefix:${DateTime.now().millisecondsSinceEpoch}:$suffix';
  }

  // ---------------------------------------------------------------- auth ----

  Future<AppUser> signIn({required String email, required String password}) async {
    await client.post(
      '/api/auth/sign-in/email',
      body: <String, dynamic>{'email': email.trim(), 'password': password},
    );
    return currentUser();
  }

  Future<AppUser?> session() async {
    try {
      final response = await client.get('/api/auth/get-session');
      final map = asMap(response);
      if (map == null) return null;
      final user = asMap(map['user']);
      if (user == null) return null;
      return AppUser.fromJson(user);
    } on ApiException catch (error) {
      if (error.statusCode == 401) return null;
      rethrow;
    }
  }

  Future<AppUser> currentUser() async {
    final response = await client.get('/api/me');
    final data = envelope(response);
    if (data == null) {
      throw const ApiException(message: 'Profil pengguna tidak dapat dibaca.', code: 'NO_DATA');
    }
    return AppUser.fromJson(data);
  }

  Future<void> signOut() async {
    try {
      await client.post('/api/auth/sign-out', body: const <String, dynamic>{});
    } on ApiException {
      // A revoked or expired session still has to clear the local jar.
    } finally {
      await client.clearSession();
    }
  }

  // ---------------------------------------------------------- dashboard ----

  Future<DashboardOverview> dashboard() async {
    final response = await client.get('/api/dashboard');
    final data = envelope(response);
    if (data == null) {
      throw const ApiException(message: 'Dashboard tidak dapat dibaca.', code: 'NO_DATA');
    }
    return DashboardOverview.fromJson(data);
  }

  Future<BillingSettings> settings() async {
    final response = await client.get('/api/settings');
    final data = envelope(response);
    if (data == null) return BillingSettings.fallback;
    return BillingSettings.fromJson(data);
  }

  Future<BillingSettings> updateSettings(Map<String, dynamic> payload) async {
    final response = await client.put('/api/settings', body: payload);
    final data = envelope(response);
    if (data == null) return BillingSettings.fallback;
    return BillingSettings.fromJson(data);
  }

  // ---------------------------------------------------------- customers ----

  Future<({List<Customer> rows, PageMeta meta})> customers({
    int page = 1,
    int perPage = 25,
  }) async {
    final response = await client.get(
      '/api/customers',
      query: <String, dynamic>{'page': page, 'perPage': perPage},
    );
    return (
      rows: asMapList(asMap(response)?['data']).map(Customer.fromJson).toList(),
      meta: PageMeta.from(response, perPage: perPage),
    );
  }

  Future<Customer> createCustomer(Map<String, dynamic> payload) async {
    final response = await client.post('/api/customers', body: payload);
    final data = asMap(asMap(response)?['data']);
    if (data == null) {
      throw const ApiException(message: 'Customer tidak dapat dibuat.', code: 'NO_DATA');
    }
    // The create endpoint returns the raw row; the list shape is a superset of
    // what the detail screen needs, so reuse the same mapper.
    return Customer.fromJson(data);
  }

  // -------------------------------------------------------------- plans ----

  Future<({List<Plan> rows, PageMeta meta})> plans({int page = 1, int perPage = 25}) async {
    final response = await client.get(
      '/api/plans',
      query: <String, dynamic>{'page': page, 'perPage': perPage},
    );
    return (
      rows: asMapList(asMap(response)?['data']).map(Plan.fromJson).toList(),
      meta: PageMeta.from(response, perPage: perPage),
    );
  }

  Future<Plan> createPlan(Map<String, dynamic> payload) async {
    final response = await client.post('/api/plans', body: payload);
    final data = asMap(asMap(response)?['data']);
    if (data == null) {
      throw const ApiException(message: 'Plan tidak dapat dibuat.', code: 'NO_DATA');
    }
    return Plan.fromJson(data);
  }

  Future<Plan> updatePlan(String id, Map<String, dynamic> payload) async {
    final response = await client.patch('/api/plans/$id', body: payload);
    final data = asMap(asMap(response)?['data']);
    if (data == null) {
      throw const ApiException(message: 'Plan tidak dapat diubah.', code: 'NO_DATA');
    }
    return Plan.fromJson(data);
  }

  // ----------------------------------------------------------- services ----

  Future<({List<Service> rows, PageMeta meta})> services({
    int page = 1,
    int perPage = 25,
  }) async {
    final response = await client.get(
      '/api/services',
      query: <String, dynamic>{'page': page, 'perPage': perPage},
    );
    return (
      rows: asMapList(asMap(response)?['data']).map(Service.fromJson).toList(),
      meta: PageMeta.from(response, perPage: perPage),
    );
  }

  Future<ServiceOptions> serviceOptions() async {
    final response = await client.get('/api/services/options');
    final data = envelope(response);
    if (data == null) return const ServiceOptions(plans: [], customers: [], resources: []);
    return ServiceOptions.fromJson(data);
  }

  Future<void> createService(Map<String, dynamic> payload) async {
    await client.post('/api/services', body: payload);
  }

  Future<void> updateService(String id, Map<String, dynamic> payload) async {
    await client.patch('/api/services/$id', body: payload);
  }

  Future<void> transitionService(String id, {required String status, required String reason}) {
    return client.patch(
      '/api/services/$id/transition',
      body: <String, dynamic>{'status': status, 'reason': reason},
    );
  }

  Future<void> deleteService(String id) => client.delete('/api/services/$id');

  Future<ReconciliationPreview> serviceInfrastructure(String id) async {
    final response = await client.get('/api/services/$id/infrastructure');
    final data = envelope(response);
    if (data == null) {
      throw const ApiException(message: 'Pratinjau infrastruktur tidak tersedia.', code: 'NO_DATA');
    }
    return ReconciliationPreview.fromJson(data);
  }

  Future<void> applyServiceInfrastructure(
    String id, {
    required String fingerprint,
    bool restartRunning = true,
  }) {
    return client.post(
      '/api/services/$id/infrastructure',
      body: <String, dynamic>{'fingerprint': fingerprint, 'restartRunning': restartRunning},
    );
  }

  // ----------------------------------------------------------- invoices ----

  Future<({List<InvoiceSummary> rows, InvoiceStatusCounts summary, PageMeta meta})> invoices({
    int page = 1,
    int perPage = 25,
    String? status,
    String? customerId,
    String? query,
  }) async {
    final response = await client.get(
      '/api/invoices',
      query: <String, dynamic>{
        'page': page,
        'perPage': perPage,
        'status': status,
        'customerId': customerId,
        'query': query,
      },
    );
    return (
      rows: asMapList(asMap(response)?['data']).map(InvoiceSummary.fromJson).toList(),
      summary: InvoiceStatusCounts.from(response),
      meta: PageMeta.from(response, perPage: perPage),
    );
  }

  Future<InvoiceDetail> invoice(String id) async {
    final response = await client.get('/api/invoices/$id');
    final data = envelope(response);
    if (data == null) {
      throw const ApiException(message: 'Invoice tidak dapat dibaca.', code: 'NO_DATA');
    }
    return InvoiceDetail.fromJson(data);
  }

  Future<void> createInvoice(Map<String, dynamic> payload) async {
    await client.post('/api/invoices', body: payload);
  }

  Future<void> updateInvoice(String id, Map<String, dynamic> payload) async {
    await client.patch('/api/invoices/$id', body: payload);
  }

  Future<void> cancelInvoice(String id) => client.post('/api/invoices/$id/cancel');

  Future<void> deleteInvoice(String id) => client.delete('/api/invoices/$id');

  Future<Map<String, dynamic>> sendInvoice(String id) async {
    final response = await client.post('/api/invoices/$id/send');
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<void> addCreditNote(String id, {required String amount, required String reason}) {
    return client.post(
      '/api/invoices/$id/credit-notes',
      body: <String, dynamic>{'amount': amount, 'reason': reason},
    );
  }

  Future<Map<String, dynamic>> generateRecurringInvoices({String? asOf, int limit = 100}) async {
    final response = await client.post(
      '/api/invoices/generate',
      body: <String, dynamic>{'asOf': ?asOf, 'limit': limit},
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<Map<String, dynamic>> markOverdue({String? asOf}) async {
    final response = await client.post(
      '/api/invoices/mark-overdue',
      body: <String, dynamic>{'asOf': ?asOf},
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<DownloadResult> invoicePdf(String id, {bool portal = false}) {
    return client.download(portal ? '/api/portal/invoices/$id/pdf' : '/api/invoices/$id/pdf');
  }

  Future<({List<CustomerOption> customers, List<InvoiceServiceOption> services})>
  invoiceOptions() async {
    final response = await client.get('/api/invoices/options');
    final data = envelope(response) ?? const <String, dynamic>{};
    return (
      customers: asMapList(data['customers']).map(CustomerOption.fromJson).toList(),
      services: asMapList(data['services']).map(InvoiceServiceOption.fromJson).toList(),
    );
  }

  // ----------------------------------------------------------- payments ----

  Future<({List<PaymentListEntry> rows, PageMeta meta})> payments({
    int page = 1,
    int perPage = 25,
    String? status,
    String? invoiceId,
    String? from,
    String? to,
  }) async {
    final response = await client.get(
      '/api/payments',
      query: <String, dynamic>{
        'page': page,
        'perPage': perPage,
        'status': status,
        'invoiceId': invoiceId,
        'from': from,
        'to': to,
      },
    );
    return (
      rows: asMapList(asMap(response)?['data']).map(PaymentListEntry.fromJson).toList(),
      meta: PageMeta.from(response, perPage: perPage),
    );
  }

  Future<List<PaymentInvoiceOption>> paymentOptions() async {
    final response = await client.get('/api/payments/options');
    return envelopeList(response).map(PaymentInvoiceOption.fromJson).toList();
  }

  Future<Map<String, dynamic>> recordPayment(Map<String, dynamic> payload) async {
    final response = await client.post('/api/payments', body: payload);
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  // ------------------------------------------------------------ reports ----

  Future<ReportSummary> reportSummary({String? from, String? to}) async {
    final response = await client.get(
      '/api/reports/summary',
      query: <String, dynamic>{'from': from, 'to': to},
    );
    final data = envelope(response);
    if (data == null) return ReportSummary.empty;
    return ReportSummary.fromJson(data);
  }

  Future<DownloadResult> reportCsv({String? from, String? to}) {
    return client.download(
      '/api/reports/export',
      query: <String, dynamic>{'from': from, 'to': to},
    );
  }

  // ----------------------------------------------------------- activity ----

  Future<({List<ActivityEntry> rows, List<JobRun> jobs, PageMeta meta})> activity({
    int page = 1,
    int perPage = 25,
  }) async {
    final response = await client.get(
      '/api/activity',
      query: <String, dynamic>{'page': page, 'perPage': perPage},
    );
    final map = asMap(response);
    return (
      rows: asMapList(map?['data']).map(ActivityEntry.fromJson).toList(),
      jobs: asMapList(map?['jobRuns']).map(JobRun.fromJson).toList(),
      meta: PageMeta.from(response, perPage: perPage),
    );
  }

  // -------------------------------------------------------------- users ----

  Future<List<AppUser>> users() async {
    final response = await client.get('/api/users');
    return envelopeList(response).map(AppUser.fromJson).toList();
  }

  Future<void> createUser(Map<String, dynamic> payload) async {
    await client.post('/api/users', body: payload);
  }

  Future<void> updateUserAccess(String id, Map<String, dynamic> payload) async {
    await client.patch('/api/users/$id', body: payload);
  }

  Future<void> updateUserPassword(String id, String password) {
    return client.patch('/api/users/$id/password', body: <String, dynamic>{'password': password});
  }

  // ------------------------------------------------------------ portal -----

  Future<PortalSummary> portalSummary() async {
    final response = await client.get('/api/portal/summary');
    final data = envelope(response);
    if (data == null) {
      throw const ApiException(message: 'Portal tidak dapat dibaca.', code: 'NO_DATA');
    }
    return PortalSummary.fromJson(data);
  }

  Future<InvoiceDetail> portalInvoice(String id) async {
    final response = await client.get('/api/portal/invoices/$id');
    final data = envelope(response);
    if (data == null) {
      throw const ApiException(message: 'Invoice tidak dapat dibaca.', code: 'NO_DATA');
    }
    return InvoiceDetail.fromJson(data);
  }

  // ---------------------------------------------------- infrastructure -----

  Future<List<InfraNode>> nodes() async {
    final response = await client.get('/api/infrastructure/nodes');
    return envelopeList(response).map(InfraNode.fromJson).toList();
  }

  Future<List<InfraResource>> resources() async {
    final response = await client.get('/api/infrastructure/resources');
    return envelopeList(response).map(InfraResource.fromJson).toList();
  }

  Future<List<InfraOperation>> operations({int limit = 100}) async {
    final response = await client.get(
      '/api/infrastructure/operations',
      query: <String, dynamic>{'limit': limit},
    );
    return envelopeList(response).map(InfraOperation.fromJson).toList();
  }

  Future<ApplicationCatalog> applicationCatalog() async {
    final response = await client.get('/api/infrastructure/applications');
    final data = envelope(response);
    if (data == null) return ApplicationCatalog.empty;
    return ApplicationCatalog.fromJson(data);
  }

  Future<void> createApplication(Map<String, dynamic> payload) {
    return client.post(
      '/api/infrastructure/applications',
      body: payload,
      idempotencyKey: newIdempotencyKey('application'),
    );
  }

  Future<List<InfraTemplate>> templates() async {
    final response = await client.get('/api/infrastructure/templates');
    return envelopeList(response).map(InfraTemplate.fromJson).toList();
  }

  Future<Map<String, dynamic>> deployTemplate(
    String templateId,
    Map<String, dynamic> payload,
  ) async {
    final response = await client.post(
      '/api/infrastructure/templates/$templateId/deploy',
      body: payload,
      idempotencyKey: newIdempotencyKey('template-deploy'),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<Map<String, dynamic>> resourceOperation(String resourceId, String action) async {
    final response = await client.post(
      '/api/infrastructure/resources/$resourceId/operations',
      body: <String, dynamic>{'action': action},
      idempotencyKey: newIdempotencyKey(action),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<List<ResourceSecret>> revealResourceSecrets(String resourceId) async {
    final response = await client.post('/api/infrastructure/resources/$resourceId/secrets/reveal');
    return envelopeList(response).map(ResourceSecret.fromJson).toList();
  }

  Future<void> updateResource(String resourceId, Map<String, dynamic> payload) {
    return client.patch(
      '/api/infrastructure/resources/$resourceId',
      body: payload,
      idempotencyKey: newIdempotencyKey('resource-update'),
    );
  }

  Future<Map<String, dynamic>> queueBuild(String applicationId, {String? version}) async {
    final response = await client.post(
      '/api/infrastructure/applications/$applicationId/builds',
      body: <String, dynamic>{'version': ?version},
      idempotencyKey: newIdempotencyKey('build'),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<void> createRelease(String applicationId, Map<String, dynamic> payload) async {
    await client.post('/api/infrastructure/applications/$applicationId/releases', body: payload);
  }

  Future<int> rolloutRelease(
    String releaseId, {
    required List<String> resourceIds,
    bool trackLatest = false,
  }) async {
    final response = await client.post(
      '/api/infrastructure/releases/$releaseId/rollout',
      body: <String, dynamic>{'resourceIds': resourceIds, 'trackLatest': trackLatest},
    );
    final data = asMap(asMap(response)?['data']);
    return asIntOr(data?['operationsQueued'], 0);
  }

  Future<void> createRegistry(Map<String, dynamic> payload) async {
    await client.post('/api/infrastructure/registries', body: payload);
  }

  Future<void> updateRegistry(String id, Map<String, dynamic> payload) async {
    await client.patch('/api/infrastructure/registries/$id', body: payload);
  }

  Future<Map<String, dynamic>> createNodeEnrollment(Map<String, dynamic> payload) async {
    final response = await client.post('/api/infrastructure/nodes/enrollments', body: payload);
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<Map<String, dynamic>> upgradeNode(String id) async {
    final response = await client.post('/api/infrastructure/nodes/$id/upgrade');
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<Map<String, dynamic>> rollbackNode(String id) async {
    final response = await client.post('/api/infrastructure/nodes/$id/rollback');
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<void> updateNodeRole(String id, String role) async {
    await client.patch('/api/infrastructure/nodes/$id/role', body: <String, dynamic>{'role': role});
  }

  Future<void> revokeNode(String id) async {
    await client.post('/api/infrastructure/nodes/$id/revoke');
  }

  Future<void> deleteNodeImage(String nodeId, String imageId) {
    return client.delete(
      '/api/infrastructure/nodes/$nodeId/images/${Uri.encodeComponent(imageId)}',
    );
  }

  // ------------------------------------------------- database clusters -----

  Future<DatabaseOverview> databaseOverview() async {
    final response = await client.get('/api/infrastructure/database-clusters');
    final data = envelope(response);
    if (data == null) return DatabaseOverview.empty;
    return DatabaseOverview.fromJson(data);
  }

  Future<Map<String, dynamic>> activateCluster(Map<String, dynamic> payload) async {
    final response = await client.post(
      '/api/infrastructure/database-clusters',
      body: payload,
      idempotencyKey: newIdempotencyKey('cluster'),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<Map<String, dynamic>> provisionDatabase(
    String clusterId,
    Map<String, dynamic> payload,
  ) async {
    final response = await client.post(
      '/api/infrastructure/database-clusters/$clusterId/databases',
      body: payload,
      idempotencyKey: newIdempotencyKey('database'),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<Map<String, dynamic>> allocationAction(String allocationId, String action) async {
    final response = await client.post(
      '/api/infrastructure/database-clusters/databases/$allocationId/$action',
      idempotencyKey: newIdempotencyKey('database-$action'),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  Future<DatabaseCredential?> revealDatabaseCredential(String allocationId) async {
    final response = await client.post(
      '/api/infrastructure/database-clusters/databases/$allocationId/reveal',
    );
    final data = envelope(response);
    if (data == null) return null;
    return DatabaseCredential.fromJson(data);
  }

  Future<Map<String, dynamic>> restoreBackup(String backupId) async {
    final response = await client.post(
      '/api/infrastructure/database-backups/$backupId/restore',
      idempotencyKey: newIdempotencyKey('restore'),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  /// Queues an on-demand backup for a provisioned service database.
  Future<Map<String, dynamic>> createDatabaseBackup(String allocationId) async {
    final response = await client.post(
      '/api/infrastructure/database-clusters/databases/$allocationId/backups',
      idempotencyKey: newIdempotencyKey('database-backup'),
    );
    return asMap(asMap(response)?['data']) ?? const <String, dynamic>{};
  }

  // ------------------------------------------------------------ backups ----

  Future<BackupOverview> backupOverview() async {
    final response = await client.get('/api/infrastructure/backups');
    final data = envelope(response);
    if (data == null) return BackupOverview.empty;
    return BackupOverview.fromJson(data);
  }

  Future<void> createBackupTarget(Map<String, dynamic> payload) async {
    await client.post('/api/infrastructure/backups/targets', body: payload);
  }

  Future<void> createBackupPolicy(Map<String, dynamic> payload) async {
    await client.post('/api/infrastructure/backups/policies', body: payload);
  }

  // ------------------------------------------------------------ tunnels ----

  Future<TunnelOverview> tunnels() async {
    final response = await client.get('/api/cloudflare/tunnels');
    final data = envelope(response);
    if (data == null) return TunnelOverview.notConfigured;
    return TunnelOverview.fromJson(data);
  }

  Future<TunnelDetail> tunnel(String id) async {
    final response = await client.get('/api/cloudflare/tunnels/$id');
    final data = envelope(response);
    if (data == null) {
      throw const ApiException(message: 'Tunnel tidak dapat dibaca.', code: 'NO_DATA');
    }
    return TunnelDetail.fromJson(data);
  }

  Future<void> addTunnelRoute(String tunnelId, Map<String, dynamic> route) async {
    await client.post('/api/cloudflare/tunnels/$tunnelId/routes', body: route);
  }

  Future<void> updateTunnelRoute(
    String tunnelId, {
    required Map<String, dynamic> original,
    required Map<String, dynamic> route,
  }) {
    return client.patch(
      '/api/cloudflare/tunnels/$tunnelId/routes',
      body: <String, dynamic>{'original': original, 'route': route},
    );
  }

  Future<void> deleteTunnelRoute(String tunnelId, Map<String, dynamic> original) {
    return client.delete(
      '/api/cloudflare/tunnels/$tunnelId/routes',
      body: <String, dynamic>{'hostname': original['hostname'], 'path': original['path'] ?? ''},
    );
  }
}

/// Service entry from `ApiManualInvoiceOptions.services`.
class InvoiceServiceOption {
  const InvoiceServiceOption({
    required this.id,
    required this.serviceNumber,
    required this.name,
    required this.customerId,
    required this.currency,
    required this.priceAmount,
    required this.billingCycle,
    this.nextDueDate,
  });

  final String id;
  final String serviceNumber;
  final String name;
  final String customerId;
  final String currency;
  final String priceAmount;
  final String billingCycle;
  final String? nextDueDate;

  factory InvoiceServiceOption.fromJson(Json json) {
    return InvoiceServiceOption(
      id: asStringOr(json['id'], ''),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      name: asStringOr(json['name'], ''),
      customerId: asStringOr(json['customerId'], ''),
      currency: asStringOr(json['currency'], 'IDR'),
      priceAmount: asStringOr(json['priceAmount'], '0'),
      billingCycle: asStringOr(json['billingCycle'], 'monthly'),
      nextDueDate: asString(json['nextDueDate']),
    );
  }
}
