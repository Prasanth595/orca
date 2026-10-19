import { useCallback } from 'react'
import type { LocalTask, LocalTaskStatus } from '../../../shared/local-task'
import {
  listLocalTasks,
  createLocalTask,
  updateLocalTask,
  deleteLocalTask
} from '@/runtime/runtime-local-task-client'

type LocalMutationsInput = {
  taskSource: string
  localTaskSourceProjectId: string | null
  setLocalTasks: (updater: (tasks: LocalTask[]) => LocalTask[]) => void
  setLocalTasksLoading: (loading: boolean) => void
  setLocalTasksError: (error: string | null) => void
  setLocalTaskDialog: (dialog: null) => void
}

function isRevisionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  const code = (error as { code?: unknown }).code
  // Canonical code is 'profile-state-revision-conflict'; accept the short
  // form too since IPC serialization may drop custom error classes.
  return code === 'profile-state-revision-conflict' || code === 'revision-conflict'
}

// Why single refresh path: the loading hook owns re-listing, so mutations
// patch state locally from the returned row and only re-list on conflict.
export function useTaskPageLocalMutations(model: LocalMutationsInput) {
  const {
    taskSource,
    localTaskSourceProjectId,
    setLocalTasks,
    setLocalTasksLoading,
    setLocalTasksError,
    setLocalTaskDialog
  } = model

  const refreshLocalTasks = useCallback(async () => {
    if (taskSource !== 'local' || !localTaskSourceProjectId) {
      return
    }
    setLocalTasksLoading(true)
    setLocalTasksError(null)
    try {
      const tasks = await listLocalTasks(localTaskSourceProjectId)
      setLocalTasks(() => tasks)
    } catch (error: unknown) {
      setLocalTasksError(error instanceof Error ? error.message : 'Failed to load local tasks')
    } finally {
      setLocalTasksLoading(false)
    }
  }, [
    localTaskSourceProjectId,
    setLocalTasks,
    setLocalTasksError,
    setLocalTasksLoading,
    taskSource
  ])

  const createLocalTaskMutation = useCallback(
    async (input: { title: string; description?: string; status?: LocalTaskStatus }) => {
      if (!localTaskSourceProjectId) {
        throw new Error('No active project for local tasks')
      }
      const created = await createLocalTask({ projectId: localTaskSourceProjectId, ...input })
      setLocalTasks((previous) => [...previous, created].sort((left, right) => left.id - right.id))
      setLocalTaskDialog(null)
      return created
    },
    [localTaskSourceProjectId, setLocalTasks, setLocalTaskDialog]
  )

  const moveLocalTask = useCallback(
    async (task: LocalTask, status: LocalTaskStatus) => {
      if (!localTaskSourceProjectId) {
        throw new Error('No active project for local tasks')
      }
      const optimistic: LocalTask = { ...task, status, updatedAt: Date.now() }
      let previous: LocalTask[] = []
      setLocalTasks((current) => {
        previous = current
        return current.map((entry) => (entry.id === task.id ? optimistic : entry))
      })
      try {
        const updated = await updateLocalTask({
          projectId: localTaskSourceProjectId,
          id: task.id,
          status
        })
        if (updated) {
          setLocalTasks((current) =>
            current.map((entry) => (entry.id === task.id ? updated : entry))
          )
          return updated
        }
        return optimistic
      } catch (error: unknown) {
        if (isRevisionConflict(error)) {
          try {
            const retried = await updateLocalTask({
              projectId: localTaskSourceProjectId,
              id: task.id,
              status
            })
            if (retried) {
              setLocalTasks((current) =>
                current.map((entry) => (entry.id === task.id ? retried : entry))
              )
            }
            return retried ?? optimistic
          } catch (retryError: unknown) {
            setLocalTasks(() => previous)
            throw retryError
          }
        }
        setLocalTasks(() => previous)
        throw error
      }
    },
    [localTaskSourceProjectId, setLocalTasks]
  )

  const editLocalTask = useCallback(
    async (
      task: LocalTask,
      patch: Partial<Pick<LocalTask, 'title' | 'description' | 'status'>>
    ): Promise<LocalTask | null> => {
      if (!localTaskSourceProjectId) {
        throw new Error('No active project for local tasks')
      }
      const updated = await updateLocalTask({
        projectId: localTaskSourceProjectId,
        id: task.id,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {})
      })
      if (updated) {
        setLocalTasks((current) => current.map((entry) => (entry.id === task.id ? updated : entry)))
      }
      return updated
    },
    [localTaskSourceProjectId, setLocalTasks]
  )

  const deleteLocalTaskMutation = useCallback(
    async (task: LocalTask) => {
      if (!localTaskSourceProjectId) {
        throw new Error('No active project for local tasks')
      }
      const ok = await deleteLocalTask(localTaskSourceProjectId, task.id)
      if (ok) {
        setLocalTasks((current) => current.filter((entry) => entry.id !== task.id))
      }
      return ok
    },
    [localTaskSourceProjectId, setLocalTasks]
  )

  return {
    refreshLocalTasks,
    createLocalTask: createLocalTaskMutation,
    moveLocalTask,
    editLocalTask,
    deleteLocalTask: deleteLocalTaskMutation
  }
}
