import type {
  AgentWorkflow,
  WorkflowEdge,
  WorkflowNode,
  StepOutputs
} from '../../shared/workflow-types'

/** Returns { output, json } from the first direct parent in the workflow graph. */
export function resolveNodeInputs(
  nodeId: string,
  edges: WorkflowEdge[],
  steps: StepOutputs
): { primaryOutput: string; primaryJson: unknown } {
  const parentEdge = edges.find((e) => e.targetNodeId === nodeId)
  if (!parentEdge) {
    return { primaryOutput: '', primaryJson: null }
  }
  const parent = steps[parentEdge.sourceNodeId]
  return { primaryOutput: parent?.output ?? '', primaryJson: parent?.json ?? null }
}

/**
 * BFS from startNodeId through the graph, stopping when we reach stopNodeId (inclusive)
 * or hit a collect node.
 */
export function getBodyNodes(
  startNodeId: string,
  stopNodeId: string | null,
  workflow: AgentWorkflow
): WorkflowNode[] {
  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]))
  const result: WorkflowNode[] = []
  const visited = new Set<string>()
  const queue = [startNodeId]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) {
      continue
    }
    visited.add(id)
    const node = nodeById.get(id)
    if (!node) {
      continue
    }
    result.push(node)
    if (id === stopNodeId) {
      break
    }
    if (node.type === 'collect') {
      break
    }
    for (const edge of workflow.edges.filter((e) => e.sourceNodeId === id)) {
      if (!visited.has(edge.targetNodeId)) {
        queue.push(edge.targetNodeId)
      }
    }
  }
  return result
}
