import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { ServiceStatus } from '../../../shared/constants/domain'
import type { Transaction } from '../../database/client'
import {
  infrastructureOperations,
  infrastructureResources,
  serviceResources,
  services,
} from '../../database/schema'

/** The caller owns the transaction: entitlement and every operation commit together. */
export class InfrastructureLifecycleService {
  async apply(
    transaction: Transaction,
    serviceId: string,
    targetStatus: Extract<ServiceStatus, 'active' | 'suspended'>,
    actorUserId: string | null,
  ) {
    const links = await transaction
      .select({ id: serviceResources.resourceId })
      .from(serviceResources)
      .where(eq(serviceResources.serviceId, serviceId))
    const resources = links.length
      ? await transaction
          .select()
          .from(infrastructureResources)
          .where(
            and(
              inArray(
                infrastructureResources.id,
                links.map((link) => link.id),
              ),
              isNull(infrastructureResources.deletedAt),
            ),
          )
          .orderBy(asc(infrastructureResources.id))
          .for('update')
      : []
    const correlationId = randomUUID()
    for (const resource of resources) {
      // A database provisioning result owns the first application deployment.
      // It will consult the current entitlement before queuing that deployment.
      const databasePending = resource.labels['oc.deployment-gate'] === 'database'
      const revision = resource.desiredRevision + 1
      const running = targetStatus === 'active'
      await transaction
        .update(infrastructureResources)
        .set({
          desiredState: running ? (databasePending ? 'pending' : 'running') : 'stopped',
          desiredRevision: revision,
          updatedAt: new Date(),
        })
        .where(eq(infrastructureResources.id, resource.id))
      await transaction
        .update(infrastructureOperations)
        .set({
          status: 'cancelled',
          errorCode: 'superseded',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(infrastructureOperations.resourceId, resource.id),
            eq(infrastructureOperations.status, 'queued'),
            inArray(infrastructureOperations.action, [
              'application.start',
              'application.stop',
              'application.restart',
              'application.ensure',
              'application.redeploy',
            ]),
          ),
        )
      if (running && databasePending) continue
      const ensure = running && resource.externalId.startsWith('pending:')
      await transaction.insert(infrastructureOperations).values({
        nodeId: resource.nodeId,
        resourceId: resource.id,
        actorUserId,
        correlationId,
        idempotencyKey: `service:${serviceId}:${resource.id}:${revision}`,
        action: ensure ? 'application.ensure' : running ? 'application.start' : 'application.stop',
        expectedResourceRevision: revision,
        // Queue lifetime is separate from the execution deadline assigned at dispatch.
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        payload: ensure
          ? {
              resourceId: resource.id,
              name: resource.name,
              kind: resource.kind,
              revision,
              spec: resource.desiredSpec,
            }
          : { resourceId: resource.id, revision },
      })
    }
    await transaction
      .update(services)
      .set({
        infrastructureStatus: resources.length ? 'pending' : 'ready',
        infrastructureError: null,
      })
      .where(eq(services.id, serviceId))
    return { affectedCount: resources.length }
  }
}
