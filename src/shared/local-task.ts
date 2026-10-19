export type LocalTaskStatus = 'todo' | 'in-progress' | 'done'

export const LOCAL_TASK_STATUSES: readonly LocalTaskStatus[] = ['todo', 'in-progress', 'done']

export const LOCAL_TASK_STATUS_LABELS: Record<LocalTaskStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done'
}

export function isLocalTaskStatus(value: unknown): value is LocalTaskStatus {
  return value === 'todo' || value === 'in-progress' || value === 'done'
}
// Why: the canonical local-task essence shared by deep links, nav history, and
// detail routing. Timestamps are ms-epoch numbers per persisted-state convention.
export type LocalTask = {
  id: number
  url: string
  title: string
  description: string
  status: LocalTaskStatus
  createdAt: number
  updatedAt: number
}
