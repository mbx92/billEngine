export default defineNuxtRouteMiddleware(async (to) => {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  const { data } = await useFetch('/api/auth/get-session', { headers })

  if (!data.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
