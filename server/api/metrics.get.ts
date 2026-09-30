import { MetricsService } from '../services/monitoring/metrics-service'
import { DomainError } from '../utils/errors'

export default defineEventHandler(async (event) => {
  const token = String(useRuntimeConfig().metricsToken || '')
  if (token && getHeader(event, 'authorization') !== `Bearer ${token}`) {
    throw DomainError.authentication()
  }

  setResponseHeader(event, 'content-type', 'text/plain; version=0.0.4; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return new MetricsService().renderPrometheus()
})
