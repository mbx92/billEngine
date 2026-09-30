import { uuidSchema } from '../../../shared/schemas/common'
import { updateUserAccessSchema } from '../../../shared/schemas/users'
import { UserService } from '../../services/users/user-service'

export default defineEventHandler(async (event) => {
  const session = await requireSuperAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = updateUserAccessSchema.parse(await readBody(event))
  const user = await new UserService().updateAccess(id, input, session.user.id)
  return { data: { id: user.id, role: user.role, customerId: user.customerId } }
})
