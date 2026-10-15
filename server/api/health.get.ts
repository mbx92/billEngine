export default defineEventHandler(() => ({
  status: 'ok',
  service: 'oc-infrastructure-platform',
  timestamp: new Date().toISOString(),
}))
