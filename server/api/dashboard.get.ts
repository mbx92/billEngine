import { DashboardService } from '../services/dashboard/dashboard-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new DashboardService().overview() }
})
