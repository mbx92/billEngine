import 'package:billengine_mobile/models/json.dart';

class TemplateParameter {
  const TemplateParameter({
    required this.key,
    required this.label,
    required this.environmentKey,
    required this.type,
    required this.required,
    required this.generated,
    this.defaultValue,
    this.help,
  });

  final String key;
  final String label;
  final String environmentKey;
  final String type;
  final bool required;
  final bool generated;
  final String? defaultValue;
  final String? help;

  bool get isSecret => type == 'secret';

  factory TemplateParameter.fromJson(Json json) {
    return TemplateParameter(
      key: asStringOr(json['key'], ''),
      label: asStringOr(json['label'], ''),
      environmentKey: asStringOr(json['environmentKey'], ''),
      type: asStringOr(json['type'], 'string'),
      required: asBool(json['required'], fallback: true),
      generated: asBool(json['generated']),
      defaultValue: asString(json['defaultValue']),
      help: asString(json['help']),
    );
  }
}

class TemplateLimits {
  const TemplateLimits({this.cpuMilli, this.memoryBytes});

  final int? cpuMilli;
  final String? memoryBytes;

  factory TemplateLimits.fromJson(Json json) {
    return TemplateLimits(cpuMilli: asInt(json['cpuMilli']), memoryBytes: asString(json['memoryBytes']));
  }
}

class TemplateSpec {
  const TemplateSpec({
    required this.restartPolicy,
    required this.limits,
    required this.parameters,
    this.sourceType,
    this.sourceReference,
    this.imageReference,
  });

  final String restartPolicy;
  final TemplateLimits limits;
  final List<TemplateParameter> parameters;
  final String? sourceType;
  final String? sourceReference;
  final String? imageReference;

  factory TemplateSpec.fromJson(Json json) {
    final spec = asMap(json['spec']) ?? const <String, dynamic>{};
    final source = asMap(spec['source']);
    return TemplateSpec(
      restartPolicy: asStringOr(spec['restartPolicy'], 'unless-stopped'),
      limits: TemplateLimits.fromJson(asMap(spec['limits']) ?? const <String, dynamic>{}),
      parameters: asMapList(json['parameters']).map(TemplateParameter.fromJson).toList(),
      sourceType: asString(source?['type']),
      sourceReference: asString(source?['reference']),
      imageReference: null,
    );
  }
}

