import 'package:billengine_mobile/models/json.dart';

class DockerImage {
  const DockerImage({
    required this.id,
    required this.references,
    required this.sizeBytes,
    required this.createdAt,
    required this.used,
    required this.containerCount,
  });

  final String id;
  final List<String> references;
  final String sizeBytes;
  final String createdAt;
  final bool used;
  final int containerCount;

  factory DockerImage.fromJson(Json json) {
    return DockerImage(
      id: asStringOr(json['id'], ''),
      references: asStringList(json['references']),
      sizeBytes: asStringOr(json['sizeBytes'], '0'),
      createdAt: asStringOr(json['createdAt'], ''),
      used: asBool(json['used']),
      containerCount: asIntOr(json['containerCount'], 0),
    );
  }
}

/// Mirrors the row shape returned by `InfrastructureNodeService.listNodes()`.
class InfraNode {
  const InfraNode({
    required this.id,
    required this.name,
    required this.environment,
    required this.role,
    required this.status,
    required this.isActive,
    required this.isDraining,
    required this.resourceCount,
    required this.images,
    this.agentVersion = '',
    this.previousAgentVersion,
    this.targetAgentVersion,
    this.agentUpdateStatus = 'idle',
    this.agentLastUpdateAt,
    this.agentLastUpdateError,
    this.protocolVersion = '',
    this.osRelease = '',
    this.architecture = '',
    this.dockerVersion,
    this.composeVersion,
    this.gatewayStatus = 'unknown',
    this.gatewayVersion,
    this.gatewayLastError,
    this.capacityCpuMilli,
    this.capacityMemoryBytes,
    this.capacityDiskBytes,
    this.cpuUsageBasisPoints,
    this.memoryUsedBytes,
    this.diskUsedBytes,
    this.diskUsageBasisPoints,
    this.utilizationObservedAt,
    this.labels = const <String, String>{},
    this.capabilities = const <String>[],
    this.lastHeartbeatAt,
    this.lastInventoryAt,
    this.lastError,
    this.stuckOperationCount = 0,
    this.diskWatermark = 'unknown',
    this.availableAgentVersion,
    this.agentArtifactReady = false,
    this.remoteUpdateSupported = false,
    this.upgradeAvailable = false,
  });

  final String id;
  final String name;
  final String environment;
  final String role;
  final String status;
  final bool isActive;
  final bool isDraining;
  final String agentVersion;
  final String? previousAgentVersion;
  final String? targetAgentVersion;
  final String agentUpdateStatus;
  final String? agentLastUpdateAt;
  final String? agentLastUpdateError;
  final String protocolVersion;
  final String osRelease;
  final String architecture;
  final String? dockerVersion;
  final String? composeVersion;
  final String gatewayStatus;
  final String? gatewayVersion;
  final String? gatewayLastError;
  final int? capacityCpuMilli;
  final String? capacityMemoryBytes;
  final String? capacityDiskBytes;
  final int? cpuUsageBasisPoints;
  final String? memoryUsedBytes;
  final String? diskUsedBytes;
  final int? diskUsageBasisPoints;
  final String? utilizationObservedAt;
  final Map<String, String> labels;
  final List<String> capabilities;
  final String? lastHeartbeatAt;
  final String? lastInventoryAt;
  final String? lastError;
  final int resourceCount;
  final List<DockerImage> images;
  final int stuckOperationCount;
  final String diskWatermark;
  final String? availableAgentVersion;
  final bool agentArtifactReady;
  final bool remoteUpdateSupported;
  final bool upgradeAvailable;

  bool get isOnline => status == 'online' || status == 'degraded';

