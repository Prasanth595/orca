import type { LocalTask, LocalTaskStatus } from '../../../shared/local-task'
// Why a thin wrapper, not direct window.api calls: the board, dialogs, and
// deep links share one import surface, so a future remote-host transport only
// changes this module.
export function listLocalTasks(projectId: string): Promise<LocalTask[]> {
  return window.api.localTasks.list({ projectId })
}

export function createLocalTask(args: {
  projectId: string
  title: string
  description?: string
  status?: LocalTaskStatus
}): Promise<LocalTask> {
  return window.api.localTasks.create(args)
}

export function updateLocalTask(args: {
  projectId: string
  id: number
  title?: string
  description?: string | null
  status?: LocalTaskStatus
}): Promise<LocalTask | null> {
  return window.api.localTasks.update(args)
}

export function deleteLocalTask(projectId: string, id: number): Promise<boolean> {
  return window.api.localTasks.remove({ projectId, id })
}
