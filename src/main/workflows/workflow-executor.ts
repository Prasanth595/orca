import type {
  AgentWorkflow,
  WorkflowNode,
  WorkflowNodeRun,
  StepOutputs
} from '../../shared/workflow-types'
import { topologicalSort } from '../../shared/workflow-graph-topology'
import { getNodeRetryConfig } from '../../shared/workflow-node-retry'
import type { WorkflowStoreOperations } from './workflow-run-store'
import { patchNodeRun, finalizeWorkflowRun } from './workflow-run-store'
import type { RemoteExecFn } from './workflow-remote-exec'
import type { ExecuteNodeResult } from './workflow-executor-node'
import { executeNode } from './workflow-executor-node'
import { registerExecuteWorkflow } from './workflow-node-runner-workflow-call'

// Break the executor ↔ executor-node circular import by registering lazily.
registerExecuteWorkflow((workflow, runId, ops, _callbacks, signal, remoteExec) =>
  executeWorkflow(workflow, runId, ops, {}, signal, remoteExec)
)

export type WorkflowExecutorCallbacks = {
  onNodeStart?: (runId: string, nodeId: string) => void
  onNodeComplete?: (runId: string, nodeId: string, nodeRun: WorkflowNodeRun) => void
  onRunComplete?: (runId: string) => void
}

async function executeNodeWithRetry(
  node: WorkflowNode,
  workflow: AgentWorkflow,
  steps: StepOutputs,
  runId: string,
  ops: WorkflowStoreOperations,
  signal: AbortSignal,
  remoteExec?: RemoteExecFn
): Promise<ExecuteNodeResult> {
  const { retryCount, retryDelaySeconds } = getNodeRetryConfig(node)
  const retryDelayMs = retryDelaySeconds * 1000

  let lastError: unknown
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs * 2 ** (attempt - 1)))
    }
    try {
      return await executeNode(node, workflow, steps, runId, ops, signal, remoteExec)
    } catch (err) {
      lastError = err
      if (signal.aborted) {
        throw err
      }
      if (attempt < retryCount) {
        patchNodeRun(ops, runId, node.id, { retryAttempt: attempt + 1 })
      }
    }
  }
  throw lastError
}

