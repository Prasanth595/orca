import type { WorkflowCallData, AgentWorkflow } from '../../shared/workflow-types'
import type { WorkflowStoreOperations } from './workflow-run-store'
import { createWorkflowRun } from './workflow-run-store'
import type { RemoteExecFn } from './workflow-remote-exec'
import type { ExecuteNodeResult } from './workflow-executor-node'

/** Lazily resolved to break the executor ↔ executor-node circular import. */
type ExecuteWorkflowFn = (
  workflow: AgentWorkflow,
  runId: string,
  ops: WorkflowStoreOperations,
  callbacks: Record<string, never>,
  signal: AbortSignal,
  remoteExec?: RemoteExecFn
) => Promise<void>

let _executeWorkflow: ExecuteWorkflowFn | null = null

export function registerExecuteWorkflow(fn: ExecuteWorkflowFn): void {
  _executeWorkflow = fn
}

export async function runWorkflowCallNode(
  data: WorkflowCallData,
  parentWorkflowId: string,
  ops: WorkflowStoreOperations,
  signal: AbortSignal,
  remoteExec?: RemoteExecFn
): Promise<ExecuteNodeResult> {
  if (!data.targetWorkflowId) {
    throw new Error('workflow_call: no target workflow configured')
  }
  if (data.targetWorkflowId === parentWorkflowId) {
    throw new Error('workflow_call: self-referential call is not allowed')
  }
  const target = (ops.state.agentWorkflows ?? []).find((w) => w.id === data.targetWorkflowId)
  if (!target) {
    throw new Error(`workflow_call: target workflow not found (${data.targetWorkflowId})`)
  }
  if (!_executeWorkflow) {
    throw new Error('workflow_call: executor not registered')
  }
  const subRun = createWorkflowRun(ops, target, 'manual')
  await _executeWorkflow(target, subRun.id, ops, {}, signal, remoteExec)
  const finalRun = (ops.state.agentWorkflowRuns ?? []).find((r) => r.id === subRun.id)
  const lastCompleted = (finalRun?.nodeRuns ?? [])
    .toReversed()
    .find((nr) => nr.status === 'completed')
  const stdout = lastCompleted?.stdout ?? JSON.stringify({ subWorkflowRunId: subRun.id })
  const success = finalRun?.status === 'completed'
  return {
    stdout,
    stderr: '',
    outputValue: { subWorkflowRunId: subRun.id, output: stdout },
    exitCode: success ? 0 : 1
  }
}
