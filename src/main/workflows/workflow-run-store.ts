import { randomUUID } from 'node:crypto'
import type {
  AgentWorkflow,
  WorkflowRun,
  WorkflowNodeRun,
  WorkflowRunStatus,
  WorkflowVariable
} from '../../shared/workflow-types'
import { isFinalWorkflowRunStatus } from '../../shared/workflow-types'
import type { PersistedState } from '../../shared/persisted-state-types'

const MAX_RUNS_PER_WORKFLOW = 50

export type WorkflowStoreOperations = {
  state: PersistedState
  flush: () => void
}

export function createWorkflowRun(
  ops: WorkflowStoreOperations,
  workflow: AgentWorkflow,
  trigger: WorkflowRun['trigger']
): WorkflowRun {
  const run: WorkflowRun = {
    id: randomUUID(),
    workflowId: workflow.id,
    trigger,
    status: 'pending',
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    nodeRuns: workflow.nodes.map((node) => ({
      nodeId: node.id,
      nodeType: node.type,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      stdout: null,
      stderr: null,
      outputValue: null,
      error: null,
      durationMs: null
    }))
  }
  const existing = (ops.state.agentWorkflowRuns ?? []).filter((r) => r.workflowId === workflow.id)
  const pruned = [...existing, run].slice(-MAX_RUNS_PER_WORKFLOW)
  const othersRuns = (ops.state.agentWorkflowRuns ?? []).filter((r) => r.workflowId !== workflow.id)
  ops.state.agentWorkflowRuns = [...othersRuns, ...pruned]
  ops.flush()
  return run
}

export function updateWorkflowRun(
  ops: WorkflowStoreOperations,
  runId: string,
  patch: Partial<Pick<WorkflowRun, 'status' | 'completedAt' | 'error' | 'nodeRuns'>>
): WorkflowRun | null {
  const idx = (ops.state.agentWorkflowRuns ?? []).findIndex((r) => r.id === runId)
  if (idx === -1) {
    return null
  }
  const updated = { ...ops.state.agentWorkflowRuns[idx], ...patch }
  ops.state.agentWorkflowRuns = ops.state.agentWorkflowRuns.map((r) =>
    r.id === runId ? updated : r
  )
  ops.flush()
  return updated
}

export function patchNodeRun(
  ops: WorkflowStoreOperations,
  runId: string,
  nodeId: string,
  patch: Partial<WorkflowNodeRun>
): WorkflowRun | null {
  const run = (ops.state.agentWorkflowRuns ?? []).find((r) => r.id === runId)
  if (!run) {
    return null
  }
  const updated: WorkflowRun = {
    ...run,
    nodeRuns: run.nodeRuns.map((nr) => (nr.nodeId === nodeId ? { ...nr, ...patch } : nr))
  }
  ops.state.agentWorkflowRuns = (ops.state.agentWorkflowRuns ?? []).map((r) =>
    r.id === runId ? updated : r
  )
  ops.flush()
  return updated
}

export function finalizeWorkflowRun(
  ops: WorkflowStoreOperations,
  runId: string,
  status: WorkflowRunStatus,
  error?: string | null
): WorkflowRun | null {
  return updateWorkflowRun(ops, runId, {
    status,
    completedAt: Date.now(),
    error: error ?? null
  })
}

export function listWorkflowRuns(state: PersistedState, workflowId?: string): WorkflowRun[] {
  const runs = state.agentWorkflowRuns ?? []
  return workflowId ? runs.filter((r) => r.workflowId === workflowId) : [...runs]
}

export function createWorkflow(ops: WorkflowStoreOperations, workflow: AgentWorkflow): void {
  ops.state.agentWorkflows = [...(ops.state.agentWorkflows ?? []), workflow]
  ops.flush()
}

export function updateWorkflow(
  ops: WorkflowStoreOperations,
  id: string,
  patch: Partial<AgentWorkflow>
): AgentWorkflow | null {
  const idx = (ops.state.agentWorkflows ?? []).findIndex((w) => w.id === id)
  if (idx === -1) {
    return null
  }
  const updated = { ...ops.state.agentWorkflows[idx], ...patch, updatedAt: Date.now() }
  ops.state.agentWorkflows = ops.state.agentWorkflows.map((w) => (w.id === id ? updated : w))
  ops.flush()
  return updated
}

export function deleteWorkflow(ops: WorkflowStoreOperations, id: string): boolean {
  const before = (ops.state.agentWorkflows ?? []).length
  ops.state.agentWorkflows = (ops.state.agentWorkflows ?? []).filter((w) => w.id !== id)
  ops.state.agentWorkflowRuns = (ops.state.agentWorkflowRuns ?? []).filter(
    (r) => r.workflowId !== id
  )
  ops.flush()
  return ops.state.agentWorkflows.length < before
}

export function getWorkflow(state: PersistedState, id: string): AgentWorkflow | null {
  return (state.agentWorkflows ?? []).find((w) => w.id === id) ?? null
}

export function getActiveRun(state: PersistedState, workflowId: string): WorkflowRun | null {
  return (
    (state.agentWorkflowRuns ?? []).find(
      (r) => r.workflowId === workflowId && !isFinalWorkflowRunStatus(r.status)
    ) ?? null
  )
}

export function listWorkflowVariables(state: PersistedState): WorkflowVariable[] {
  return state.workflowVariables ?? []
}

export function setWorkflowVariable(
  ops: WorkflowStoreOperations,
  variable: WorkflowVariable
): WorkflowVariable {
  const rest = (ops.state.workflowVariables ?? []).filter((v) => v.key !== variable.key)
  ops.state.workflowVariables = [...rest, variable]
  ops.flush()
  return variable
}

export function deleteWorkflowVariable(ops: WorkflowStoreOperations, key: string): boolean {
  const before = (ops.state.workflowVariables ?? []).length
  ops.state.workflowVariables = (ops.state.workflowVariables ?? []).filter((v) => v.key !== key)
  ops.flush()
  return (ops.state.workflowVariables ?? []).length < before
}
