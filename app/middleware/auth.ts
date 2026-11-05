import { loginDestination, type LoginRole } from '#shared/utils/login-destination'

export default defineNuxtRouteMiddleware(async (to) => {
  const session = await useRequestFetch()<{
    user: { role: LoginRole; customerId?: string | null }
  } | null>('/api/auth/get-session')

  if (!session) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }

  const destination = loginDestination(session.user.role, to.fullPath, session.user.customerId)
  if (destination !== to.fullPath) return navigateTo(destination)
})