  factory InfraNode.fromJson(Json json) {
    return InfraNode(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      environment: asStringOr(json['environment'], 'staging'),
      role: asStringOr(json['role'], 'deployment'),
      status: asStringOr(json['status'], 'unknown'),
      isActive: asBool(json['isActive'], fallback: true),
      isDraining: asBool(json['isDraining']),
      agentVersion: asStringOr(json['agentVersion'], ''),
      previousAgentVersion: asString(json['previousAgentVersion']),
      targetAgentVersion: asString(json['targetAgentVersion']),
      agentUpdateStatus: asStringOr(json['agentUpdateStatus'], 'idle'),
      agentLastUpdateAt: asString(json['agentLastUpdateAt']),
      agentLastUpdateError: asString(json['agentLastUpdateError']),
      protocolVersion: asStringOr(json['protocolVersion'], ''),
      osRelease: asStringOr(json['osRelease'], ''),
      architecture: asStringOr(json['architecture'], ''),
      dockerVersion: asString(json['dockerVersion']),
      composeVersion: asString(json['composeVersion']),
      gatewayStatus: asStringOr(json['gatewayStatus'], 'unknown'),
      gatewayVersion: asString(json['gatewayVersion']),
      gatewayLastError: asString(json['gatewayLastError']),
      capacityCpuMilli: asInt(json['capacityCpuMilli']),
      capacityMemoryBytes: asString(json['capacityMemoryBytes']),
      capacityDiskBytes: asString(json['capacityDiskBytes']),
      cpuUsageBasisPoints: asInt(json['cpuUsageBasisPoints']),
      memoryUsedBytes: asString(json['memoryUsedBytes']),
      diskUsedBytes: asString(json['diskUsedBytes']),
      diskUsageBasisPoints: asInt(json['diskUsageBasisPoints']),
      utilizationObservedAt: asString(json['utilizationObservedAt']),
      labels: (asMap(json['labels']) ?? const <String, dynamic>{}).map(
        (key, value) => MapEntry(key, value.toString()),
      ),
      capabilities: asStringList(json['capabilities']),
      lastHeartbeatAt: asString(json['lastHeartbeatAt']),
      lastInventoryAt: asString(json['lastInventoryAt']),
      lastError: asString(json['lastError']),
      resourceCount: asIntOr(json['resourceCount'], 0),
      images: asMapList(json['images']).map(DockerImage.fromJson).toList(),
      stuckOperationCount: asIntOr(json['stuckOperationCount'], 0),
      diskWatermark: asStringOr(json['diskWatermark'], 'unknown'),
      availableAgentVersion: asString(json['availableAgentVersion']),
      agentArtifactReady: asBool(json['agentArtifactReady']),
      remoteUpdateSupported: asBool(json['remoteUpdateSupported']),
      upgradeAvailable: asBool(json['upgradeAvailable']),
    );
  }
}

