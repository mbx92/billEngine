import type { H3Event } from 'h3'
import { InfrastructureNodeService } from '../services/infrastructure/node-service'
import { DomainError } from './errors'

export async function requireAgent(event: H3Event) {
  const authorization = event.headers.get('authorization') ?? ''
  const [scheme, credential] = authorization.split(' ', 2)
  if (scheme?.toLowerCase() !== 'bearer' || !credential) throw DomainError.authentication()

  const identity = await new InfrastructureNodeService().authenticate(credential)
  if (!identity) throw DomainError.authentication()
  return identity
}
