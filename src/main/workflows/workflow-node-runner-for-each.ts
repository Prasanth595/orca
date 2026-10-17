import type {
  AgentWorkflow,
  ForEachData,
  StepOutputs,
  WorkflowNode
} from '../../shared/workflow-types'
import { resolveTemplateExpr } from '../../shared/workflow-template-path'
import { getBodyNodes } from './workflow-node-body-resolver'
import type { WorkflowStoreOperations } from './workflow-run-store'
import { patchNodeRun } from './workflow-run-store'
import type { RemoteExecFn } from './workflow-remote-exec'
import type { ExecuteNodeResult } from './workflow-executor-node'

type ExecuteNodeFn = (
  node: WorkflowNode,
  workflow: AgentWorkflow,
  steps: StepOutputs,
  runId: string,
  ops: WorkflowStoreOperations,
  signal: AbortSignal,
  remoteExec?: RemoteExecFn
) => Promise<ExecuteNodeResult>

let _executeNode: ExecuteNodeFn | null = null

export function registerExecuteNode(fn: ExecuteNodeFn): void {
  _executeNode = fn
}

export async function runForEachNode(
  nodeId: string,
  data: ForEachData,
  workflow: AgentWorkflow,
  steps: StepOutputs,
  primaryJson: unknown,
  runId: string,
  ops: WorkflowStoreOperations,
  signal: AbortSignal,
  remoteExec?: RemoteExecFn
): Promise<ExecuteNodeResult> {
  const rawItems = resolveTemplateExpr(data.itemsExpression, steps)
  let items: unknown[] = []
  try {
    const parsed: unknown = JSON.parse(rawItems)
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    if (Array.isArray(primaryJson)) {
      items = primaryJson
    } else if (primaryJson) {
      items = [primaryJson]
    }
  }
  items = items.slice(0, data.maxIterations)

  const bodyEdge = workflow.edges.find(
    (e) => e.sourceNodeId === nodeId && e.outputSelector === 'body'
  )
  const bodyNodes = bodyEdge ? getBodyNodes(bodyEdge.targetNodeId, null, workflow) : []
  const bodyNodeIds = bodyNodes.map((n) => n.id)
  const iterResults: unknown[] = []
  // Track each body node's last-iteration output for the final patch
  const bodyLastOut = new Map<string, { stdout: string; outputValue: unknown }>()

  if (!_executeNode) {
    throw new Error('for_each: executeNode not registered')
  }

  for (let i = 0; i < items.length; i++) {
    if (signal.aborted) {
      break
    }
    // Expose current item via both __loop__ and the for_each node's own ID so body
    // nodes (Python, shell) can receive it as primaryOutput/stdin.
    const itemEntry = { output: JSON.stringify(items[i]), json: { item: items[i], index: i } }
    const loopSteps: StepOutputs = { ...steps, [nodeId]: itemEntry, __loop__: itemEntry }
    let lastOutput: unknown = null
    for (const bodyNode of bodyNodes) {
      if (signal.aborted) {
        break
      }
      patchNodeRun(ops, runId, bodyNode.id, { status: 'running', startedAt: Date.now() })
      const r = await _executeNode(bodyNode, workflow, loopSteps, runId, ops, signal, remoteExec)
      let json: unknown = null
      try {
        json = JSON.parse(r.stdout)
      } catch {
        /* ignore */
      }
      loopSteps[bodyNode.id] = { output: r.stdout, json: json ?? r.outputValue }
      lastOutput = r.outputValue
      bodyLastOut.set(bodyNode.id, { stdout: r.stdout, outputValue: r.outputValue })
    }
    iterResults.push(lastOutput)
  }

  const aggregated = JSON.stringify(iterResults)
  for (const bodyNode of bodyNodes) {
    const out = bodyLastOut.get(bodyNode.id)
    patchNodeRun(ops, runId, bodyNode.id, {
      status: 'completed',
      completedAt: Date.now(),
      stdout: out?.stdout ?? aggregated,
      outputValue: out?.outputValue ?? iterResults,
      error: null
    })
  }

  return {
    stdout: aggregated,
    stderr: '',
    outputValue: { items: iterResults, count: iterResults.length },
    exitCode: 0,
    // Activate the 'done' edge so collect/downstream nodes are reachable after the loop.
    activeLabel: 'done',
    handledNodeIds: bodyNodeIds
  }
}
