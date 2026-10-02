import type {
  CreateUserInput,
  UpdateUserAccessInput,
  UpdateUserPasswordInput,
} from '../../../shared/schemas/users'
import { useDatabase, type Database } from '../../database/client'
import { AuditLogRepository } from '../../repositories/audit'
import { CustomerRepository } from '../../repositories/customers'
import { UserRepository } from '../../repositories/users'
import { DomainError } from '../../utils/errors'

export class UserService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly users = new UserRepository(database),
    private readonly customers = new CustomerRepository(database),
    private readonly audit = new AuditLogRepository(database),
  ) {}

  async list() {
    const rows = await this.users.list()
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async create(input: CreateUserInput, actorUserId: string) {
    if (await this.users.findByEmail(input.email)) {
      throw DomainError.conflict('Email sudah digunakan.')
    }
    if (input.role === 'customer') await this.ensureActiveCustomer(input.customerId)

    return this.database.transaction(async (transaction) => {
      const created = await this.users.create(transaction, input)
      await this.audit.record(transaction, {
        actorUserId,
        action: 'user.created',
        entityType: 'user',
        entityId: created.id,
        afterData: { email: created.email, role: created.role, customerId: created.customerId },
      })
      return created
    })
  }

  async updateAccess(id: string, input: UpdateUserAccessInput, actorUserId: string) {
    return this.database.transaction(async (transaction) => {
      const existing = await this.users.findById(id, transaction)
      if (!existing) throw DomainError.notFound('User tidak ditemukan.')
      const nextRole = input.role ?? existing.role
      const nextCustomerId =
        nextRole === 'customer' ? (input.customerId ?? existing.customerId) : null
      if (nextRole === 'customer') await this.ensureActiveCustomer(nextCustomerId)
      if (
        existing.role === 'super_admin' &&
        nextRole !== 'super_admin' &&
        (await this.users.countOtherSuperAdmins(transaction, id)) === 0
      ) {
        throw DomainError.invalidState('Super admin terakhir tidak dapat diturunkan rolenya.')
      }

      const updated = await this.users.updateAccess(transaction, id, {
        role: nextRole,
        customerId: nextCustomerId,
      })
      await this.audit.record(transaction, {
        actorUserId,
        action: 'user.access_updated',
        entityType: 'user',
        entityId: id,
        beforeData: { role: existing.role, customerId: existing.customerId },
        afterData: { role: updated.role, customerId: updated.customerId },
      })
      return updated
    })
  }

  async updatePassword(id: string, input: UpdateUserPasswordInput, actorUserId: string) {
    return this.database.transaction(async (transaction) => {
      const existing = await this.users.findById(id, transaction)
      if (!existing) throw DomainError.notFound('User tidak ditemukan.')

      await this.users.updatePassword(transaction, id, input.password)
      await this.audit.record(transaction, {
        actorUserId,
        action: 'user.password_updated',
        entityType: 'user',
        entityId: id,
        afterData: { email: existing.email },
      })
      return { id: existing.id, email: existing.email }
    })
  }

  private async ensureActiveCustomer(customerId: string | null | undefined) {
    if (!customerId) throw DomainError.validation('Customer wajib dipilih.')
    const customer = await this.customers.findById(customerId)
    if (!customer || customer.status !== 'active') {
      throw DomainError.validation('Customer aktif tidak ditemukan.')
    }
  }
}
