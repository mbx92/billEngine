import { and, asc, count, eq } from 'drizzle-orm'
import type { CreatePlanInput, UpdatePlanInput } from '../../shared/schemas/plans'
import type { ApiPlan, ApiPlanOption } from '../../shared/types/api'
import { useDatabase, type Database, type Transaction } from '../database/client'
import { plans, services } from '../database/schema'

type QueryExecutor = Database | Transaction

export type PlanRecord = typeof plans.$inferSelect

export class PlanRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async list(page: number, perPage: number) {
    const offset = (page - 1) * perPage
    const [rows, totals] = await Promise.all([
      this.database
        .select({
          id: plans.id,
          name: plans.name,
          description: plans.description,
          currency: plans.currency,
          priceAmount: plans.priceAmount,
          billingCycle: plans.billingCycle,
          inclusions: plans.inclusions,
          includedResourceCount: plans.includedResourceCount,
          includedCpuCores: plans.includedCpuCores,
          includedMemoryBytes: plans.includedMemoryBytes,
          databaseMode: plans.databaseMode,
          isActive: plans.isActive,
          serviceCount: count(services.id),
          createdAt: plans.createdAt,
          updatedAt: plans.updatedAt,
        })
        .from(plans)
        .leftJoin(services, eq(services.planId, plans.id))
        .groupBy(plans.id)
        .orderBy(asc(plans.name))
        .limit(perPage)
        .offset(offset),
      this.database.select({ total: count() }).from(plans),
    ])

    return {
      rows: rows.map<ApiPlan>((row) => ({
        ...row,
        priceAmount: row.priceAmount.toString(),
        includedMemoryBytes: row.includedMemoryBytes?.toString() ?? null,
        serviceCount: Number(row.serviceCount),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total: totals[0]?.total ?? 0,
    }
  }

  async listActiveOptions(): Promise<ApiPlanOption[]> {
    const rows = await this.database
      .select({
        id: plans.id,
        name: plans.name,
        description: plans.description,
        currency: plans.currency,
        priceAmount: plans.priceAmount,
        billingCycle: plans.billingCycle,
        inclusions: plans.inclusions,
        includedResourceCount: plans.includedResourceCount,
        includedCpuCores: plans.includedCpuCores,
        includedMemoryBytes: plans.includedMemoryBytes,
        databaseMode: plans.databaseMode,
      })
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(asc(plans.name))

    return rows.map((row) => ({
      ...row,
      priceAmount: row.priceAmount.toString(),
      includedMemoryBytes: row.includedMemoryBytes?.toString() ?? null,
    }))
  }

  async findActiveById(transaction: QueryExecutor, id: string): Promise<PlanRecord | null> {
    const [plan] = await transaction
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.isActive, true)))
      .limit(1)
    return plan ?? null
  }

  async create(input: CreatePlanInput) {
    const [created] = await this.database.insert(plans).values(input).returning()
    if (!created) throw new Error('Failed to create plan.')
    return created
  }

  async update(id: string, input: UpdatePlanInput) {
    const [updated] = await this.database
      .update(plans)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning()
    return updated ?? null
  }
}
