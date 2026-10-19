import type { LocalTask, LocalTaskStatus } from '../../shared/local-task'

export type LocalTaskApi = {
  list: (args: { projectId: string }) => Promise<LocalTask[]>
  create: (args: {
    projectId: string
    title: string
    description?: string
    status?: LocalTaskStatus
  }) => Promise<LocalTask>
  update: (args: {
    projectId: string
    id: number
    title?: string
    description?: string | null
    status?: LocalTaskStatus
  }) => Promise<LocalTask | null>
  remove: (args: { projectId: string; id: number }) => Promise<boolean>
}