class InfraResource {
  const InfraResource({
    required this.id,
    required this.nodeId,
    required this.nodeName,
    required this.name,
    required this.kind,
    required this.classification,
    required this.desiredState,
    required this.observedState,
    required this.desiredRevision,
    required this.observedRevision,
    this.customerId,
    this.templateId,
    this.templateName,
    this.applicationId,
    this.releaseId,
    this.releasePolicy,
    this.externalId,
    this.imageReference,
    this.imageDigest,
    this.routeHostname,
    this.routeStatus,
    this.billingGateEnabled = false,
    this.cpuMilli,
    this.memoryBytes,
    this.lastObservedAt,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String nodeId;
  final String nodeName;
  final String? customerId;
  final String? templateId;
  final String? templateName;
  final String? applicationId;
  final String? releaseId;
  final String? releasePolicy;
  final String? externalId;
  final String kind;
  final String name;
  final String classification;
  final String desiredState;
  final String observedState;
  final int desiredRevision;
  final int observedRevision;
  final String? imageReference;
  final String? imageDigest;
  final String? routeHostname;
  final String? routeStatus;
  final bool billingGateEnabled;
  final int? cpuMilli;
  final String? memoryBytes;
  final String? lastObservedAt;
  final String? createdAt;
  final String? updatedAt;

  bool get isApplication => kind == 'application';

  factory InfraResource.fromJson(Json json) {
    final spec = asMap(json['desiredSpec']);
    final limits = asMap(spec?['limits']);
    return InfraResource(
      id: asStringOr(json['id'], ''),
      nodeId: asStringOr(json['nodeId'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      customerId: asString(json['customerId']),
      templateId: asString(json['templateId']),
      templateName: asString(json['templateName']),
      applicationId: asString(json['applicationId']),
      releaseId: asString(json['releaseId']),
      releasePolicy: asString(json['releasePolicy']),
      externalId: asString(json['externalId']),
      kind: asStringOr(json['kind'], 'application'),
      name: asStringOr(json['name'], ''),
      classification: asStringOr(json['classification'], 'internal'),
      desiredState: asStringOr(json['desiredState'], 'unknown'),
      observedState: asStringOr(json['observedState'], 'unknown'),
      desiredRevision: asIntOr(json['desiredRevision'], 0),
      observedRevision: asIntOr(json['observedRevision'], 0),
      imageReference: asString(json['imageReference']),
      imageDigest: asString(json['imageDigest']),
      routeHostname: asString(json['routeHostname']),
      routeStatus: asString(json['routeStatus']),
      billingGateEnabled: asBool(json['billingGateEnabled']),
      cpuMilli: asInt(limits?['cpuMilli']),
      memoryBytes: asString(limits?['memoryBytes']),
      lastObservedAt: asString(json['lastObservedAt']),
      createdAt: asString(json['createdAt']),
      updatedAt: asString(json['updatedAt']),
    );
  }
}

class InfraOperation {
  const InfraOperation({
    required this.id,
    required this.nodeId,
    required this.nodeName,
    required this.action,
    required this.status,
    required this.attemptCount,
    required this.maxAttempts,
    required this.createdAt,
    this.nodeEnvironment = '',
    this.resourceId,
    this.resourceName,
    this.resourceKind,
    this.correlationId,
    this.nextAttemptAt,
    this.expiresAt,
    this.startedAt,
    this.completedAt,
    this.errorCode,
    this.errorMessage,
    this.updatedAt,
  });

  final String id;
  final String nodeId;
  final String nodeName;
  final String nodeEnvironment;
  final String? resourceId;
  final String? resourceName;
  final String? resourceKind;
  final String action;
  final String status;
  final String? correlationId;
  final int attemptCount;
  final int maxAttempts;
  final String? nextAttemptAt;
  final String? expiresAt;
  final String? startedAt;
  final String? completedAt;
  final String? errorCode;
  final String? errorMessage;
  final String createdAt;
  final String? updatedAt;

  bool get isPending => status == 'queued' || status == 'dispatched' || status == 'running';

  factory InfraOperation.fromJson(Json json) {
    return InfraOperation(
      id: asStringOr(json['id'], ''),
      nodeId: asStringOr(json['nodeId'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      nodeEnvironment: asStringOr(json['nodeEnvironment'], ''),
      resourceId: asString(json['resourceId']),
      resourceName: asString(json['resourceName']),
      resourceKind: asString(json['resourceKind']),
      action: asStringOr(json['action'], ''),
      status: asStringOr(json['status'], 'queued'),
      correlationId: asString(json['correlationId']),
      attemptCount: asIntOr(json['attemptCount'], 0),
      maxAttempts: asIntOr(json['maxAttempts'], 0),
      nextAttemptAt: asString(json['nextAttemptAt']),
      expiresAt: asString(json['expiresAt']),
      startedAt: asString(json['startedAt']),
      completedAt: asString(json['completedAt']),
      errorCode: asString(json['errorCode']),
      errorMessage: asString(json['errorMessage']),
      createdAt: asStringOr(json['createdAt'], ''),
      updatedAt: asString(json['updatedAt']),
    );
  }
}

class Registry {
  const Registry({
    required this.id,
    required this.name,
    required this.host,
    required this.username,
    required this.isActive,
    this.createdAt,
  });

  final String id;
  final String name;
  final String host;
  final String username;
  final bool isActive;
  final String? createdAt;

  factory Registry.fromJson(Json json) {
    return Registry(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      host: asStringOr(json['host'], ''),
      username: asStringOr(json['username'], ''),
      isActive: asBool(json['isActive'], fallback: true),
      createdAt: asString(json['createdAt']),
    );
  }
}

class DeployableApplication {
  const DeployableApplication({
    required this.id,
    required this.name,
    required this.slug,
    required this.repositoryUrl,
    required this.defaultBranch,
    required this.dockerfilePath,
    required this.buildContext,
    required this.imageStorage,
    required this.imageRepository,
    required this.autoDeploy,
    this.buildNodeId,
    this.registryId,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String name;
  final String slug;
  final String repositoryUrl;
  final String defaultBranch;
  final String dockerfilePath;
  final String buildContext;
  final String imageStorage;
  final String imageRepository;
  final String? buildNodeId;
  final String? registryId;
  final bool autoDeploy;
  final String? createdAt;
  final String? updatedAt;

  bool get usesLocalImage => imageStorage == 'local';

  factory DeployableApplication.fromJson(Json json) {
    return DeployableApplication(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      slug: asStringOr(json['slug'], ''),
      repositoryUrl: asStringOr(json['repositoryUrl'], ''),
      defaultBranch: asStringOr(json['defaultBranch'], 'main'),
      dockerfilePath: asStringOr(json['dockerfilePath'], 'Dockerfile'),
      buildContext: asStringOr(json['buildContext'], '.'),
      imageStorage: asStringOr(json['imageStorage'], 'local'),
      buildNodeId: asString(json['buildNodeId']),
      imageRepository: asStringOr(json['imageRepository'], ''),
      registryId: asString(json['registryId']),
      autoDeploy: asBool(json['autoDeploy']),
      createdAt: asString(json['createdAt']),
      updatedAt: asString(json['updatedAt']),
    );
  }
}

class ApplicationRelease {
  const ApplicationRelease({
    required this.id,
    required this.applicationId,
    required this.version,
    required this.commitSha,
    required this.imageDigest,
    required this.imageReference,
    this.localNodeId,
    this.createdAt,
  });

  final String id;
  final String applicationId;
  final String version;
  final String commitSha;
  final String imageDigest;
  final String imageReference;
  final String? localNodeId;
  final String? createdAt;

  factory ApplicationRelease.fromJson(Json json) {
    return ApplicationRelease(
      id: asStringOr(json['id'], ''),
      applicationId: asStringOr(json['applicationId'], ''),
      version: asStringOr(json['version'], ''),
      commitSha: asStringOr(json['commitSha'], ''),
      imageDigest: asStringOr(json['imageDigest'], ''),
      imageReference: asStringOr(json['imageReference'], ''),
      localNodeId: asString(json['localNodeId']),
      createdAt: asString(json['createdAt']),
    );
  }
}

class ApplicationBuild {
  const ApplicationBuild({
    required this.id,
    required this.applicationId,
    required this.nodeId,
    required this.nodeName,
    required this.status,
    required this.version,
    this.releaseId,
    this.commitSha,
    this.imageDigest,
    this.imageReference,
    this.logExcerpt,
    this.errorCode,
    this.errorMessage,
    this.startedAt,
    this.completedAt,
    this.createdAt,
  });

  final String id;
  final String applicationId;
  final String nodeId;
  final String nodeName;
  final String? releaseId;
  final String status;
  final String version;
  final String? commitSha;
  final String? imageDigest;
  final String? imageReference;
  final String? logExcerpt;
  final String? errorCode;
  final String? errorMessage;
  final String? startedAt;
  final String? completedAt;
  final String? createdAt;

  factory ApplicationBuild.fromJson(Json json) {
    return ApplicationBuild(
      id: asStringOr(json['id'], ''),
      applicationId: asStringOr(json['applicationId'], ''),
      nodeId: asStringOr(json['nodeId'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      releaseId: asString(json['releaseId']),
      status: asStringOr(json['status'], 'queued'),
      version: asStringOr(json['version'], ''),
      commitSha: asString(json['commitSha']),
      imageDigest: asString(json['imageDigest']),
      imageReference: asString(json['imageReference']),
      logExcerpt: asString(json['logExcerpt']),
      errorCode: asString(json['errorCode']),
      errorMessage: asString(json['errorMessage']),
      startedAt: asString(json['startedAt']),
      completedAt: asString(json['completedAt']),
      createdAt: asString(json['createdAt']),
    );
  }
}

class ReleaseResource {
  const ReleaseResource({
    required this.id,
    required this.name,
    required this.nodeId,
    required this.nodeName,
    required this.desiredRevision,
    required this.observedRevision,
    this.applicationId,
    this.releaseId,
    this.releasePolicy,
    this.imageReference,
    this.observedState = 'unknown',
    this.accessUrl,
  });

  final String id;
  final String name;
  final String nodeId;
  final String nodeName;
  final String? applicationId;
  final String? releaseId;
  final String? releasePolicy;
  final String? imageReference;
  final String observedState;
  final int desiredRevision;
  final int observedRevision;
  final String? accessUrl;

  factory ReleaseResource.fromJson(Json json) {
    return ReleaseResource(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      nodeId: asStringOr(json['nodeId'], ''),
      nodeName: asStringOr(json['nodeName'], ''),
      applicationId: asString(json['applicationId']),
      releaseId: asString(json['releaseId']),
      releasePolicy: asString(json['releasePolicy']),
      imageReference: asString(json['imageReference']),
      observedState: asStringOr(json['observedState'], 'unknown'),
      desiredRevision: asIntOr(json['desiredRevision'], 0),
      observedRevision: asIntOr(json['observedRevision'], 0),
      accessUrl: asString(json['accessUrl']),
    );
  }
}

/// Mirrors `InfrastructureReleaseService.catalog()`.
class ApplicationCatalog {
  const ApplicationCatalog({
    required this.registries,
    required this.applications,
    required this.releases,
    required this.resources,
    required this.builds,
    required this.localBuilders,
    required this.builderAvailable,
  });

  final List<Registry> registries;
  final List<DeployableApplication> applications;
  final List<ApplicationRelease> releases;
  final List<ReleaseResource> resources;
  final List<ApplicationBuild> builds;
  final List<BuilderNode> localBuilders;
  final bool builderAvailable;

  static const ApplicationCatalog empty = ApplicationCatalog(
    registries: <Registry>[],
    applications: <DeployableApplication>[],
    releases: <ApplicationRelease>[],
    resources: <ReleaseResource>[],
    builds: <ApplicationBuild>[],
    localBuilders: <BuilderNode>[],
    builderAvailable: false,
  );

  List<ApplicationRelease> releasesFor(String applicationId) =>
      releases.where((release) => release.applicationId == applicationId).toList(growable: false);

  List<ApplicationBuild> buildsFor(String applicationId) =>
      builds.where((build) => build.applicationId == applicationId).toList(growable: false);

  List<ReleaseResource> resourcesFor(String applicationId) =>
      resources.where((resource) => resource.applicationId == applicationId).toList(growable: false);

  factory ApplicationCatalog.fromJson(Json json) {
    return ApplicationCatalog(
      registries: asMapList(json['registries']).map(Registry.fromJson).toList(),
      applications: asMapList(json['applications']).map(DeployableApplication.fromJson).toList(),
      releases: asMapList(json['releases']).map(ApplicationRelease.fromJson).toList(),
      resources: asMapList(json['resources']).map(ReleaseResource.fromJson).toList(),
      builds: asMapList(json['builds']).map(ApplicationBuild.fromJson).toList(),
      localBuilders: asMapList(json['localBuilders']).map(BuilderNode.fromJson).toList(),
      builderAvailable: asBool(json['builderAvailable']),
    );
  }
}

class BuilderNode {
  const BuilderNode({required this.id, required this.name, required this.ready});

  final String id;
  final String name;
  final bool ready;

  factory BuilderNode.fromJson(Json json) {
    return BuilderNode(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      ready: asBool(json['ready']),
    );
  }
}
