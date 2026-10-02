import { uuidSchema } from '../../../../shared/schemas/common'
import { updateUserPasswordSchema } from '../../../../shared/schemas/users'
import { UserService } from '../../../services/users/user-service'

export default defineEventHandler(async (event) => {
  const session = await requireSuperAdmin(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const input = updateUserPasswordSchema.parse(await readBody(event))
  const user = await new UserService().updatePassword(id, input, session.user.id)
  return { data: { id: user.id, email: user.email } }
})
