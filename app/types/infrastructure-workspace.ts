export interface WorkspaceApplication {
  id: string
  name: string
  repositoryUrl: string
  defaultBranch: string
  imageStorage: 'local' | 'registry'
}

export interface WorkspaceRelease {
  id: string
  applicationId: string
  version: string
  commitSha: string
  imageReference: string
  createdAt: string
}

export interface WorkspaceBuild {
  id: string
  applicationId: string
  status: string
  version: string
  releaseId: string | null
  errorMessage: string | null
  createdAt: string
}

export interface WorkspaceCatalog {
  applications: WorkspaceApplication[]
  releases: WorkspaceRelease[]
  builds: WorkspaceBuild[]
  resources: Array<{ id: string; accessUrl: string | null; shellAvailable: boolean }>
}

export interface WorkspaceResource {
  id: string
  name: string
  applicationId: string | null
  releaseId: string | null
  serviceId: string | null
  nodeId: string
  nodeName: string
  kind: string
  classification: string
  desiredState: string
  observedState: string
  desiredRevision: number
  observedRevision: number
  imageReference: string | null
  routeHostname: string | null
  routeStatus: string | null
  lastObservedAt: string | null
  desiredSpec: {
    ports?: Array<{ containerPort: number; hostPort?: number; protocol: string }>
    environment?: Record<string, string>
    secretReferences?: Record<string, string>
    healthcheck?: { path: string; port: number }
    volumes?: Array<{ name: string; mountTarget: string; kind: string }>
  }
}
