import type { CreatePlanInput, UpdatePlanInput } from '../../../shared/schemas/plans'
import { PlanRepository } from '../../repositories/plans'
import { DomainError } from '../../utils/errors'

export class PlanCatalogService {
  constructor(private readonly repository = new PlanRepository()) {}

  list(page: number, perPage: number) {
    return this.repository.list(page, perPage)
  }

  async create(input: CreatePlanInput) {
    return this.repository.create(input)
  }

  async update(id: string, input: UpdatePlanInput) {
    const updated = await this.repository.update(id, input)
    if (!updated) throw DomainError.notFound('Plan tidak ditemukan.')
    return updated
  }
}
