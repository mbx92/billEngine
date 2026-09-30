export default defineNuxtRouteMiddleware(async (to) => {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  const { data } = await useFetch<{
    user: { role: 'super_admin' | 'admin' | 'customer' }
  } | null>('/api/auth/get-session', { headers })

  if (!data.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }

  if (data.value.user.role === 'customer' && !to.path.startsWith('/portal')) {
    return navigateTo('/portal')
  }
  if (data.value.user.role !== 'customer' && to.path.startsWith('/portal')) {
    return navigateTo('/')
  }
})
