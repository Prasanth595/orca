import { ipcRenderer } from 'electron'
import type { AgentWorkflow, WorkflowRun } from '../../shared/workflow-types'
import type { TuiAgent } from '../../shared/tui-agent'

export type WorkflowModel = { id: string; label: string }

export type WorkflowsApi = {
  list: () => Promise<AgentWorkflow[]>
  getRuns: (workflowId?: string) => Promise<WorkflowRun[]>
  create: (partial: Omit<AgentWorkflow, 'id' | 'createdAt' | 'updatedAt'>) => Promise<AgentWorkflow>
  update: (id: string, patch: Partial<AgentWorkflow>) => Promise<AgentWorkflow | null>
  delete: (id: string) => Promise<boolean>
  runNow: (workflowId: string) => Promise<WorkflowRun>
  cancelRun: (runId: string) => Promise<void>
  stop: (workflowId: string) => Promise<boolean>
  listModels: (agentId: TuiAgent) => Promise<WorkflowModel[]>
  /** Probe which workflow-capable agent CLIs are installed on local or a named SSH target. */
  detectAgents: (targetId?: string) => Promise<TuiAgent[]>
  onChanged: (
    cb: (payload: { workflows: AgentWorkflow[]; runs: WorkflowRun[] }) => void
  ) => () => void
  onRunUpdated: (cb: (payload: { workflowId: string; run: WorkflowRun }) => void) => () => void
}

export const workflowsApi: WorkflowsApi = {
  list: () => ipcRenderer.invoke('workflows:list'),
  getRuns: (workflowId) => ipcRenderer.invoke('workflows:getRuns', workflowId),
  create: (partial) => ipcRenderer.invoke('workflows:create', partial),
  update: (id, patch) => ipcRenderer.invoke('workflows:update', id, patch),
  delete: (id) => ipcRenderer.invoke('workflows:delete', id),
  runNow: (workflowId) => ipcRenderer.invoke('workflows:runNow', workflowId),
  cancelRun: (runId) => ipcRenderer.invoke('workflows:cancelRun', runId),
  stop: (workflowId) => ipcRenderer.invoke('workflows:stop', workflowId),
  listModels: (agentId) => ipcRenderer.invoke('workflows:listModels', agentId),
  detectAgents: (targetId) => ipcRenderer.invoke('workflows:detectAgents', targetId),
  onChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) =>
      cb(payload)
    ipcRenderer.on('workflows:changed', listener)
    return () => ipcRenderer.removeListener('workflows:changed', listener)
  },
  onRunUpdated: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]) =>
      cb(payload)
    ipcRenderer.on('workflows:runUpdated', listener)
    return () => ipcRenderer.removeListener('workflows:runUpdated', listener)
  }
}
