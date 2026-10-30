export interface ApplicationEnvironmentSnapshot {
  resourceId: string
  name: string
  revision: number
  observedRevision: number
  secretDelivery: 'files' | 'environment'
  variables: Array<{ key: string; value?: string; secret: boolean; managed: boolean }>
}

export interface ApplicationEnvironmentSaveResult {
  operation: { id: string; status: string }
  revision: number
  replayed: boolean
}
