import { ActivityRepository } from '../../repositories/activity'

export class ActivityService {
  constructor(private readonly repository = new ActivityRepository()) {}

  listAuditLogs(page: number, perPage: number) {
    return this.repository.listAuditLogs(page, perPage)
  }

  listJobRuns(limit = 10) {
    return this.repository.listJobRuns(limit)
  }
}