export async function executeWorkflow(
  workflow: AgentWorkflow,
  runId: string,
  ops: WorkflowStoreOperations,
  callbacks: WorkflowExecutorCallbacks = {},
  signal: AbortSignal = new AbortController().signal,
  remoteExec?: RemoteExecFn
): Promise<void> {
  const sorted = topologicalSort(workflow)
  if (!sorted) {
    finalizeWorkflowRun(ops, runId, 'failed', 'Workflow graph has a cycle or invalid edges.')
    callbacks.onRunComplete?.(runId)
    return
  }

  const steps: StepOutputs = {}
  // Maps sourceNodeId → set of output labels that are "active" (branch fired)
  const activeEdgeLabels = new Map<string, Set<string>>()
  const completedNodeIds = new Set<string>()

  const deps = new Map<string, Set<string>>()
  for (const edge of workflow.edges) {
    if (!deps.has(edge.targetNodeId)) {
      deps.set(edge.targetNodeId, new Set())
    }
    deps.get(edge.targetNodeId)!.add(edge.sourceNodeId)
  }

  function isReady(nodeId: string): boolean {
    const nodeDeps = deps.get(nodeId) ?? new Set()
    for (const d of nodeDeps) {
      if (!completedNodeIds.has(d)) {
        return false
      }
    }
    return true
  }

  // A node is reachable only when every inbound labeled edge has been activated.
  function isReachable(nodeId: string): boolean {
    const inbound = workflow.edges.filter((e) => e.targetNodeId === nodeId)
    return inbound.every((e) => {
      if (!e.outputSelector) {
        return true
      }
      return activeEdgeLabels.get(e.sourceNodeId)?.has(e.outputSelector) ?? false
    })
  }

  const pending = [...sorted]

  while (pending.length > 0) {
    if (signal.aborted) {
      finalizeWorkflowRun(ops, runId, 'cancelled', 'Workflow was cancelled.')
      callbacks.onRunComplete?.(runId)
      return
    }

    const readyNow = pending.filter((n) => isReady(n.id))
    if (readyNow.length === 0) {
      break
    }

    for (const n of readyNow) {
      pending.splice(pending.indexOf(n), 1)
    }

    const unreachable = readyNow.filter((n) => !isReachable(n.id))
    for (const n of unreachable) {
      patchNodeRun(ops, runId, n.id, { status: 'skipped' })
      completedNodeIds.add(n.id)
    }

    const executable = readyNow.filter((n) => isReachable(n.id))
    if (executable.length === 0) {
      continue
    }

    // Each node reports its own completion immediately when it resolves so the UI
    // reflects real per-node timing instead of waiting for the slowest in the batch.
    type BatchItem =
      | { node: WorkflowNode; ok: true }
      | { node: WorkflowNode; ok: false; errorMsg: string }

    const batchResults = await Promise.all(
      executable.map(async (node): Promise<BatchItem> => {
        patchNodeRun(ops, runId, node.id, { status: 'running', startedAt: Date.now() })
        callbacks.onNodeStart?.(runId, node.id)
        const startMs = Date.now()
        try {
          const result = await executeNodeWithRetry(
            node,
            workflow,
            steps,
            runId,
            ops,
            signal,
            remoteExec
          )
          const durationMs = Date.now() - startMs

          // JS is single-threaded: these mutations are safe even with concurrent awaits
          let json: unknown = null
          try {
            json = JSON.parse(result.stdout)
          } catch {}
          steps[node.id] = { output: result.stdout, json: json ?? result.outputValue }
          completedNodeIds.add(node.id)

          if (result.activeLabel) {
            activeEdgeLabels.set(node.id, new Set([result.activeLabel]))
          }
          if (result.handledNodeIds) {
            for (const bodyId of result.handledNodeIds) {
              completedNodeIds.add(bodyId)
              const idx = pending.findIndex((n) => n.id === bodyId)
              if (idx !== -1) {
                pending.splice(idx, 1)
              }
            }
          }

          // Fire completion event now, not after the whole batch settles
          const runData = patchNodeRun(ops, runId, node.id, {
            status: 'completed',
            completedAt: Date.now(),
            stdout: result.stdout,
            stderr: result.stderr,
            outputValue: result.outputValue,
            durationMs,
            error: null
          })
          if (runData) {
            const nr = runData.nodeRuns.find((n) => n.nodeId === node.id)
            if (nr) {
              callbacks.onNodeComplete?.(runId, node.id, nr)
            }
          }

          return { node, ok: true }
        } catch (err) {
          const durationMs = Date.now() - startMs
          const errorMsg = err instanceof Error ? err.message : String(err)
          patchNodeRun(ops, runId, node.id, {
            status: 'failed',
            completedAt: Date.now(),
            error: errorMsg,
            durationMs
          })
          return { node, ok: false, errorMsg }
        }
      })
    )

    // Finalize on the first failure after all batch nodes have settled
    const firstFailure = batchResults.find((r) => !r.ok)
    if (firstFailure && !firstFailure.ok) {
      finalizeWorkflowRun(
        ops,
        runId,
        'failed',
        `Node ${firstFailure.node.type} ${firstFailure.node.id.slice(0, 8)} failed: ${firstFailure.errorMsg}`
      )
      callbacks.onRunComplete?.(runId)
      return
    }
  }

  if (signal.aborted) {
    finalizeWorkflowRun(ops, runId, 'cancelled', 'Workflow was cancelled.')
    callbacks.onRunComplete?.(runId)
    return
  }

  finalizeWorkflowRun(ops, runId, 'completed')
  callbacks.onRunComplete?.(runId)
}
