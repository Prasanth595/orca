import { ipcMain } from 'electron'
import { connectionManager } from './ssh-ipc-context'
import { buildSshRemoteExec } from '../workflows/workflow-remote-exec'
import type { WorkflowService } from '../workflows/workflow-service'
import type { AgentWorkflow, WorkflowVariable } from '../../shared/workflow-types'
import type { TuiAgent } from '../../shared/tui-agent'
import {
  detectLocalAgents,
  detectRemoteAgents,
  fetchModelsForAgent,
  localAgentHostRunner,
  remoteAgentHostRunner,
  type AgentHostRunner,
  type WorkflowModel
} from '../workflows/workflow-agent-host-probe'

export type { WorkflowModel } from '../workflows/workflow-agent-host-probe'

/** Probes run where the workflow runs: this machine, or the SSH target it names. */
function agentHostRunner(targetId: string | undefined): AgentHostRunner | null {
  if (!targetId) {
    return localAgentHostRunner
  }
  return connectionManager
    ? remoteAgentHostRunner(buildSshRemoteExec(connectionManager, targetId))
    : null
}

export function registerWorkflowHandlers(service: WorkflowService): void {
  // Live binding: the SSH manager may be created after this runs.
  service.setSshConnectionManagerResolver(() => connectionManager)
  ipcMain.handle('workflows:list', () => service.listWorkflows())

  ipcMain.handle('workflows:getRuns', (_e, workflowId?: string) => service.listRuns(workflowId))

  ipcMain.handle(
    'workflows:create',
    (_e, partial: Omit<AgentWorkflow, 'id' | 'createdAt' | 'updatedAt'>) =>
      service.createWorkflow(partial)
  )

  ipcMain.handle('workflows:update', (_e, id: string, patch: Partial<AgentWorkflow>) => {
    // When nodes are patched, auto-clear scheduling if no cron trigger remains
    if (patch.nodes !== undefined) {
      const hasCron = patch.nodes.some((n) => n.type === 'trigger_cron')
      if (!hasCron) {
        patch = { ...patch, schedule: null, enabled: false }
      }
    }
    return service.updateWorkflow(id, patch)
  })

  ipcMain.handle('workflows:delete', (_e, id: string) => service.deleteWorkflow(id))

  ipcMain.handle('workflows:runNow', async (_e, workflowId: string) => {
    const workflow = service.getWorkflow(workflowId)
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found.`)
    }
    const run = await service.runWorkflow(workflow, 'manual')
    // First run activates scheduling if a cron trigger is present
    const hasCron = workflow.nodes.some((n) => n.type === 'trigger_cron')
    if (hasCron && !workflow.enabled) {
      service.activateSchedule(workflowId)
    }
    return run
  })

  ipcMain.handle('workflows:stop', (_e, workflowId: string) => {
    const result = service.deactivateSchedule(workflowId)
    return result !== null
  })

  ipcMain.handle('workflows:cancelRun', (_e, runId: string) => {
    service.cancelRun(runId)
  })

  ipcMain.handle(
    'workflows:listModels',
    async (_e, agentId: TuiAgent, targetId?: string): Promise<WorkflowModel[]> => {
      const run = agentHostRunner(targetId)
      try {
        return run ? await fetchModelsForAgent(agentId, run) : []
      } catch {
        return []
      }
    }
  )

  ipcMain.handle('workflows:detectAgents', async (_e, targetId?: string): Promise<TuiAgent[]> => {
    try {
      if (!targetId) {
        return await detectLocalAgents()
      }
      return connectionManager
        ? await detectRemoteAgents(buildSshRemoteExec(connectionManager, targetId))
        : []
    } catch {
      return []
    }
  })

  ipcMain.handle('workflows:listVariables', () => service.listVariables())

  ipcMain.handle('workflows:setVariable', (_e, variable: WorkflowVariable) =>
    service.setVariable(variable)
  )

  ipcMain.handle('workflows:deleteVariable', (_e, key: string) => service.deleteVariable(key))
}

export function unregisterWorkflowHandlers(): void {
  for (const channel of [
    'workflows:list',
    'workflows:getRuns',
    'workflows:create',
    'workflows:update',
    'workflows:delete',
    'workflows:runNow',
    'workflows:cancelRun',
    'workflows:listModels',
    'workflows:detectAgents',
    'workflows:stop',
    'workflows:listVariables',
    'workflows:setVariable',
    'workflows:deleteVariable'
  ]) {
    ipcMain.removeHandler(channel)
  }
}
