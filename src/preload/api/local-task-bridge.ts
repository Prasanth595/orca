import { ipcRenderer } from 'electron'
import type { LocalTaskApi } from './local-task-api'

export const localTaskApiBridge = {
  list: (args: { projectId: string }) => ipcRenderer.invoke('local-tasks:list', args),
  create: (args: Parameters<LocalTaskApi['create']>[0]) =>
    ipcRenderer.invoke('local-tasks:create', args),
  update: (args: Parameters<LocalTaskApi['update']>[0]) =>
    ipcRenderer.invoke('local-tasks:update', args),
  remove: (args: { projectId: string; id: number }) =>
    ipcRenderer.invoke('local-tasks:delete', args)
} satisfies LocalTaskApi
