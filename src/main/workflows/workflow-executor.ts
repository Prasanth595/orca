import type { AgentWorkflow, WorkflowNode, WorkflowNodeRun } from '../../shared/workflow-types'
import { topologicalSort } from '../../shared/workflow-graph-topology'
import type { WorkflowStoreOperations } from './workflow-run-store'
import { patchNodeRun, finalizeWorkflowRun } from './workflow-run-store'
import type { RemoteExecFn } from './workflow-remote-exec'
import type { StepOutputs, ExecuteNodeResult } from './workflow-executor-node'
import { executeNode } from './workflow-executor-node'

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
  const retryCount = 'retryCount' in node && node.retryCount ? node.retryCount : 0
  const retryDelayMs =
    'retryDelaySeconds' in node && node.retryDelaySeconds ? node.retryDelaySeconds * 1000 : 1000

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

    const batchResults = await Promise.all(
      executable.map(async (node) => {
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
          return { node, ok: true as const, result, startMs }
        } catch (err) {
          return {
            node,
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
            startMs
          }
        }
      })
    )

    let failed = false
    for (const item of batchResults) {
      const durationMs = Date.now() - item.startMs
      if (!item.ok) {
        patchNodeRun(ops, runId, item.node.id, {
          status: 'failed',
          completedAt: Date.now(),
          error: item.error,
          durationMs
        })
        finalizeWorkflowRun(
          ops,
          runId,
          'failed',
          `Node ${item.node.type} ${item.node.id.slice(0, 8)} failed: ${item.error}`
        )
        callbacks.onRunComplete?.(runId)
        failed = true
        break
      }

      const r = item.result
      let json: unknown = null
      try {
        json = JSON.parse(r.stdout)
      } catch {}
      steps[item.node.id] = { output: r.stdout, json: json ?? r.outputValue }

      const runData = patchNodeRun(ops, runId, item.node.id, {
        status: 'completed',
        completedAt: Date.now(),
        stdout: r.stdout,
        stderr: r.stderr,
        outputValue: r.outputValue,
        durationMs,
        error: null
      })
      if (runData) {
        const nr = runData.nodeRuns.find((n) => n.nodeId === item.node.id)
        if (nr) {
          callbacks.onNodeComplete?.(runId, item.node.id, nr)
        }
      }

      completedNodeIds.add(item.node.id)

      if (r.activeLabel) {
        activeEdgeLabels.set(item.node.id, new Set([r.activeLabel]))
      }

      if (r.handledNodeIds) {
        for (const bodyId of r.handledNodeIds) {
          completedNodeIds.add(bodyId)
          const idx = pending.findIndex((n) => n.id === bodyId)
          if (idx !== -1) {
            pending.splice(idx, 1)
          }
        }
      }
    }

    if (failed) {
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
