import { ipcMain } from 'electron'
import { z } from 'zod'
import type { Store } from '../persistence'
import { LOCAL_TASK_STATUSES } from '../../shared/local-task'

const ProjectId = z.string().min(1)
const TaskId = z.number().int().min(1)

const ListArgs = z.object({ projectId: ProjectId })
const CreateArgs = z.object({
  projectId: ProjectId,
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(LOCAL_TASK_STATUSES).optional()
})
const UpdateArgs = z.object({
  projectId: ProjectId,
  id: TaskId,
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(LOCAL_TASK_STATUSES).optional()
})
const DeleteArgs = z.object({ projectId: ProjectId, id: TaskId })

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid local task args: ${result.error.issues[0]?.message ?? 'unknown'}`)
  }
  return result.data
}

// Why IPC handlers, not RPC dispatcher: local tasks are profile-local store
// rows with no remote host, so they ride the main-owned Store directly like
// workspace ports instead of the runtime capability surface.
export function registerLocalTaskHandlers(store: Store): void {
  ipcMain.removeHandler('local-tasks:list')
  ipcMain.removeHandler('local-tasks:create')
  ipcMain.removeHandler('local-tasks:update')
  ipcMain.removeHandler('local-tasks:delete')
  ipcMain.handle('local-tasks:list', (_event, rawArgs?: unknown) => {
    const args = parse(ListArgs, rawArgs)
    return store.listLocalTasks(args.projectId)
  })
  ipcMain.handle('local-tasks:create', (_event, rawArgs?: unknown) => {
    const args = parse(CreateArgs, rawArgs)
    return store.createLocalTask(args.projectId, {
      title: args.title,
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.status !== undefined ? { status: args.status } : {})
    })
  })
  ipcMain.handle('local-tasks:update', (_event, rawArgs?: unknown) => {
    const args = parse(UpdateArgs, rawArgs)
    return store.updateLocalTask(args.projectId, args.id, {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined && args.description !== null
        ? { description: args.description }
        : {}),
      ...(args.status !== undefined ? { status: args.status } : {})
    })
  })
  ipcMain.handle('local-tasks:delete', (_event, rawArgs?: unknown) => {
    const args = parse(DeleteArgs, rawArgs)
    return store.deleteLocalTask(args.projectId, args.id)
  })
}
