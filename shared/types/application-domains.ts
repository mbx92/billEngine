import type { ApiCloudflareTunnel, ApiCloudflareTunnelRoute } from './api'

export interface ApplicationDomains {
  resource: {
    id: string
    name: string
    nodeName: string
    revision: number
    gatewayStatus: string
    ports: number[]
  }
  configured: boolean
  tunnels: ApiCloudflareTunnel[]
  warnings: string[]
  domains: Array<{
    hostname: string
    source: 'route' | 'app_url'
    targetPort: number | null
    routeStatus: string | null
    dns: {
      status: 'record' | 'missing' | 'unavailable'
      type?: string
      target?: string
      proxied?: boolean
    }
    matches: Array<{ tunnel: ApiCloudflareTunnel; route: ApiCloudflareTunnelRoute }>
  }>
}
