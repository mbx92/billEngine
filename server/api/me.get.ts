import type { ApiCurrentUser } from '../../shared/types/api'

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
  const data: ApiCurrentUser = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    customerId: session.user.customerId ?? null,
  }
  return { data }
})
