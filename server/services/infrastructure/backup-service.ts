import { randomUUID } from 'node:crypto'
import type {
  CreateBackupPolicyInput,
  CreateBackupTargetInput,
} from '../../../shared/schemas/backups'
import { BackupManagementRepository } from '../../repositories/backup-management'
import { ResendEmailClient } from '../../integrations/email/resend-client'
import { encryptInfrastructureCredential } from '../../utils/credentials'
import { DomainError } from '../../utils/errors'
import { NativeDatabaseClusterService } from './native-database-cluster-service'

export class InfrastructureBackupService {
  constructor(
    private readonly repository = new BackupManagementRepository(),
    private readonly databases = new NativeDatabaseClusterService(),
  ) {}

  overview() {
    return this.repository.overview()
  }

  async createTarget(input: CreateBackupTargetInput, actorUserId: string) {
    try {
      return await this.repository.createTarget({
        id: randomUUID(),
        actorUserId,
        name: input.name,
        endpoint: input.endpoint.replace(/\/+$/, ''),
        region: input.region,
        bucket: input.bucket,
        prefix: input.prefix.replace(/^\/+|\/+$/g, ''),
        pathStyle: input.pathStyle,
        accessKeyEncrypted: encryptInfrastructureCredential(input.accessKey),
        secretKeyEncrypted: encryptInfrastructureCredential(input.secretKey),
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw DomainError.conflict('Nama backup target sudah digunakan.')
      throw error
    }
  }

  async createPolicy(input: CreateBackupPolicyInput, actorUserId: string) {
    try {
      const policy = await this.repository.createPolicy({
        ...input,
        id: randomUUID(),
        actorUserId,
      })
      if (!policy) {
        throw DomainError.validation('Database workload atau storage target tidak tersedia.')
      }
      return policy
    } catch (error) {
      if (isUniqueViolation(error)) throw DomainError.conflict('Nama backup policy sudah digunakan.')
      throw error
    }
  }

  async runScheduled(now = new Date()) {
    const policies = await this.repository.listDuePolicies(now)
    const result = { queued: 0, failed: 0 }
    for (const policy of policies) {
      try {
        if (!policy.actorUserId) throw new Error('Backup policy owner no longer exists.')
        await this.databases.createBackup(
          policy.serviceDatabaseId,
          policy.actorUserId,
          `backup-policy:${policy.id}:${policy.scheduledAt.toISOString()}`,
          {
            policyId: policy.id,
            storageTargetId: policy.storageTargetId,
            endpoint: policy.targetEndpoint,
            region: policy.targetRegion,
            bucket: policy.targetBucket,
            prefix: policy.targetPrefix,
            pathStyle: policy.targetPathStyle,
          },
        )
        result.queued += 1
      } catch (error) {
        result.failed += 1
        console.error('[backup-scheduler]', policy.id, error)
        await this.deliverPolicyFailure(
          policy.alertEmail,
          policy.id,
          policy.scheduledAt,
          policy.policyName,
          policy.databaseName,
          error,
        )
      } finally {
        await this.repository.advancePolicy(
          policy.id,
          policy.scheduledAt,
          policy.intervalMinutes,
        )
      }
    }
    await this.deliverAlerts()
    return result
  }

  private async deliverAlerts() {
    const config = useRuntimeConfig()
    if (!config.resendApiKey || !config.emailFrom) return
    const alerts = await this.repository.listPendingAlerts()
    const client = new ResendEmailClient(String(config.resendApiKey))
    for (const alert of alerts) {
      if (!alert.email) continue
      try {
        await client.send({
          from: String(config.emailFrom),
          to: alert.email,
          subject: `Backup gagal: ${alert.databaseName}`,
          idempotencyKey: `backup-failed:${alert.backupId}`,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17202b">
            <h2>Backup workload gagal</h2>
            <p>Policy <strong>${escapeHtml(alert.policyName)}</strong> gagal melindungi database <code>${escapeHtml(alert.databaseName)}</code>.</p>
            <p>Error: ${escapeHtml(alert.error || 'Tidak ada detail error.')}</p>
            <p>Run ID: <code>${alert.backupId}</code></p>
          </div>`,
        })
        await this.repository.markAlertSent(alert.backupId)
      } catch (error) {
        console.error('[backup-alert]', alert.backupId, error)
      }
    }
  }

  private async deliverPolicyFailure(
    email: string | null,
    policyId: string,
    scheduledAt: Date,
    policyName: string,
    databaseName: string,
    error: unknown,
  ) {
    const config = useRuntimeConfig()
    if (!email || !config.resendApiKey || !config.emailFrom) return
    const message = error instanceof Error ? error.message : 'Unknown scheduler error.'
    try {
      await new ResendEmailClient(String(config.resendApiKey)).send({
        from: String(config.emailFrom),
        to: email,
        subject: `Backup tidak dapat dijadwalkan: ${databaseName}`,
        idempotencyKey: `backup-schedule-failed:${policyId}:${scheduledAt.toISOString()}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17202b">
          <h2>Scheduled backup gagal dimulai</h2>
          <p>Policy <strong>${escapeHtml(policyName)}</strong> untuk database <code>${escapeHtml(databaseName)}</code> tidak dapat membuat operation.</p>
          <p>Error: ${escapeHtml(message)}</p>
        </div>`,
      })
    } catch (deliveryError) {
      console.error('[backup-policy-alert]', policyId, deliveryError)
    }
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
