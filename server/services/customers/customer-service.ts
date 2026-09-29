import type { CreateCustomerInput } from '../../../shared/schemas/customers'
import { CustomerRepository } from '../../repositories/customers'

export class CustomerService {
  constructor(private readonly repository = new CustomerRepository()) {}

  list(page: number, perPage: number) {
    return this.repository.list(page, perPage)
  }

  async create(input: CreateCustomerInput) {
    return this.repository.create(input)
  }
}
