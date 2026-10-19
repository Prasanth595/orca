import type { LocalTask, LocalTaskStatus } from '../../../shared/local-task'
import { buildLocalTaskUrl, normalizeLocalTasksByProject } from '../../../shared/local-tasks'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'

type LocalTaskRuntime = Pick<StoreRuntimeState, 'state'>

const localTaskPersistenceContext = Symbol('LocalTaskPersistence')
type LocalTaskPersistenceContext = {
  runtime: LocalTaskRuntime
  scheduling: WriteSchedulingOperations
}

export type LocalTaskCreateInput = {
  title: string
  description?: string
  status?: LocalTaskStatus
}

// Why revision-fenced whole-domain writes: the domain is a single JSON document;
// concurrent writers replace it under expectedRevision, so conflicts surface as
// ProfileStateRevisionConflictError instead of silently dropping tasks.
export class LocalTaskPersistence {
  readonly [localTaskPersistenceContext]: LocalTaskPersistenceContext

  constructor(runtime: LocalTaskRuntime, scheduling: WriteSchedulingOperations) {
    this[localTaskPersistenceContext] = { runtime, scheduling }
  }

  listLocalTasks(projectId: string): LocalTask[] {
    return [
      ...(this[localTaskPersistenceContext].runtime.state.localTasksByProject?.[projectId]?.tasks ??
        [])
    ]
  }

  createLocalTask(projectId: string, input: LocalTaskCreateInput): LocalTask {
    const title = input.title.trim()
    if (title.length === 0) {
      throw new Error('Local task title cannot be blank')
    }
    const now = Date.now()
    const { runtime, scheduling } = this[localTaskPersistenceContext]
    const bucket = runtime.state.localTasksByProject?.[projectId] ?? {
      tasks: [],
      nextLocalTaskId: 1
    }
    const id = bucket.nextLocalTaskId
    const task: LocalTask = {
      id,
      url: buildLocalTaskUrl(projectId, id),
      title,
      description: input.description?.trim() ?? '',
      status: input.status ?? 'todo',
      createdAt: now,
      updatedAt: now
    }
    // Why no sort: ids allocate monotonically past the max, so append order is already sorted.
    const tasks = [...bucket.tasks, task]
    runtime.state.localTasksByProject = {
      ...runtime.state.localTasksByProject,
      [projectId]: { tasks, nextLocalTaskId: id + 1 }
    }
    scheduleSave(scheduling, ['localTasksByProject'])
    return task
  }

  updateLocalTask(
    projectId: string,
    id: number,
    patch: Partial<Pick<LocalTask, 'title' | 'description' | 'status'>>
  ): LocalTask | null {
    const { runtime, scheduling } = this[localTaskPersistenceContext]
    const bucket = runtime.state.localTasksByProject?.[projectId]
    const existing = bucket?.tasks.find((task) => task.id === id)
    if (!bucket || !existing) {
      return null
    }
    const title = patch.title === undefined ? existing.title : patch.title.trim()
    if (title.length === 0) {
      throw new Error('Local task title cannot be blank')
    }
    const updated: LocalTask = {
      ...existing,
      title,
      description:
        patch.description === undefined ? existing.description : patch.description.trim(),
      status: patch.status ?? existing.status,
      updatedAt: Date.now()
    }
    runtime.state.localTasksByProject = {
      ...runtime.state.localTasksByProject,
      [projectId]: {
        tasks: bucket.tasks.map((task) => (task.id === id ? updated : task)),
        nextLocalTaskId: bucket.nextLocalTaskId
      }
    }
    scheduleSave(scheduling, ['localTasksByProject'])
    return updated
  }

  deleteLocalTask(projectId: string, id: number): boolean {
    const { runtime, scheduling } = this[localTaskPersistenceContext]
    const bucket = runtime.state.localTasksByProject?.[projectId]
    if (!bucket) {
      return false
    }
    const tasks = bucket.tasks.filter((task) => task.id !== id)
    if (tasks.length === bucket.tasks.length) {
      return false
    }
    runtime.state.localTasksByProject = {
      ...runtime.state.localTasksByProject,
      [projectId]: { tasks, nextLocalTaskId: bucket.nextLocalTaskId }
    }
    scheduleSave(scheduling, ['localTasksByProject'])
    return true
  }

  // Why explicit-removal only: the read normalizer never prunes (the catalog is
  // not known-complete at read time); project deletion is where the catalog is
  // authoritative, so unknown keys drop there and nowhere else.
  pruneLocalTasksForRemovedProjects(knownProjectIds: readonly string[]): void {
    const { runtime, scheduling } = this[localTaskPersistenceContext]
    const current = normalizeLocalTasksByProject(runtime.state.localTasksByProject) ?? {}
    const known = new Set(knownProjectIds)
    // Why early return: no-op prune must not touch state or schedule a save.
    if (Object.keys(current).every((projectId) => known.has(projectId))) {
      return
    }
    const next: Record<string, (typeof current)[string]> = {}
    for (const [projectId, bucket] of Object.entries(current)) {
      if (known.has(projectId)) {
        next[projectId] = bucket
      }
    }
    runtime.state.localTasksByProject = next
    scheduleSave(scheduling, ['localTasksByProject'])
  }
}
