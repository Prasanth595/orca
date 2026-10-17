import type {
  AgentWorkflow,
  WorkflowRun,
  WorkflowNodeRun,
  WorkflowRunStatus,
  WorkflowVariable
} from '../../../shared/workflow-types'
import type { StoreRuntimeState } from './store-runtime-state'
import { scheduleSave, type WriteSchedulingOperations } from './write-scheduling'
import {
  createWorkflow as createWorkflowOp,
  updateWorkflow as updateWorkflowOp,
  deleteWorkflow as deleteWorkflowOp,
  getWorkflow as getWorkflowOp,
  listWorkflowRuns as listWorkflowRunsOp,
  createWorkflowRun as createWorkflowRunOp,
  updateWorkflowRun as updateWorkflowRunOp,
  patchNodeRun as patchNodeRunOp,
  finalizeWorkflowRun as finalizeWorkflowRunOp,
  getActiveRun as getActiveRunOp,
  listWorkflowVariables as listWorkflowVariablesOp,
  setWorkflowVariable as setWorkflowVariableOp,
  deleteWorkflowVariable as deleteWorkflowVariableOp,
  type WorkflowStoreOperations
} from '../../workflows/workflow-run-store'

type WorkflowPersistenceRuntime = Pick<StoreRuntimeState, 'state'>

const workflowPersistenceContext = Symbol('WorkflowPersistence')
type WorkflowPersistenceContext = {
  runtime: WorkflowPersistenceRuntime
  scheduling: WriteSchedulingOperations
}

export class WorkflowPersistence {
  readonly [workflowPersistenceContext]: WorkflowPersistenceContext

  constructor(runtime: WorkflowPersistenceRuntime, scheduling: WriteSchedulingOperations) {
    this[workflowPersistenceContext] = { runtime, scheduling }
  }

  private get ops(): WorkflowStoreOperations {
    const { runtime, scheduling } = this[workflowPersistenceContext]
    return {
      state: runtime.state,
      flush: () => scheduleSave(scheduling, ['workflows'])
    }
  }

  asOps(): WorkflowStoreOperations {
    return this.ops
  }

  listWorkflows(): AgentWorkflow[] {
    return this[workflowPersistenceContext].runtime.state.agentWorkflows ?? []
  }

  listWorkflowRuns(workflowId?: string): WorkflowRun[] {
    return listWorkflowRunsOp(this[workflowPersistenceContext].runtime.state, workflowId)
  }

  createWorkflowRecord(workflow: AgentWorkflow): void {
    createWorkflowOp(this.ops, workflow)
  }

  updateWorkflowRecord(id: string, patch: Partial<AgentWorkflow>): AgentWorkflow | null {
    return updateWorkflowOp(this.ops, id, patch)
  }

  deleteWorkflowRecord(id: string): boolean {
    return deleteWorkflowOp(this.ops, id)
  }

  getWorkflowRecord(id: string): AgentWorkflow | null {
    return getWorkflowOp(this[workflowPersistenceContext].runtime.state, id)
  }

  createWorkflowRunRecord(workflow: AgentWorkflow, trigger: WorkflowRun['trigger']): WorkflowRun {
    return createWorkflowRunOp(this.ops, workflow, trigger)
  }

  updateWorkflowRunRecord(
    runId: string,
    patch: Partial<Pick<WorkflowRun, 'status' | 'completedAt' | 'error' | 'nodeRuns'>>
  ): WorkflowRun | null {
    return updateWorkflowRunOp(this.ops, runId, patch)
  }

  patchWorkflowNodeRun(
    runId: string,
    nodeId: string,
    patch: Partial<WorkflowNodeRun>
  ): WorkflowRun | null {
    return patchNodeRunOp(this.ops, runId, nodeId, patch)
  }

  finalizeWorkflowRunRecord(
    runId: string,
    status: WorkflowRunStatus,
    error?: string | null
  ): WorkflowRun | null {
    return finalizeWorkflowRunOp(this.ops, runId, status, error)
  }

  getActiveWorkflowRun(workflowId: string): WorkflowRun | null {
    return getActiveRunOp(this[workflowPersistenceContext].runtime.state, workflowId)
  }

  listVariables(): WorkflowVariable[] {
    return listWorkflowVariablesOp(this[workflowPersistenceContext].runtime.state)
  }

  setVariable(variable: WorkflowVariable): WorkflowVariable {
    return setWorkflowVariableOp(this.ops, variable)
  }

  deleteVariable(key: string): boolean {
    return deleteWorkflowVariableOp(this.ops, key)
  }
}
