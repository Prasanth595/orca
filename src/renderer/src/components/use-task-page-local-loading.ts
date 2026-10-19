import { useEffect } from 'react'
import type { LocalTask } from '../../../shared/local-task'
import { listLocalTasks } from '@/runtime/runtime-local-task-client'

type LocalLoadingInput = {
  taskSource: string
  localTaskSourceProjectId: string | null
  setLocalTasks: (updater: (tasks: LocalTask[]) => LocalTask[]) => void
  setLocalTasksLoading: (loading: boolean) => void
  setLocalTasksError: (error: string | null) => void
}
// Why keyed on project id: switching projects must clear the previous
// project's tasks before the new load lands, or the board flashes stale rows.
export function useTaskPageLocalLoading<Model extends LocalLoadingInput>(model: Model): Model {
  const {
    taskSource,
    localTaskSourceProjectId,
    setLocalTasks,
    setLocalTasksLoading,
    setLocalTasksError
  } = model
  useEffect(() => {
    if (taskSource !== 'local') {
      return
    }
    if (!localTaskSourceProjectId) {
      setLocalTasks(() => [])
      setLocalTasksLoading(false)
      setLocalTasksError(null)
      return
    }
    let cancelled = false
    setLocalTasks(() => [])
    setLocalTasksLoading(true)
    setLocalTasksError(null)
    listLocalTasks(localTaskSourceProjectId).then(
      (tasks) => {
        if (cancelled) {
          return
        }
        setLocalTasks(() => tasks)
        setLocalTasksLoading(false)
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        setLocalTasks(() => [])
        setLocalTasksLoading(false)
        setLocalTasksError(error instanceof Error ? error.message : 'Failed to load local tasks')
      }
    )
    return () => {
      cancelled = true
    }
  }, [
    taskSource,
    localTaskSourceProjectId,
    setLocalTasks,
    setLocalTasksLoading,
    setLocalTasksError
  ])
  return model
}
