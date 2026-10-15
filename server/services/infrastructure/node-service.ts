import { createHash, randomBytes } from 'node:crypto'
import type {
  AgentHeartbeatInput,
  AgentInventoryInput,
  CreateNodeEnrollmentInput,
  EnrollNodeInput,
} from '../../../shared/schemas/infrastructure'
import { InfrastructureControlRepository } from '../../repositories/infrastructure-control'
import { DomainError } from '../../utils/errors'
import { isUbuntuRelease } from './policy'

export const AGENT_PROTOCOL_VERSION = '1'

type ControlRepository = Pick<
  InfrastructureControlRepository,
  | 'listNodes'
  | 'createEnrollment'
  | 'consumeEnrollment'
  | 'findIdentity'
  | 'recordHeartbeat'
  | 'recordInventory'
  | 'revokeNode'
>

export class InfrastructureNodeService {
  constructor(
    private readonly repository: ControlRepository = new InfrastructureControlRepository(),
  ) {}

  listNodes() {
    return this.repository.listNodes()
  }

  async createEnrollment(input: CreateNodeEnrollmentInput, actorUserId: string) {
    if (input.environment === 'production') {
      throw DomainError.invalidState('Enrollment production belum diaktifkan pada fase ini.')
    }
    const token = `oc_enroll_${randomBytes(32).toString('base64url')}`
    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000)
    const enrollment = await this.repository.createEnrollment({
      ...input,
      actorUserId,
      tokenHash: hashCredential(token),
      expiresAt,
    })

    return {
      ...enrollment,
      expiresAt: enrollment.expiresAt.toISOString(),
      createdAt: enrollment.createdAt.toISOString(),
      token,
    }
  }

  async enroll(input: EnrollNodeInput) {
    if (!isUbuntuRelease(input.osRelease)) {
      throw DomainError.validation('Agent hanya dapat di-enroll dari Ubuntu Server.')
    }
    if (input.protocolVersion !== AGENT_PROTOCOL_VERSION) {
      throw DomainError.invalidState(
        `Protocol agent ${input.protocolVersion} tidak kompatibel; versi yang didukung ${AGENT_PROTOCOL_VERSION}.`,
      )
    }

    const credential = `oc_agent_${randomBytes(48).toString('base64url')}`
    const credentialHash = hashCredential(credential)
    const result = await this.repository.consumeEnrollment({
      tokenHash: hashCredential(input.token),
      credentialHash,
      fingerprint: credentialHash.slice(0, 32),
      node: {
        agentVersion: input.agentVersion,
        protocolVersion: input.protocolVersion,
        osRelease: input.osRelease,
        architecture: input.architecture,
        dockerVersion: input.dockerVersion,
        composeVersion: input.composeVersion,
      },
    })

    if (!result) {
      throw DomainError.authentication()
    }

    return { ...result, credential, protocolVersion: AGENT_PROTOCOL_VERSION }
  }

  async authenticate(credential: string) {
    if (!credential.startsWith('oc_agent_')) return null
    return this.repository.findIdentity(hashCredential(credential))
  }

  async heartbeat(nodeId: string, input: AgentHeartbeatInput) {
    if (!isUbuntuRelease(input.osRelease)) {
      throw DomainError.validation('Heartbeat ditolak karena host bukan Ubuntu Server.')
    }
    if (input.protocolVersion !== AGENT_PROTOCOL_VERSION) {
      throw DomainError.invalidState('Versi protocol agent tidak kompatibel.')
    }

    const result = await this.repository.recordHeartbeat(nodeId, input)
    if (!result) throw DomainError.notFound('Node tidak aktif atau tidak ditemukan.')
    return result
  }

  async inventory(nodeId: string, input: AgentInventoryInput) {
    const result = await this.repository.recordInventory(nodeId, input)
    if (!result) throw DomainError.notFound('Node tidak aktif atau tidak ditemukan.')
    return result
  }

  async revoke(nodeId: string, actorUserId: string) {
    const result = await this.repository.revokeNode(nodeId, actorUserId)
    if (!result) throw DomainError.notFound('Node tidak ditemukan.')
    return result
  }
}

export function hashCredential(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
