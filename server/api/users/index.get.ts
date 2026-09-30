import { UserService } from '../../services/users/user-service'

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event)
  return { data: await new UserService().list() }
})
