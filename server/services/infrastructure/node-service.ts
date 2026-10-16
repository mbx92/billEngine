import { createHash, randomBytes } from 'node:crypto'
import type {
  AgentHeartbeatInput,
  AgentInventoryInput,
  CreateNodeEnrollmentInput,
  EnrollNodeInput,
} from '../../../shared/schemas/infrastructure'
import { InfrastructureControlRepository } from '../../repositories/infrastructure-control'
import { DomainError } from '../../utils/errors'
import {
  compareSemanticVersions,
  configuredAgentReleaseVersion,
  isAgentArtifactReady,
  isSupportedAgentArchitecture,
  readAgentArtifact,
  supportsRemoteAgentUpdate,
} from './agent-artifact-service'
import { isUbuntuRelease } from './policy'

export const AGENT_PROTOCOL_VERSION = '1'
const DEFAULT_GATEWAY_IMAGE = 'traefik:v3.7.14'

type ControlRepository = Pick<
  InfrastructureControlRepository,
  | 'listNodes'
  | 'createEnrollment'
  | 'consumeEnrollment'
  | 'findIdentity'
  | 'recordHeartbeat'
  | 'recordInventory'
  | 'revokeNode'
  | 'findNodeForAgentOperation'
  | 'queueAgentOperation'
>

export class InfrastructureNodeService {
  constructor(
    private readonly repository: ControlRepository = new InfrastructureControlRepository(),
  ) {}

  async listNodes() {
    const runtimeConfig = useRuntimeConfig()
    const stuckMinutes = boundedNumber(runtimeConfig.operationStuckMinutes, 15, 1, 1440)
    const warningPercent = boundedNumber(runtimeConfig.nodeDiskWarningPercent, 80, 1, 99)
    const criticalPercent = boundedNumber(
      runtimeConfig.nodeDiskCriticalPercent,
      90,
      warningPercent + 1,
      100,
    )
    const nodes = await this.repository.listNodes(new Date(Date.now() - stuckMinutes * 60_000))
    const availableVersion = configuredAgentReleaseVersion()
    return Promise.all(
      nodes.map(async (node) => ({
        ...node,
        diskWatermark:
          node.diskUsageBasisPoints === null
            ? 'unknown'
            : node.diskUsageBasisPoints >= criticalPercent * 100
              ? 'critical'
              : node.diskUsageBasisPoints >= warningPercent * 100
                ? 'warning'
                : 'normal',
        availableAgentVersion: availableVersion,
        agentArtifactReady: await isAgentArtifactReady(node.architecture),
        remoteUpdateSupported: supportsRemoteAgentUpdate(node.agentVersion),
        upgradeAvailable: compareSemanticVersions(node.agentVersion, availableVersion) === -1,
      })),
    )
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
      gatewayImage: configuredGatewayImage(),
      node: {
        agentVersion: input.agentVersion,
        protocolVersion: input.protocolVersion,
        osRelease: input.osRelease,
        architecture: input.architecture,
        dockerVersion: input.dockerVersion,
        composeVersion: input.composeVersion,
        capabilities: input.capabilities ?? [],
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

    const result = await this.repository.recordHeartbeat(nodeId, input, configuredGatewayImage())
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

  async upgradeAgent(nodeId: string, actorUserId: string, idempotencyKey: string) {
    const node = await this.requireUpdatableNode(nodeId)
    if (!supportsRemoteAgentUpdate(node.agentVersion)) {
      throw DomainError.invalidState(
        'Agent ini belum memiliki updater. Jalankan ulang installer satu kali untuk bootstrap versi 0.8.0+.',
      )
    }
    if (!isSupportedAgentArchitecture(node.architecture)) {
      throw DomainError.invalidState(
        'Arsitektur node tidak mendukung artifact agent yang tersedia.',
      )
    }

    const targetVersion = configuredAgentReleaseVersion()
    const comparison = compareSemanticVersions(node.agentVersion, targetVersion)
    if (comparison === null) throw DomainError.invalidState('Versi agent node tidak valid.')
    if (comparison >= 0) {
      throw DomainError.invalidState(
        comparison === 0
          ? `Agent sudah menggunakan versi ${targetVersion}.`
          : `Downgrade ke ${targetVersion} harus menggunakan rollback yang tervalidasi.`,
      )
    }

    const { metadata } = await readAgentArtifact(node.architecture)
    const result = await this.repository.queueAgentOperation({
      nodeId,
      actorUserId,
      idempotencyKey,
      action: 'agent.upgrade',
      targetVersion,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        version: targetVersion,
        fromVersion: node.agentVersion,
        architecture: node.architecture,
        checksum: metadata.checksum,
        size: metadata.size,
      },
    })
    if (!result) throw DomainError.invalidState('Node tidak aktif atau sedang offline.')
    if (result.conflict) {
      throw DomainError.conflict('Node masih memiliki operation upgrade atau rollback aktif.')
    }
    return result
  }

  async rollbackAgent(nodeId: string, actorUserId: string, idempotencyKey: string) {
    const node = await this.requireUpdatableNode(nodeId)
    if (!supportsRemoteAgentUpdate(node.agentVersion)) {
      throw DomainError.invalidState('Versi agent ini belum mendukung rollback remote.')
    }
    if (!node.previousAgentVersion) {
      throw DomainError.invalidState('Node belum memiliki binary agent sebelumnya untuk rollback.')
    }
    if (!supportsRemoteAgentUpdate(node.previousAgentVersion)) {
      throw DomainError.invalidState(
        'Binary sebelumnya belum mendukung pelaporan rollback remote. Gunakan installer manual untuk recovery.',
      )
    }
    if (!isSupportedAgentArchitecture(node.architecture)) {
      throw DomainError.invalidState('Arsitektur node tidak didukung.')
    }

    const result = await this.repository.queueAgentOperation({
      nodeId,
      actorUserId,
      idempotencyKey,
      action: 'agent.rollback',
      targetVersion: node.previousAgentVersion,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      payload: {
        version: node.previousAgentVersion,
        fromVersion: node.agentVersion,
        architecture: node.architecture,
      },
    })
    if (!result) throw DomainError.invalidState('Node tidak aktif atau sedang offline.')
    if (result.conflict) {
      throw DomainError.conflict('Node masih memiliki operation upgrade atau rollback aktif.')
    }
    return result
  }

  private async requireUpdatableNode(nodeId: string) {
    const node = await this.repository.findNodeForAgentOperation(nodeId)
    if (!node) throw DomainError.notFound('Node tidak ditemukan.')
    const heartbeatIsFresh =
      node.lastHeartbeatAt && node.lastHeartbeatAt.getTime() >= Date.now() - 90_000
    if (!node.isActive || !['online', 'degraded'].includes(node.status) || !heartbeatIsFresh) {
      throw DomainError.invalidState('Agent hanya dapat diperbarui ketika node online.')
    }
    return node
  }
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

export function hashCredential(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function configuredGatewayImage() {
  return String(useRuntimeConfig().infrastructureGatewayImage || DEFAULT_GATEWAY_IMAGE)
}