class InfraTemplate {
  const InfraTemplate({
    required this.id,
    required this.slug,
    required this.name,
    required this.category,
    required this.version,
    required this.isBuiltin,
    required this.isActive,
    required this.releasePolicy,
    required this.definition,
    this.description,
    this.applicationId,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String slug;
  final String name;
  final String? description;
  final String category;
  final int version;
  final bool isBuiltin;
  final bool isActive;
  final String releasePolicy;
  final String? applicationId;
  final TemplateSpec definition;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory InfraTemplate.fromJson(Json json) {
    final definition = asMap(json['definition']) ?? const <String, dynamic>{};
    return InfraTemplate(
      id: asStringOr(json['id'], ''),
      slug: asStringOr(json['slug'], ''),
      name: asStringOr(json['name'], ''),
      description: asString(json['description']),
      category: asStringOr(json['category'], 'application'),
      version: asIntOr(json['version'], 1),
      isBuiltin: asBool(json['isBuiltin']),
      isActive: asBool(json['isActive'], fallback: true),
      releasePolicy: asStringOr(json['releasePolicy'], 'manual'),
      applicationId: asString(json['applicationId']),
      definition: TemplateSpec.fromJson(definition),
      createdAt: asDate(json['createdAt']),
      updatedAt: asDate(json['updatedAt']),
    );
  }
}

class BackupTarget {
  const BackupTarget({
    required this.id,
    required this.name,
    required this.provider,
    required this.endpoint,
    required this.region,
    required this.bucket,
    required this.prefix,
    required this.pathStyle,
    required this.isActive,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String name;
  final String provider;
  final String endpoint;
  final String region;
  final String bucket;
  final String prefix;
  final bool pathStyle;
  final bool isActive;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory BackupTarget.fromJson(Json json) {
    return BackupTarget(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      provider: asStringOr(json['provider'], 's3'),
      endpoint: asStringOr(json['endpoint'], ''),
      region: asStringOr(json['region'], ''),
      bucket: asStringOr(json['bucket'], ''),
      prefix: asStringOr(json['prefix'], ''),
      pathStyle: asBool(json['pathStyle']),
      isActive: asBool(json['isActive'], fallback: true),
      createdAt: asDate(json['createdAt']),
      updatedAt: asDate(json['updatedAt']),
    );
  }
}

class BackupPolicy {
  const BackupPolicy({
    required this.id,
    required this.name,
    required this.serviceDatabaseId,
    required this.storageTargetId,
    required this.intervalMinutes,
    required this.retentionCount,
    required this.isActive,
    this.alertEmail,
    this.nextRunAt,
    this.lastRunAt,
    this.databaseName = '',
    this.serviceNumber = '',
    this.serviceName = '',
    this.targetName = '',
  });

  final String id;
  final String name;
  final String serviceDatabaseId;
  final String storageTargetId;
  final int intervalMinutes;
  final int retentionCount;
  final String? alertEmail;
  final bool isActive;
  final String? nextRunAt;
  final String? lastRunAt;
  final String databaseName;
  final String serviceNumber;
  final String serviceName;
  final String targetName;

  factory BackupPolicy.fromJson(Json json) {
    return BackupPolicy(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      serviceDatabaseId: asStringOr(json['serviceDatabaseId'], ''),
      storageTargetId: asStringOr(json['storageTargetId'], ''),
      intervalMinutes: asIntOr(json['intervalMinutes'], 0),
      retentionCount: asIntOr(json['retentionCount'], 0),
      alertEmail: asString(json['alertEmail']),
      isActive: asBool(json['isActive'], fallback: true),
      nextRunAt: asString(json['nextRunAt']),
      lastRunAt: asString(json['lastRunAt']),
      databaseName: asStringOr(json['databaseName'], ''),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      serviceName: asStringOr(json['serviceName'], ''),
      targetName: asStringOr(json['targetName'], ''),
    );
  }
}

class BackupRun {
  const BackupRun({
    required this.id,
    required this.serviceDatabaseId,
    required this.status,
    required this.databaseName,
    required this.serviceNumber,
    required this.serviceName,
    required this.clusterName,
    required this.nodeName,
    this.policyId,
    this.storageTargetId,
    this.storagePath,
    this.objectKey,
    this.checksumSha256,
    this.sizeBytes,
    this.lastError,
    this.completedAt,
    this.restoredAt,
    this.expiresAt,
    this.createdAt,
    this.targetName,
  });

  final String id;
  final String serviceDatabaseId;
  final String? policyId;
  final String? storageTargetId;
  final String status;
  final String? storagePath;
  final String? objectKey;
  final String? checksumSha256;
  final String? sizeBytes;
  final String? lastError;
  final String? completedAt;
  final String? restoredAt;
  final String? expiresAt;
  final String databaseName;
  final String serviceNumber;
  final String serviceName;
  final String clusterName;
  final String nodeName;
  final String? targetName;
  final String? createdAt;

  factory BackupRun.fromJson(Json json) {
    return BackupRun(
      id: asStringOr(json['id'], ''),
      serviceDatabaseId: asStringOr(json['serviceDatabaseId'], ''),
      policyId: asString(json['policyId']),
      storageTargetId: asString(json['storageTargetId']),
      status: asStringOr(json['status'], 'queued'),
      storagePath: asString(json['storagePath']),
      objectKey: asString(json['objectKey']),
      checksumSha256: asString(json['checksumSha256']),
      sizeBytes: asString(json['sizeBytes']),
      lastError: asString(json['lastError']),
      completedAt: asString(json['completedAt']),
      restoredAt: asString(json['restoredAt']),
      expiresAt: asString(json['expiresAt']),
      databaseName: asStringOr(json['databaseName'], ''),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      serviceName: asStringOr(json['serviceName'], ''),
      clusterName: asStringOr(json['clusterName'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      targetName: asString(json['targetName']),
      createdAt: asString(json['createdAt']),
    );
  }
}

class BackupSource {
  const BackupSource({
    required this.id,
    required this.databaseName,
    required this.status,
    required this.serviceNumber,
    required this.serviceName,
    required this.customerName,
    required this.clusterName,
    required this.nodeName,
  });

  final String id;
  final String databaseName;
  final String status;
  final String serviceNumber;
  final String serviceName;
  final String customerName;
  final String clusterName;
  final String nodeName;

  factory BackupSource.fromJson(Json json) {
    return BackupSource(
      id: asStringOr(json['id'], ''),
      databaseName: asStringOr(json['databaseName'], ''),
      status: asStringOr(json['status'], 'active'),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      serviceName: asStringOr(json['serviceName'], ''),
      customerName: asStringOr(json['customerName'], ''),
      clusterName: asStringOr(json['clusterName'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
    );
  }
}

class BackupOverview {
  const BackupOverview({
    required this.targets,
    required this.policies,
    required this.runs,
    required this.sources,
  });

  final List<BackupTarget> targets;
  final List<BackupPolicy> policies;
  final List<BackupRun> runs;
  final List<BackupSource> sources;

  static const BackupOverview empty = BackupOverview(
    targets: <BackupTarget>[],
    policies: <BackupPolicy>[],
    runs: <BackupRun>[],
    sources: <BackupSource>[],
  );

  factory BackupOverview.fromJson(Json json) {
    return BackupOverview(
      targets: asMapList(json['targets']).map(BackupTarget.fromJson).toList(),
      policies: asMapList(json['policies']).map(BackupPolicy.fromJson).toList(),
      runs: asMapList(json['runs']).map(BackupRun.fromJson).toList(),
      sources: asMapList(json['sources']).map(BackupSource.fromJson).toList(),
    );
  }
}

class DatabaseCluster {
  const DatabaseCluster({
    required this.id,
    required this.name,
    required this.engine,
    required this.mode,
    required this.status,
    required this.isActive,
    required this.adminDatabase,
    required this.provisionerUsername,
    required this.defaultConnectionLimit,
    required this.primaryResourceId,
    required this.primaryResourceName,
    required this.resourceState,
    required this.nodeId,
    required this.nodeName,
    required this.nodeStatus,
    required this.agentVersion,
    this.lastError,
    this.activatedAt,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String name;
  final String engine;
  final String mode;
  final String status;
  final bool isActive;
  final String adminDatabase;
  final String provisionerUsername;
  final int defaultConnectionLimit;
  final String? lastError;
  final String? activatedAt;
  final String primaryResourceId;
  final String primaryResourceName;
  final String resourceState;
  final String nodeId;
  final String nodeName;
  final String nodeStatus;
  final String agentVersion;
  final String? createdAt;
  final String? updatedAt;

  factory DatabaseCluster.fromJson(Json json) {
    return DatabaseCluster(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      engine: asStringOr(json['engine'], 'postgresql'),
      mode: asStringOr(json['mode'], 'dedicated'),
      status: asStringOr(json['status'], 'provisioning'),
      isActive: asBool(json['isActive'], fallback: true),
      adminDatabase: asStringOr(json['adminDatabase'], 'postgres'),
      provisionerUsername: asStringOr(json['provisionerUsername'], ''),
      defaultConnectionLimit: asIntOr(json['defaultConnectionLimit'], 100),
      lastError: asString(json['lastError']),
      activatedAt: asString(json['activatedAt']),
      primaryResourceId: asStringOr(json['primaryResourceId'], ''),
      primaryResourceName: asStringOr(json['primaryResourceName'], ''),
      resourceState: asStringOr(json['resourceState'], 'unknown'),
      nodeId: asStringOr(json['nodeId'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      nodeStatus: asStringOr(json['nodeStatus'], 'unknown'),
      agentVersion: asStringOr(json['agentVersion'], ''),
      createdAt: asString(json['createdAt']),
      updatedAt: asString(json['updatedAt']),
    );
  }
}

class DatabaseAllocation {
  const DatabaseAllocation({
    required this.id,
    required this.serviceId,
    required this.serviceNumber,
    required this.serviceName,
    required this.customerName,
    required this.databaseClusterId,
    required this.clusterName,
    required this.applicationResourceId,
    required this.applicationName,
    required this.nodeName,
    required this.databaseName,
    required this.roleName,
    required this.environmentKey,
    required this.status,
    this.lastError,
    this.provisionedAt,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String serviceId;
  final String serviceNumber;
  final String serviceName;
  final String customerName;
  final String databaseClusterId;
  final String clusterName;
  final String applicationResourceId;
  final String applicationName;
  final String nodeName;
  final String databaseName;
  final String roleName;
  final String environmentKey;
  final String status;
  final String? lastError;
  final String? provisionedAt;
  final String? createdAt;
  final String? updatedAt;

  factory DatabaseAllocation.fromJson(Json json) {
    return DatabaseAllocation(
      id: asStringOr(json['id'], ''),
      serviceId: asStringOr(json['serviceId'], ''),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      serviceName: asStringOr(json['serviceName'], ''),
      customerName: asStringOr(json['customerName'], ''),
      databaseClusterId: asStringOr(json['databaseClusterId'], ''),
      clusterName: asStringOr(json['clusterName'], ''),
      applicationResourceId: asStringOr(json['applicationResourceId'], ''),
      applicationName: asStringOr(json['applicationName'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      databaseName: asStringOr(json['databaseName'], ''),
      roleName: asStringOr(json['roleName'], ''),
      environmentKey: asStringOr(json['environmentKey'], ''),
      status: asStringOr(json['status'], 'provisioning'),
      lastError: asString(json['lastError']),
      provisionedAt: asString(json['provisionedAt']),
      createdAt: asString(json['createdAt']),
      updatedAt: asString(json['updatedAt']),
    );
  }
}

class ClusterCandidate {
  const ClusterCandidate({
    required this.id,
    required this.name,
    required this.observedState,
    required this.nodeId,
    required this.nodeName,
    required this.nodeStatus,
    required this.agentVersion,
    this.imageReference,
  });

  final String id;
  final String name;
  final String observedState;
  final String nodeId;
  final String nodeName;
  final String nodeStatus;
  final String agentVersion;
  final String? imageReference;

  factory ClusterCandidate.fromJson(Json json) {
    return ClusterCandidate(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      observedState: asStringOr(json['observedState'], 'unknown'),
      nodeId: asStringOr(json['nodeId'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      nodeStatus: asStringOr(json['nodeStatus'], 'unknown'),
      agentVersion: asStringOr(json['agentVersion'], ''),
      imageReference: asString(json['imageReference']),
    );
  }
}

class DatabaseOverview {
  const DatabaseOverview({
    required this.clusters,
    required this.candidates,
    required this.allocations,
    required this.eligibleServices,
    required this.eligibleApplications,
    required this.backups,
  });

  final List<DatabaseCluster> clusters;
  final List<ClusterCandidate> candidates;
  final List<DatabaseAllocation> allocations;
  final List<DatabaseEligibleService> eligibleServices;
  final List<DatabaseEligibleApplication> eligibleApplications;
  final List<ClusterBackup> backups;

  static const DatabaseOverview empty = DatabaseOverview(
    clusters: <DatabaseCluster>[],
    candidates: <ClusterCandidate>[],
    allocations: <DatabaseAllocation>[],
    eligibleServices: <DatabaseEligibleService>[],
    eligibleApplications: <DatabaseEligibleApplication>[],
    backups: <ClusterBackup>[],
  );

  factory DatabaseOverview.fromJson(Json json) {
    return DatabaseOverview(
      clusters: asMapList(json['clusters']).map(DatabaseCluster.fromJson).toList(),
      candidates: asMapList(json['candidates']).map(ClusterCandidate.fromJson).toList(),
      allocations: asMapList(json['allocations']).map(DatabaseAllocation.fromJson).toList(),
      eligibleServices:
          asMapList(json['eligibleServices']).map(DatabaseEligibleService.fromJson).toList(),
      eligibleApplications: asMapList(
        json['eligibleApplications'],
      ).map(DatabaseEligibleApplication.fromJson).toList(),
      backups: asMapList(json['backups']).map(ClusterBackup.fromJson).toList(),
    );
  }
}

class DatabaseEligibleService {
  const DatabaseEligibleService({
    required this.id,
    required this.serviceNumber,
    required this.name,
    required this.customerId,
    required this.customerName,
    required this.status,
  });

  final String id;
  final String serviceNumber;
  final String name;
  final String customerId;
  final String customerName;
  final String status;

  factory DatabaseEligibleService.fromJson(Json json) {
    return DatabaseEligibleService(
      id: asStringOr(json['id'], ''),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      name: asStringOr(json['name'], ''),
      customerId: asStringOr(json['customerId'], ''),
      customerName: asStringOr(json['customerName'], ''),
      status: asStringOr(json['status'], 'active'),
    );
  }
}

class DatabaseEligibleApplication {
  const DatabaseEligibleApplication({
    required this.id,
    required this.name,
    required this.observedState,
    required this.nodeId,
    required this.nodeName,
    this.customerId,
  });

  final String id;
  final String name;
  final String observedState;
  final String nodeId;
  final String nodeName;
  final String? customerId;

  factory DatabaseEligibleApplication.fromJson(Json json) {
    return DatabaseEligibleApplication(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      observedState: asStringOr(json['observedState'], 'unknown'),
      nodeId: asStringOr(json['nodeId'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      customerId: asString(json['customerId']),
    );
  }
}

class ClusterBackup {
  const ClusterBackup({
    required this.id,
    required this.serviceDatabaseId,
    required this.status,
    this.checksumSha256,
    this.sizeBytes,
    this.lastError,
    this.completedAt,
    this.restoredAt,
    this.createdAt,
  });

  final String id;
  final String serviceDatabaseId;
  final String status;
  final String? checksumSha256;
  final String? sizeBytes;
  final String? lastError;
  final String? completedAt;
  final String? restoredAt;
  final String? createdAt;

  factory ClusterBackup.fromJson(Json json) {
    return ClusterBackup(
      id: asStringOr(json['id'], ''),
      serviceDatabaseId: asStringOr(json['serviceDatabaseId'], ''),
      status: asStringOr(json['status'], 'queued'),
      checksumSha256: asString(json['checksumSha256']),
      sizeBytes: asString(json['sizeBytes']),
      lastError: asString(json['lastError']),
      completedAt: asString(json['completedAt']),
      restoredAt: asString(json['restoredAt']),
      createdAt: asString(json['createdAt']),
    );
  }
}

class TunnelRoute {
  const TunnelRoute({
    required this.service,
    required this.noTlsVerify,
    this.hostname,
    this.path,
    this.httpHostHeader,
    this.originServerName,
    this.catchAll = false,
  });

  final String? hostname;
  final String? path;
  final String service;
  final bool noTlsVerify;
  final String? httpHostHeader;
  final String? originServerName;
  final bool catchAll;

  factory TunnelRoute.fromJson(Json json) {
    return TunnelRoute(
      hostname: asString(json['hostname']),
      path: asString(json['path']),
      service: asStringOr(json['service'], ''),
      noTlsVerify: asBool(json['noTlsVerify']),
      httpHostHeader: asString(json['httpHostHeader']),
      originServerName: asString(json['originServerName']),
      catchAll: asBool(json['catchAll']),
    );
  }
}

class CloudflareTunnel {
  const CloudflareTunnel({
    required this.id,
    required this.name,
    required this.status,
    required this.configSource,
    required this.expectedDnsTarget,
    this.createdAt,
    this.connectionsActiveAt,
    this.connectionsInactiveAt,
  });

  final String id;
  final String name;
  final String status;
  final String configSource;
  final String? createdAt;
  final String? connectionsActiveAt;
  final String? connectionsInactiveAt;
  final String expectedDnsTarget;

  factory CloudflareTunnel.fromJson(Json json) {
    return CloudflareTunnel(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      status: asStringOr(json['status'], 'unknown'),
      configSource: asStringOr(json['configSource'], 'local'),
      createdAt: asString(json['createdAt']),
      connectionsActiveAt: asString(json['connectionsActiveAt']),
      connectionsInactiveAt: asString(json['connectionsInactiveAt']),
      expectedDnsTarget: asStringOr(json['expectedDnsTarget'], ''),
    );
  }
}

class TunnelOverview {
  const TunnelOverview({required this.configured, required this.tunnels});

  final bool configured;
  final List<CloudflareTunnel> tunnels;

  static const TunnelOverview notConfigured = TunnelOverview(
    configured: false,
    tunnels: <CloudflareTunnel>[],
  );

  factory TunnelOverview.fromJson(Json json) {
    return TunnelOverview(
      configured: asBool(json['configured']),
      tunnels: asMapList(json['tunnels']).map(CloudflareTunnel.fromJson).toList(),
    );
  }
}

class TunnelDetail {
  const TunnelDetail({
    required this.tunnel,
    required this.editable,
    required this.routes,
    this.version,
    this.updatedAt,
  });

  final CloudflareTunnel tunnel;
  final bool editable;
  final int? version;
  final String? updatedAt;
  final List<TunnelRoute> routes;

  factory TunnelDetail.fromJson(Json json) {
    final configuration = asMap(json['configuration']);
    return TunnelDetail(
      tunnel: CloudflareTunnel.fromJson(asMap(json['tunnel']) ?? const <String, dynamic>{}),
      editable: asBool(json['editable']),
      version: asInt(configuration?['version']),
      updatedAt: asString(configuration?['updatedAt']),
      routes: asMapList(configuration?['routes']).map(TunnelRoute.fromJson).toList(),
    );
  }
}

class ResourceSecret {
  const ResourceSecret({
    required this.environmentKey,
    required this.value,
    this.reference,
  });

  final String environmentKey;
  final String value;
  final String? reference;

  factory ResourceSecret.fromJson(Json json) {
    return ResourceSecret(
      environmentKey: asStringOr(json['environmentKey'] ?? json['key'], ''),
      value: asStringOr(json['value'], ''),
      reference: asString(json['reference']),
    );
  }
}

class DatabaseCredential {
  const DatabaseCredential({
    required this.databaseName,
    required this.roleName,
    required this.connectionUri,
  });

  final String databaseName;
  final String roleName;
  final String connectionUri;

  factory DatabaseCredential.fromJson(Json json) {
    return DatabaseCredential(
      databaseName: asStringOr(json['databaseName'], ''),
      roleName: asStringOr(json['roleName'], ''),
      connectionUri: asStringOr(json['connectionUri'] ?? json['connectionString'], ''),
    );
  }
}

class ReconciliationResource {
  const ReconciliationResource({
    required this.id,
    required this.name,
    required this.status,
    required this.resourceType,
    required this.serverName,
    required this.changed,
    this.currentCpuCores,
    this.desiredCpuCores,
    this.currentMemoryBytes,
    this.desiredMemoryBytes,
  });

  final String id;
  final String name;
  final String status;
  final String resourceType;
  final String serverName;
  final String? currentCpuCores;
  final String? desiredCpuCores;
  final String? currentMemoryBytes;
  final String? desiredMemoryBytes;
  final bool changed;

  factory ReconciliationResource.fromJson(Json json) {
    return ReconciliationResource(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      status: asStringOr(json['status'], 'unknown'),
      resourceType: asStringOr(json['resourceType'], 'application'),
      serverName: asStringOr(json['serverName'], ''),
      currentCpuCores: asString(json['currentCpuCores']),
      desiredCpuCores: asString(json['desiredCpuCores']),
      currentMemoryBytes: asString(json['currentMemoryBytes']),
      desiredMemoryBytes: asString(json['desiredMemoryBytes']),
      changed: asBool(json['changed']),
    );
  }
}

class ReconciliationPreview {
  const ReconciliationPreview({
    required this.serviceId,
    required this.serviceNumber,
    required this.serviceName,
    required this.canApply,
    required this.fingerprint,
    required this.restartRequired,
    required this.actualResourceCount,
    required this.resources,
    this.planName,
    this.blockingReason,
    this.expectedResourceCount,
  });

  final String serviceId;
  final String serviceNumber;
  final String serviceName;
  final String? planName;
  final bool canApply;
  final String? blockingReason;
  final String fingerprint;
  final bool restartRequired;
  final int? expectedResourceCount;
  final int actualResourceCount;
  final List<ReconciliationResource> resources;

  factory ReconciliationPreview.fromJson(Json json) {
    return ReconciliationPreview(
      serviceId: asStringOr(json['serviceId'], ''),
      serviceNumber: asStringOr(json['serviceNumber'], ''),
      serviceName: asStringOr(json['serviceName'], ''),
      planName: asString(json['planName']),
      canApply: asBool(json['canApply']),
      blockingReason: asString(json['blockingReason']),
      fingerprint: asStringOr(json['fingerprint'], ''),
      restartRequired: asBool(json['restartRequired']),
      expectedResourceCount: asInt(json['expectedResourceCount']),
      actualResourceCount: asIntOr(json['actualResourceCount'], 0),
      resources: asMapList(json['resources']).map(ReconciliationResource.fromJson).toList(),
    );
  }
}
