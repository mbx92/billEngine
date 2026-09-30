import { createUserSchema } from '../../../shared/schemas/users'
import { UserService } from '../../services/users/user-service'

export default defineEventHandler(async (event) => {
  const session = await requireSuperAdmin(event)
  const input = createUserSchema.parse(await readBody(event))
  const user = await new UserService().create(input, session.user.id)
  setResponseStatus(event, 201)
  return { data: { id: user.id, email: user.email, role: user.role } }
})
